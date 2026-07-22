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
import { resolveEmojiInput } from '../../lib/emoji.js';
import {
  MODULE_NAME,
  type TicketsConfig,
  type TicketType,
  getTicketsConfig,
  updateTicketsConfig,
} from './config.js';
import { publishPanel } from './service.js';

const MAX_TYPES = 25;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function typeRolesLabel(type: TicketType): string {
  return type.roleIds.length
    ? type.roleIds.map((id) => `<@&${id}>`).join(' ')
    : t('modules.tickets.panel.typeNoRoles');
}

// --- Page de base -----------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getTicketsConfig(ctx, guildId);

  const typesList = config.types.length
    ? config.types
        .map(
          (type) =>
            `${type.emoji ? `${type.emoji} ` : ''}**${type.label}** — ${typeRolesLabel(type)}`,
        )
        .join('\n')
    : t('modules.tickets.panel.noTypes');

  const embed = infoEmbed({
    title: t('modules.tickets.label'),
    description: t('modules.tickets.panel.intro'),
  }).addFields(
    {
      name: t('modules.tickets.panel.channelField'),
      value: config.panelChannelId
        ? `<#${config.panelChannelId}>`
        : t('modules.tickets.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.tickets.panel.categoryField'),
      value: config.categoryId ? `<#${config.categoryId}>` : t('modules.tickets.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.tickets.panel.archiveField'),
      value: config.archiveChannelId
        ? `<#${config.archiveChannelId}>`
        : t('modules.tickets.panel.archiveOff'),
      inline: true,
    },
    {
      name: t('modules.tickets.panel.statusField'),
      value: config.messageId
        ? t('modules.tickets.panel.published')
        : t('modules.tickets.panel.notPublished'),
      inline: true,
    },
    { name: t('modules.tickets.panel.maxField'), value: String(config.maxOpen), inline: true },
    {
      name: t('modules.tickets.panel.modeField'),
      value:
        config.mode === 'thread'
          ? t('modules.tickets.panel.modeThread')
          : t('modules.tickets.panel.modeChannel'),
      inline: true,
    },
    {
      name: t('modules.tickets.panel.nameFormatField'),
      value: `\`${config.nameFormat}\``,
      inline: true,
    },
    { name: t('modules.tickets.panel.typesField'), value: truncate(typesList, 1000) },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.tickets.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'category'))
        .setPlaceholder(t('modules.tickets.panel.categoryPlaceholder'))
        .addChannelTypes(ChannelType.GuildCategory)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'archive'))
        .setPlaceholder(t('modules.tickets.panel.archivePlaceholder'))
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'addtype'))
        .setLabel(t('modules.tickets.panel.addType'))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'types'))
        .setLabel(t('modules.tickets.panel.manageTypes'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'mode'))
        .setLabel(
          config.mode === 'thread'
            ? t('modules.tickets.panel.modeThreadBtn')
            : t('modules.tickets.panel.modeChannelBtn'),
        )
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'settings'))
        .setLabel(t('modules.tickets.panel.settings'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'publish'))
        .setLabel(t('modules.tickets.panel.publish'))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages de gestion des types ---------------------------------------

