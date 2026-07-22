import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import {
  MODULE_NAME,
  type StreamPlatform,
  type StreamSubscription,
  type StreamalertsConfig,
  getStreamalertsConfig,
  streamPlatformSchema,
  updateStreamalertsConfig,
} from './config.js';
import { flaresolverrConfigured, testSubscription, twitchConfigured } from './service.js';

const MAX_SUBS = 50;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

const PLATFORM_EMOJI: Record<StreamPlatform, string> = {
  twitch: '🟣',
  youtube: '🔴',
  reddit: '🟠',
  rss: '📰',
  dealabs: '🏷️',
};

function platformEmoji(platform: StreamPlatform): string {
  return PLATFORM_EMOJI[platform] ?? '📡';
}

/** Libellé lisible d'un abonnement (gère l'identifiant vide de Dealabs). */
function subIdentifierLabel(sub: StreamSubscription): string {
  if (sub.identifier) return sub.identifier;
  return t(`modules.streamalerts.platform.${sub.platform}`);
}

function subLabel(sub: StreamSubscription): string {
  return `${platformEmoji(sub.platform)} ${subIdentifierLabel(sub)}`;
}

/** Nettoie une saisie : accepte une URL et en extrait l'identifiant utile. */
function cleanIdentifier(platform: StreamPlatform, raw: string): string {
  const value = raw.trim();
  if (platform === 'twitch') {
    const match = /twitch\.tv\/([^/?\s]+)/i.exec(value);
    return (match?.[1] ?? value).replace(/^@/, '').toLowerCase();
  }
  if (platform === 'reddit') {
    const match = /reddit\.com\/r\/([^/?\s]+)/i.exec(value);
    return (match?.[1] ?? value)
      .replace(/^\/?r\//i, '')
      .replace(/^@/, '')
      .toLowerCase();
  }
  if (platform === 'rss') {
    // RSS : l'identifiant est l'URL du flux, conservée telle quelle.
    return value.replace(/\s+/g, '');
  }
  if (platform === 'dealabs') {
    // Dealabs : mot-clé de filtre optionnel (peut être vide = tous les deals hot).
    return value.toLowerCase();
  }
  // YouTube : ID de chaîne (UC…), @handle ou nom — résolus au moment du contrôle.
  const channel = /channel\/(UC[\w-]+)/i.exec(value)?.[1];
  if (channel) return channel;
  const handle = /youtube\.com\/@([\w.-]+)/i.exec(value)?.[1];
  if (handle) return `@${handle}`;
  const legacy = /youtube\.com\/(?:c|user)\/([\w.-]+)/i.exec(value)?.[1];
  if (legacy) return legacy;
  return value.replace(/\s+/g, '');
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getStreamalertsConfig(ctx, guildId);

  const list = config.subscriptions.length
    ? config.subscriptions
        .map((sub) =>
          sub.channelId
            ? `${subLabel(sub)} → <#${sub.channelId}>`
            : `${subLabel(sub)} — ${t('modules.streamalerts.panel.noChannel')}`,
        )
        .join('\n')
    : t('modules.streamalerts.panel.noSubs');

  const embed = infoEmbed({
    title: t('modules.streamalerts.label'),
    description: t('modules.streamalerts.panel.intro'),
  }).addFields(
    { name: t('modules.streamalerts.panel.subsField'), value: list.slice(0, 1024) },
    {
      name: t('modules.streamalerts.panel.twitchStatus'),
      value: twitchConfigured()
        ? t('modules.streamalerts.panel.twitchOn')
        : t('modules.streamalerts.panel.twitchOff'),
    },
  );

  // Statut du résolveur Cloudflare : pertinent seulement si une source Dealabs existe.
  if (config.subscriptions.some((sub) => sub.platform === 'dealabs')) {
    embed.addFields({
      name: t('modules.streamalerts.panel.dealabsStatus'),
      value: flaresolverrConfigured()
        ? t('modules.streamalerts.panel.dealabsOn')
        : t('modules.streamalerts.panel.dealabsOff'),
    });
  }

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add', 'twitch'))
        .setLabel(t('modules.streamalerts.panel.addTwitch'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add', 'youtube'))
        .setLabel(t('modules.streamalerts.panel.addYoutube'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add', 'reddit'))
        .setLabel(t('modules.streamalerts.panel.addReddit'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add', 'rss'))
        .setLabel(t('modules.streamalerts.panel.addRss'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add', 'dealabs'))
        .setLabel(t('modules.streamalerts.panel.addDealabs'))
        .setStyle(ButtonStyle.Secondary),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'subs'))
        .setLabel(t('modules.streamalerts.panel.manage'))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages -------------------------------------------------------------

function renderSubList(config: StreamalertsConfig): {
  embeds: EmbedBuilder[];
  components: PanelRow[];
} {
  const embed = infoEmbed({
    title: t('modules.streamalerts.panel.listTitle'),
    description: t('modules.streamalerts.panel.listIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'subpick'))
    .setPlaceholder(t('modules.streamalerts.panel.pickPlaceholder'))
    .addOptions(
      config.subscriptions.map((sub) =>
        new StringSelectMenuOptionBuilder().setLabel(subLabel(sub).slice(0, 100)).setValue(sub.id),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.streamalerts.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderSubEdit(sub: StreamSubscription): {
  embeds: EmbedBuilder[];
  components: PanelRow[];
} {
  const embed = infoEmbed({
    title: t('modules.streamalerts.panel.editTitle', { name: subIdentifierLabel(sub) }),
    description: t('modules.streamalerts.panel.editIntro'),
  }).addFields(
    {
      name: t('modules.streamalerts.panel.platformField'),
      value: t(`modules.streamalerts.platform.${sub.platform}`),
      inline: true,
    },
    {
      name: t('modules.streamalerts.panel.channelField'),
      value: sub.channelId ? `<#${sub.channelId}>` : t('modules.streamalerts.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.streamalerts.panel.roleField'),
      value: sub.roleId ? `<@&${sub.roleId}>` : t('modules.streamalerts.panel.noRole'),
      inline: true,
    },
    {
      name: t('modules.streamalerts.panel.messageField'),
      value: sub.message
        ? sub.message.slice(0, 500)
        : t('modules.streamalerts.panel.defaultMessage'),
    },
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'subchan', sub.id))
    .setPlaceholder(t('modules.streamalerts.panel.channelPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (sub.channelId) channelSelect.setDefaultChannels([sub.channelId]);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'subrole', sub.id))
    .setPlaceholder(t('modules.streamalerts.panel.rolePlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  if (sub.roleId) roleSelect.setDefaultRoles([sub.roleId]);

  return {
    embeds: [embed],
    components: [
      row().addComponents(channelSelect),
      row().addComponents(roleSelect),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'submsg', sub.id))
          .setLabel(t('modules.streamalerts.panel.editMessage'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'subtest', sub.id))
          .setLabel(t('modules.streamalerts.panel.testButton'))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'subdelete', sub.id))
          .setLabel(t('modules.streamalerts.panel.deleteSub'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'subs'))
          .setLabel(t('modules.streamalerts.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

const ID_PLACEHOLDER: Record<StreamPlatform, string> = {
  twitch: 'ex. pseudo ou twitch.tv/pseudo',
  youtube: 'ex. @reiiko_live, reiiko_live ou UCxxxx',
  reddit: 'ex. gaming ou r/gaming',
  rss: 'ex. https://exemple.com/flux.xml',
  dealabs: 'mot-clé de filtre (optionnel, ex. lego)',
};

function addModal(platform: StreamPlatform): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'addmodal', platform))
    .setTitle(t(`modules.streamalerts.panel.add_${platform}Title`))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('identifier')
          .setLabel(t(`modules.streamalerts.panel.${platform}IdField`))
          .setStyle(platform === 'rss' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setMaxLength(platform === 'rss' ? 400 : 120)
          // Dealabs : l'identifiant (mot-clé) est facultatif.
          .setRequired(platform !== 'dealabs')
          .setPlaceholder(ID_PLACEHOLDER[platform]),
      ),
    );
}

/** Valide un abonnement avant création (identifiant requis sauf Dealabs). */
function isValidNewIdentifier(platform: StreamPlatform, identifier: string): boolean {
  if (platform === 'dealabs') return true;
  if (platform === 'rss') return /^https?:\/\/\S+$/i.test(identifier);
  return identifier.length > 0;
}

function messageModal(sub: StreamSubscription): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'submsgmodal', sub.id))
    .setTitle(t('modules.streamalerts.panel.messageTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel(t('modules.streamalerts.panel.messageInput'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false)
          .setValue(sub.message)
          .setPlaceholder('{name} {url} {title} {prix} {temperature} {marchand}'),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

function patchSub(
  config: StreamalertsConfig,
  id: string,
  patch: Partial<StreamSubscription>,
): StreamSubscription[] {
  return config.subscriptions.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub));
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'add': {
      if (!interaction.isButton()) return;
      const platform = streamPlatformSchema.catch('twitch').parse(params[0]);
      await interaction.showModal(addModal(platform));
      return;
    }
    case 'addmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const platform = streamPlatformSchema.catch('twitch').parse(params[0]);
      const config = await getStreamalertsConfig(ctx, guildId);
      const identifier = cleanIdentifier(
        platform,
        interaction.fields.getTextInputValue('identifier'),
      );
      if (config.subscriptions.length >= MAX_SUBS || !isValidNewIdentifier(platform, identifier)) {
        await interaction.update(await renderPage());
        return;
      }
      const sub: StreamSubscription = {
        id: randomUUID().slice(0, 8),
        platform,
        identifier,
        displayName: '',
        channelId: '',
        roleId: null,
        message: '',
      };
      const subscriptions = [...config.subscriptions, sub];
      await updateStreamalertsConfig(ctx, guildId, { subscriptions });
      await interaction.update(renderSubEdit(sub));
      return;
    }
    case 'subs': {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      if (config.subscriptions.length === 0) {
        await interaction.update(await renderPage());
        return;
      }
      await interaction.update(renderSubList(config));
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'subpick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const sub = config.subscriptions.find((candidate) => candidate.id === interaction.values[0]);
      await interaction.update(sub ? renderSubEdit(sub) : renderSubList(config));
      return;
    }
    case 'subchan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const subscriptions = patchSub(config, params[0] ?? '', {
        channelId: interaction.values[0] ?? '',
      });
      await updateStreamalertsConfig(ctx, guildId, { subscriptions });
      const sub = subscriptions.find((candidate) => candidate.id === params[0]);
      await interaction.update(
        sub ? renderSubEdit(sub) : renderSubList({ ...config, subscriptions }),
      );
      return;
    }
    case 'subrole': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const subscriptions = patchSub(config, params[0] ?? '', {
        roleId: interaction.values[0] ?? null,
      });
      await updateStreamalertsConfig(ctx, guildId, { subscriptions });
      const sub = subscriptions.find((candidate) => candidate.id === params[0]);
      await interaction.update(
        sub ? renderSubEdit(sub) : renderSubList({ ...config, subscriptions }),
      );
      return;
    }
    case 'submsg': {
      if (!interaction.isButton()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const sub = config.subscriptions.find((candidate) => candidate.id === params[0]);
      if (!sub) return;
      await interaction.showModal(messageModal(sub));
      return;
    }
    case 'submsgmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const subscriptions = patchSub(config, params[0] ?? '', {
        message: interaction.fields.getTextInputValue('message').trim(),
      });
      await updateStreamalertsConfig(ctx, guildId, { subscriptions });
      const sub = subscriptions.find((candidate) => candidate.id === params[0]);
      await interaction.update(
        sub ? renderSubEdit(sub) : renderSubList({ ...config, subscriptions }),
      );
      return;
    }
    case 'subtest': {
      if (!interaction.isButton()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const sub = config.subscriptions.find((candidate) => candidate.id === params[0]);
      if (!sub) return;
      // Réponse éphémère : on n'écrase pas la vue d'édition du panneau.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const outcome = await testSubscription(ctx, sub);
      await interaction.editReply({ content: t(`modules.streamalerts.panel.test_${outcome}`) });
      return;
    }
    case 'subdelete': {
      if (!interaction.isButton()) return;
      const config = await getStreamalertsConfig(ctx, guildId);
      const subscriptions = config.subscriptions.filter((sub) => sub.id !== params[0]);
      await updateStreamalertsConfig(ctx, guildId, { subscriptions });
      await interaction.update(
        subscriptions.length ? renderSubList({ ...config, subscriptions }) : await renderPage(),
      );
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Alertes Twitch/YouTube ». */
export const streamalertsPanel: ConfigPanel = { render, handle };
