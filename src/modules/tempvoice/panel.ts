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
  DEFAULT_NAME_TEMPLATE,
  MODULE_NAME,
  type TempVoiceConfig,
  type TempVoiceHub,
  getTempvoiceConfig,
  updateTempvoiceConfig,
} from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function hubName(ctx: BotContext, guildId: string, hub: TempVoiceHub): string {
  const channel = ctx.client.guilds.cache.get(guildId)?.channels.cache.get(hub.channelId);
  return channel?.name ?? `Salon ${hub.channelId}`;
}

function limitLabel(hub: TempVoiceHub): string {
  return hub.userLimit > 0 ? String(hub.userLimit) : t('modules.tempvoice.panel.unlimited');
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getTempvoiceConfig(ctx, guildId);

  const hubsList = config.hubs.length
    ? config.hubs
        .map(
          (hub) =>
            `• <#${hub.channelId}> — \`${hub.nameTemplate}\` · ${t('modules.tempvoice.panel.limitShort', { limit: limitLabel(hub) })}`,
        )
        .join('\n')
    : t('modules.tempvoice.panel.noHubs');

  const embed = infoEmbed({
    title: t('modules.tempvoice.label'),
    description: t('modules.tempvoice.panel.intro'),
  }).addFields(
    { name: t('modules.tempvoice.panel.hubsField'), value: hubsList },
    {
      name: t('modules.tempvoice.panel.controlField'),
      value: config.showControlPanel
        ? t('modules.tempvoice.panel.controlOn')
        : t('modules.tempvoice.panel.controlOff'),
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'addhub'))
        .setPlaceholder(t('modules.tempvoice.panel.addHubPlaceholder'))
        .addChannelTypes(ChannelType.GuildVoice)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'hubs'))
        .setLabel(t('modules.tempvoice.panel.manageHubs'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'togglepanel'))
        .setLabel(
          config.showControlPanel
            ? t('modules.tempvoice.panel.disablePanel')
            : t('modules.tempvoice.panel.enablePanel'),
        )
        .setStyle(config.showControlPanel ? ButtonStyle.Secondary : ButtonStyle.Success),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages -------------------------------------------------------------

