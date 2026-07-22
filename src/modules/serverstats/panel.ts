import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
  type Guild,
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
  COUNTER_TYPES,
  type CounterType,
  MODULE_NAME,
  type ServerCounter,
  type ServerstatsConfig,
  getServerstatsConfig,
  updateServerstatsConfig,
} from './config.js';
import { defaultTemplateFor, refreshCounter } from './service.js';

const MAX_COUNTERS = 20;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function typeLabel(type: CounterType): string {
  return t(`modules.serverstats.type.${type}`);
}

function counterLine(counter: ServerCounter): string {
  return `<#${counter.channelId}> — **${typeLabel(counter.type)}** · \`${counter.template}\``;
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getServerstatsConfig(ctx, guildId);

  const list = config.counters.length
    ? config.counters.map(counterLine).join('\n')
    : t('modules.serverstats.panel.noCounters');

  const embed = infoEmbed({
    title: t('modules.serverstats.label'),
    description: t('modules.serverstats.panel.intro'),
  }).addFields({ name: t('modules.serverstats.panel.countersField'), value: list.slice(0, 1024) });

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add'))
        .setPlaceholder(t('modules.serverstats.panel.addPlaceholder'))
        .addChannelTypes(
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildCategory,
        )
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
        .setLabel(t('modules.serverstats.panel.manage'))
        .setStyle(ButtonStyle.Primary),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages -------------------------------------------------------------

function renderList(config: ServerstatsConfig): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.serverstats.panel.listTitle'),
    description: t('modules.serverstats.panel.listIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
    .setPlaceholder(t('modules.serverstats.panel.pickPlaceholder'))
    .addOptions(
      config.counters.map((counter) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${typeLabel(counter.type)}`.slice(0, 100))
          .setValue(counter.id)
          .setDescription(counter.template.slice(0, 100)),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.serverstats.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderEdit(counter: ServerCounter): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.serverstats.panel.editTitle'),
    description: t('modules.serverstats.panel.editIntro'),
  }).addFields(
    {
      name: t('modules.serverstats.panel.channelField'),
      value: `<#${counter.channelId}>`,
      inline: true,
    },
    {
      name: t('modules.serverstats.panel.typeField'),
      value: typeLabel(counter.type),
      inline: true,
    },
    { name: t('modules.serverstats.panel.templateField'), value: `\`${counter.template}\`` },
    ...(counter.type === 'role'
      ? [
          {
            name: t('modules.serverstats.panel.roleField'),
            value: counter.roleId ? `<@&${counter.roleId}>` : t('modules.serverstats.panel.noRole'),
          },
        ]
      : []),
  );

  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'type', counter.id))
    .setPlaceholder(t('modules.serverstats.panel.typePlaceholder'))
    .addOptions(
      COUNTER_TYPES.map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(typeLabel(type))
          .setValue(type)
          .setDefault(type === counter.type),
      ),
    );

  const components: PanelRow[] = [row().addComponents(typeSelect)];

  if (counter.type === 'role') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'crole', counter.id))
      .setPlaceholder(t('modules.serverstats.panel.rolePlaceholder'))
      .setMinValues(0)
      .setMaxValues(1);
    if (counter.roleId) roleSelect.setDefaultRoles([counter.roleId]);
    components.push(row().addComponents(roleSelect));
  }

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'ctmpl', counter.id))
        .setLabel(t('modules.serverstats.panel.editTemplate'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'cdelete', counter.id))
        .setLabel(t('modules.serverstats.panel.delete'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
        .setLabel(t('modules.serverstats.panel.back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

function templateModal(counter: ServerCounter): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'ctmplmodal', counter.id))
    .setTitle(t('modules.serverstats.panel.templateTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('template')
          .setLabel(t('modules.serverstats.panel.templateInput'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setValue(counter.template)
          .setPlaceholder('👥 {count} membres'),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

function patchCounter(
  config: ServerstatsConfig,
  id: string,
  patch: Partial<ServerCounter>,
): ServerCounter[] {
  return config.counters.map((counter) => (counter.id === id ? { ...counter, ...patch } : counter));
}

/**
 * Rafraîchit le compteur en arrière-plan (jamais attendu par le gestionnaire
 * d'interaction). Le fetch des membres et surtout le renommage — limité par
 * Discord à 2 par 10 min et donc potentiellement mis en file plusieurs minutes —
 * ne doivent jamais bloquer ni faire échouer l'interaction.
 */
function live(ctx: BotContext, guild: Guild | null, counter: ServerCounter | undefined): void {
  if (guild && counter) void refreshCounter(ctx, guild, counter).catch(() => undefined);
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  const guild = interaction.inCachedGuild() ? interaction.guild : null;

  switch (action) {
    case 'add': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      const config = await getServerstatsConfig(ctx, guildId);
      if (!channelId || config.counters.length >= MAX_COUNTERS) {
        await interaction.update(await renderPage());
        return;
      }
      const counter: ServerCounter = {
        id: randomUUID().slice(0, 8),
        channelId,
        type: 'members',
        roleId: null,
        template: defaultTemplateFor('members'),
      };
      await updateServerstatsConfig(ctx, guildId, { counters: [...config.counters, counter] });
      // On acquitte l'interaction AVANT le refresh (fetch des membres + renommage
      // peuvent dépasser la limite de 3 s et provoquer « This interaction failed »).
      await interaction.update(renderEdit(counter));
      live(ctx, guild, counter);
      return;
    }
    case 'manage': {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      if (config.counters.length === 0) {
        // Sans compteur, la liste serait un menu vide (rejeté par Discord) : on
        // donne un retour explicite plutôt que de sembler « ne rien faire ».
        await interaction.reply({
          content: t('modules.serverstats.panel.noCountersYet'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update(renderList(config));
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'pick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      const counter = config.counters.find((candidate) => candidate.id === interaction.values[0]);
      await interaction.update(counter ? renderEdit(counter) : renderList(config));
      return;
    }
    case 'type': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      const current = config.counters.find((candidate) => candidate.id === params[0]);
      const newType = interaction.values[0] as CounterType;
      // Si le gabarit est resté celui par défaut de l'ancien type, on l'adapte.
      const template =
        current && current.template === defaultTemplateFor(current.type)
          ? defaultTemplateFor(newType)
          : (current?.template ?? defaultTemplateFor(newType));
      const counters = patchCounter(config, params[0] ?? '', { type: newType, template });
      await updateServerstatsConfig(ctx, guildId, { counters });
      const counter = counters.find((candidate) => candidate.id === params[0]);
      await interaction.update(counter ? renderEdit(counter) : renderList({ ...config, counters }));
      live(ctx, guild, counter);
      return;
    }
    case 'crole': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      const counters = patchCounter(config, params[0] ?? '', {
        roleId: interaction.values[0] ?? null,
      });
      await updateServerstatsConfig(ctx, guildId, { counters });
      const counter = counters.find((candidate) => candidate.id === params[0]);
      await interaction.update(counter ? renderEdit(counter) : renderList({ ...config, counters }));
      live(ctx, guild, counter);
      return;
    }
    case 'ctmpl': {
      if (!interaction.isButton()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      const counter = config.counters.find((candidate) => candidate.id === params[0]);
      if (!counter) {
        await interaction.update(renderList(config));
        return;
      }
      await interaction.showModal(templateModal(counter));
      return;
    }
    case 'ctmplmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      const value = interaction.fields.getTextInputValue('template').trim() || '{count}';
      const template = value.includes('{count}') ? value : `${value} {count}`;
      const counters = patchCounter(config, params[0] ?? '', { template: template.slice(0, 100) });
      await updateServerstatsConfig(ctx, guildId, { counters });
      const counter = counters.find((candidate) => candidate.id === params[0]);
      await interaction.update(counter ? renderEdit(counter) : renderList({ ...config, counters }));
      live(ctx, guild, counter);
      return;
    }
    case 'cdelete': {
      if (!interaction.isButton()) return;
      const config = await getServerstatsConfig(ctx, guildId);
      const counters = config.counters.filter((counter) => counter.id !== params[0]);
      await updateServerstatsConfig(ctx, guildId, { counters });
      await interaction.update(
        counters.length ? renderList({ ...config, counters }) : await renderPage(),
      );
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Compteurs de serveur ». */
export const serverstatsPanel: ConfigPanel = { render, handle };