function renderTypeList(config: TicketsConfig): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.tickets.panel.typeListTitle'),
    description: t('modules.tickets.panel.typeListIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'typepick'))
    .setPlaceholder(t('modules.tickets.panel.typePickPlaceholder'))
    .addOptions(
      config.types.map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(type.label.slice(0, 100))
          .setValue(type.id)
          .setDescription(truncate(typeRolesLabel(type), 100)),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.tickets.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderTypeEdit(type: TicketType): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.tickets.panel.typeEditTitle', { label: type.label }),
    description: t('modules.tickets.panel.typeEditIntro'),
  }).addFields(
    {
      name: t('modules.tickets.panel.typePrefixField'),
      value: type.prefix.trim()
        ? `\`${type.prefix.trim()}-0001\``
        : t('modules.tickets.panel.typePrefixNone'),
      inline: true,
    },
    { name: t('modules.tickets.panel.typeRolesField'), value: typeRolesLabel(type), inline: false },
  );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'typeroles', type.id))
    .setPlaceholder(t('modules.tickets.panel.typeRolesPlaceholder'))
    .setMinValues(0)
    .setMaxValues(20);
  if (type.roleIds.length) roleSelect.setDefaultRoles(type.roleIds);

  return {
    embeds: [embed],
    components: [
      row().addComponents(roleSelect),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'typerename', type.id))
          .setLabel(t('modules.tickets.panel.typeRename'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'typedelete', type.id))
          .setLabel(t('modules.tickets.panel.typeDelete'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'types'))
          .setLabel(t('modules.tickets.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function typeModal(action: string, type?: TicketType): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, action, type?.id ?? ''))
    .setTitle(t('modules.tickets.panel.typeModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel(t('modules.tickets.panel.typeLabelField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true)
          .setValue(type?.label ?? ''),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('emoji')
          .setLabel(t('modules.tickets.panel.typeEmojiField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(64)
          .setRequired(false)
          .setValue(type?.emoji ?? '')
          .setPlaceholder('🛠️ ou :nom:'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('prefix')
          .setLabel(t('modules.tickets.panel.typePrefixField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(20)
          .setRequired(false)
          .setValue(type?.prefix ?? '')
          .setPlaceholder('Sup → sup-0001'),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateTicketsConfig(ctx, guildId, { panelChannelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'category': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateTicketsConfig(ctx, guildId, { categoryId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'archive': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateTicketsConfig(ctx, guildId, { archiveChannelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'addtype': {
      if (!interaction.isButton()) return;
      const config = await getTicketsConfig(ctx, guildId);
      if (config.types.length >= MAX_TYPES) {
        await interaction.reply({
          content: t('modules.tickets.panel.tooManyTypes', { max: MAX_TYPES }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(typeModal('addtypemodal'));
      return;
    }
    case 'addtypemodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const label = interaction.fields.getTextInputValue('label').trim();
      const emojiInput = interaction.fields.getTextInputValue('emoji');
      const emoji = interaction.guild
        ? resolveEmojiInput(emojiInput, interaction.guild)
        : emojiInput.trim();
      const prefix = interaction.fields.getTextInputValue('prefix').trim();
      const types = [
        ...config.types,
        { id: randomUUID().slice(0, 8), label, emoji, prefix, roleIds: [] },
      ];
      await updateTicketsConfig(ctx, guildId, { types });
      await interaction.update(await renderPage());
      return;
    }
    case 'types': {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      const config = await getTicketsConfig(ctx, guildId);
      if (config.types.length === 0) {
        await interaction.reply({
          content: t('modules.tickets.panel.noTypesYet'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update(renderTypeList(config));
      return;
    }
    case 'typepick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const type = config.types.find((candidate) => candidate.id === interaction.values[0]);
      if (!type) {
        await interaction.update(renderTypeList(config));
        return;
      }
      await interaction.update(renderTypeEdit(type));
      return;
    }
    case 'typeroles': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const typeId = params[0];
      const types = config.types.map((type) =>
        type.id === typeId ? { ...type, roleIds: [...interaction.values] } : type,
      );
      await updateTicketsConfig(ctx, guildId, { types });
      const updated = types.find((type) => type.id === typeId);
      await interaction.update(
        updated ? renderTypeEdit(updated) : renderTypeList({ ...config, types }),
      );
      return;
    }
    case 'typerename': {
      if (!interaction.isButton()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const type = config.types.find((candidate) => candidate.id === params[0]);
      if (!type) return;
      await interaction.showModal(typeModal('typenamemodal', type));
      return;
    }
    case 'typenamemodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const typeId = params[0];
      const label = interaction.fields.getTextInputValue('label').trim();
      const emojiInput = interaction.fields.getTextInputValue('emoji');
      const emoji = interaction.guild
        ? resolveEmojiInput(emojiInput, interaction.guild)
        : emojiInput.trim();
      const prefix = interaction.fields.getTextInputValue('prefix').trim();
      const types = config.types.map((type) =>
        type.id === typeId ? { ...type, label: label || type.label, emoji, prefix } : type,
      );
      await updateTicketsConfig(ctx, guildId, { types });
      const updated = types.find((type) => type.id === typeId);
      await interaction.update(
        updated ? renderTypeEdit(updated) : renderTypeList({ ...config, types }),
      );
      return;
    }
    case 'typedelete': {
      if (!interaction.isButton()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const types = config.types.filter((type) => type.id !== params[0]);
      await updateTicketsConfig(ctx, guildId, { types });
      const next = { ...config, types };
      await interaction.update(types.length ? renderTypeList(next) : await renderPage());
      return;
    }
    case 'settings': {
      if (!interaction.isButton()) return;
      const config = await getTicketsConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'settingsmodal'))
          .setTitle(t('modules.tickets.panel.settingsTitle'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('title')
                .setLabel(t('modules.tickets.panel.titleField'))
                .setStyle(TextInputStyle.Short)
                .setMaxLength(256)
                .setRequired(true)
                .setValue(config.title),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('description')
                .setLabel(t('modules.tickets.panel.descField'))
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(2000)
                .setRequired(true)
                .setValue(config.description),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('max')
                .setLabel(t('modules.tickets.panel.maxField'))
                .setStyle(TextInputStyle.Short)
                .setMaxLength(2)
                .setRequired(true)
                .setValue(String(config.maxOpen)),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('nameFormat')
                .setLabel(t('modules.tickets.panel.nameFormatField'))
                .setStyle(TextInputStyle.Short)
                .setMaxLength(60)
                .setRequired(true)
                .setValue(config.nameFormat)
                .setPlaceholder('{type}-{number}'),
            ),
          ),
      );
      return;
    }
    case 'settingsmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const value = Number(interaction.fields.getTextInputValue('max'));
      const maxOpen = Number.isInteger(value) ? Math.min(10, Math.max(1, value)) : 1;
      const nameFormat =
        interaction.fields.getTextInputValue('nameFormat').trim() || '{type}-{number}';
      await updateTicketsConfig(ctx, guildId, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        maxOpen,
        nameFormat,
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'mode': {
      if (!interaction.isButton()) return;
      const config = await getTicketsConfig(ctx, guildId);
      await updateTicketsConfig(ctx, guildId, {
        mode: config.mode === 'thread' ? 'channel' : 'thread',
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'publish': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const config = await getTicketsConfig(ctx, guildId);
      const result = await publishPanel(interaction.guild, config);
      if (!result.ok) {
        await interaction.reply({
          content: t(`modules.tickets.panel.publishError.${result.error}`),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateTicketsConfig(ctx, guildId, { messageId: result.messageId });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Tickets ». */
export const ticketsPanel: ConfigPanel = { render, handle };