function renderHubList(
  ctx: BotContext,
  guildId: string,
  config: TempVoiceConfig,
): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.tempvoice.panel.hubListTitle'),
    description: t('modules.tempvoice.panel.hubListIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'hubpick'))
    .setPlaceholder(t('modules.tempvoice.panel.hubPickPlaceholder'))
    .addOptions(
      config.hubs.map((hub) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(hubName(ctx, guildId, hub).slice(0, 100))
          .setValue(hub.channelId)
          .setDescription(hub.nameTemplate.slice(0, 100)),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.tempvoice.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderHubEdit(hub: TempVoiceHub): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.tempvoice.panel.hubEditTitle'),
    description: t('modules.tempvoice.panel.hubEditIntro'),
  }).addFields(
    { name: t('modules.tempvoice.panel.hubChannel'), value: `<#${hub.channelId}>`, inline: true },
    {
      name: t('modules.tempvoice.panel.hubCategory'),
      value: hub.categoryId
        ? `<#${hub.categoryId}>`
        : t('modules.tempvoice.panel.hubCategoryDefault'),
      inline: true,
    },
    { name: t('modules.tempvoice.panel.hubTemplate'), value: `\`${hub.nameTemplate}\`` },
    { name: t('modules.tempvoice.panel.hubLimit'), value: limitLabel(hub), inline: true },
    {
      name: t('modules.tempvoice.panel.hubBitrate'),
      value: hub.bitrate ? `${hub.bitrate} kbps` : t('modules.tempvoice.panel.hubBitrateDefault'),
      inline: true,
    },
    {
      name: t('modules.tempvoice.panel.hubLocked'),
      value: hub.lockedByDefault
        ? t('modules.tempvoice.panel.hubLockedOn')
        : t('modules.tempvoice.panel.hubLockedOff'),
      inline: true,
    },
    {
      name: t('modules.tempvoice.panel.hubInherit'),
      value: hub.inheritPermissions
        ? t('modules.tempvoice.panel.hubInheritOn')
        : t('modules.tempvoice.panel.hubInheritOff'),
      inline: true,
    },
  );

  const catSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'hubcat', hub.channelId))
    .setPlaceholder(t('modules.tempvoice.panel.hubCategoryPlaceholder'))
    .addChannelTypes(ChannelType.GuildCategory)
    .setMinValues(0)
    .setMaxValues(1);
  if (hub.categoryId) catSelect.setDefaultChannels([hub.categoryId]);

  return {
    embeds: [embed],
    components: [
      row().addComponents(catSelect),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hubname', hub.channelId))
          .setLabel(t('modules.tempvoice.panel.editTemplate'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hubsettings', hub.channelId))
          .setLabel(t('modules.tempvoice.panel.editLimits'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hublock', hub.channelId))
          .setLabel(
            hub.lockedByDefault
              ? t('modules.tempvoice.panel.unlockDefault')
              : t('modules.tempvoice.panel.lockDefault'),
          )
          .setStyle(hub.lockedByDefault ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hubinherit', hub.channelId))
          .setLabel(
            hub.inheritPermissions
              ? t('modules.tempvoice.panel.disableInherit')
              : t('modules.tempvoice.panel.enableInherit'),
          )
          .setStyle(hub.inheritPermissions ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hubdelete', hub.channelId))
          .setLabel(t('modules.tempvoice.panel.deleteHub'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hubs'))
          .setLabel(t('modules.tempvoice.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function templateModal(hub: TempVoiceHub): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'hubnamemodal', hub.channelId))
    .setTitle(t('modules.tempvoice.panel.templateTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('template')
          .setLabel(t('modules.tempvoice.panel.templateField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setValue(hub.nameTemplate)
          .setPlaceholder('🔊 {user}'),
      ),
    );
}

function settingsModal(hub: TempVoiceHub): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'hubsettingsmodal', hub.channelId))
    .setTitle(t('modules.tempvoice.panel.limitsTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('limit')
          .setLabel(t('modules.tempvoice.panel.limitField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(2)
          .setRequired(true)
          .setValue(String(hub.userLimit))
          .setPlaceholder('0-99'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('bitrate')
          .setLabel(t('modules.tempvoice.panel.bitrateField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(3)
          .setRequired(false)
          .setValue(hub.bitrate ? String(hub.bitrate) : '')
          .setPlaceholder('8-96'),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

function patchHub(
  config: TempVoiceConfig,
  channelId: string,
  patch: Partial<TempVoiceHub>,
): TempVoiceHub[] {
  return config.hubs.map((hub) => (hub.channelId === channelId ? { ...hub, ...patch } : hub));
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
    case 'addhub': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (channelId) {
        const config = await getTempvoiceConfig(ctx, guildId);
        if (!config.hubs.some((hub) => hub.channelId === channelId)) {
          await updateTempvoiceConfig(ctx, guildId, {
            hubs: [
              ...config.hubs,
              {
                channelId,
                categoryId: null,
                nameTemplate: DEFAULT_NAME_TEMPLATE,
                userLimit: 0,
                bitrate: null,
                lockedByDefault: false,
                inheritPermissions: true,
              },
            ],
          });
        }
      }
      await interaction.update(await renderPage());
      return;
    }
    case 'togglepanel': {
      if (!interaction.isButton()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      await updateTempvoiceConfig(ctx, guildId, { showControlPanel: !config.showControlPanel });
      await interaction.update(await renderPage());
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'hubs': {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      if (config.hubs.length === 0) {
        await interaction.reply({
          content: t('modules.tempvoice.panel.noHubsYet'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update(renderHubList(ctx, guildId, config));
      return;
    }
    case 'hubpick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const hub = config.hubs.find((candidate) => candidate.channelId === interaction.values[0]);
      await interaction.update(hub ? renderHubEdit(hub) : renderHubList(ctx, guildId, config));
      return;
    }
    case 'hubcat': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const hubs = patchHub(config, params[0] ?? '', { categoryId: interaction.values[0] ?? null });
      await updateTempvoiceConfig(ctx, guildId, { hubs });
      const hub = hubs.find((candidate) => candidate.channelId === params[0]);
      await interaction.update(
        hub ? renderHubEdit(hub) : renderHubList(ctx, guildId, { ...config, hubs }),
      );
      return;
    }
    case 'hubname': {
      if (!interaction.isButton()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const hub = config.hubs.find((candidate) => candidate.channelId === params[0]);
      if (!hub) return;
      await interaction.showModal(templateModal(hub));
      return;
    }
    case 'hubnamemodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const template = interaction.fields.getTextInputValue('template').trim().slice(0, 100);
      const hubs = patchHub(config, params[0] ?? '', {
        nameTemplate: template || DEFAULT_NAME_TEMPLATE,
      });
      await updateTempvoiceConfig(ctx, guildId, { hubs });
      const hub = hubs.find((candidate) => candidate.channelId === params[0]);
      await interaction.update(
        hub ? renderHubEdit(hub) : renderHubList(ctx, guildId, { ...config, hubs }),
      );
      return;
    }
    case 'hubsettings': {
      if (!interaction.isButton()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const hub = config.hubs.find((candidate) => candidate.channelId === params[0]);
      if (!hub) return;
      await interaction.showModal(settingsModal(hub));
      return;
    }
    case 'hubsettingsmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const rawLimit = Number(interaction.fields.getTextInputValue('limit'));
      const userLimit = Number.isInteger(rawLimit) ? Math.min(99, Math.max(0, rawLimit)) : 0;
      const rawBitrate = interaction.fields.getTextInputValue('bitrate').trim();
      let bitrate: number | null = null;
      if (rawBitrate) {
        const parsed = Number(rawBitrate);
        bitrate = Number.isFinite(parsed) ? Math.min(384, Math.max(8, Math.round(parsed))) : null;
      }
      const hubs = patchHub(config, params[0] ?? '', { userLimit, bitrate });
      await updateTempvoiceConfig(ctx, guildId, { hubs });
      const hub = hubs.find((candidate) => candidate.channelId === params[0]);
      await interaction.update(
        hub ? renderHubEdit(hub) : renderHubList(ctx, guildId, { ...config, hubs }),
      );
      return;
    }
    case 'hublock': {
      if (!interaction.isButton()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const target = config.hubs.find((candidate) => candidate.channelId === params[0]);
      if (!target) return;
      const hubs = patchHub(config, params[0] ?? '', { lockedByDefault: !target.lockedByDefault });
      await updateTempvoiceConfig(ctx, guildId, { hubs });
      const hub = hubs.find((candidate) => candidate.channelId === params[0]);
      await interaction.update(
        hub ? renderHubEdit(hub) : renderHubList(ctx, guildId, { ...config, hubs }),
      );
      return;
    }
    case 'hubinherit': {
      if (!interaction.isButton()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const target = config.hubs.find((candidate) => candidate.channelId === params[0]);
      if (!target) return;
      const hubs = patchHub(config, params[0] ?? '', {
        inheritPermissions: !target.inheritPermissions,
      });
      await updateTempvoiceConfig(ctx, guildId, { hubs });
      const hub = hubs.find((candidate) => candidate.channelId === params[0]);
      await interaction.update(
        hub ? renderHubEdit(hub) : renderHubList(ctx, guildId, { ...config, hubs }),
      );
      return;
    }
    case 'hubdelete': {
      if (!interaction.isButton()) return;
      const config = await getTempvoiceConfig(ctx, guildId);
      const hubs = config.hubs.filter((hub) => hub.channelId !== params[0]);
      await updateTempvoiceConfig(ctx, guildId, { hubs });
      await interaction.update(
        hubs.length ? renderHubList(ctx, guildId, { ...config, hubs }) : await renderPage(),
      );
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Salons vocaux temporaires ». */
export const tempvoicePanel: ConfigPanel = { render, handle };
