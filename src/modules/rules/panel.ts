import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getRulesConfig, updateRulesConfig } from './config.js';
import { countUpToDate, publishRules } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textModal(title: string, content: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'textmodal'))
    .setTitle(t('modules.rules.panel.textModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(t('modules.rules.panel.titleField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(true)
          .setValue(title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('content')
          .setLabel(t('modules.rules.panel.contentField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true)
          .setValue(content),
      ),
    );
}

function buttonModal(label: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'btnmodal'))
    .setTitle(t('modules.rules.panel.buttonModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel(t('modules.rules.panel.buttonField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true)
          .setValue(label),
      ),
    );
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getRulesConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);

  const me = guild?.members.me ?? null;
  const canManageRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;
  const role = config.roleId ? guild?.roles.cache.get(config.roleId) : null;
  const roleAssignable =
    !config.roleId ||
    (canManageRoles && !!role && role.position < (me?.roles.highest.position ?? 0));

  const accepted = await countUpToDate(ctx, guildId, config.version);

  const embed = infoEmbed({
    title: t('modules.rules.label'),
    description: t('modules.rules.panel.intro'),
  }).addFields(
    {
      name: t('modules.rules.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.rules.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.rules.panel.roleField'),
      value: config.roleId
        ? `<@&${config.roleId}>${roleAssignable ? '' : ' ⚠️'}`
        : t('modules.rules.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.rules.panel.statusField'),
      value: config.messageId
        ? t('modules.rules.panel.published')
        : t('modules.rules.panel.notPublished'),
      inline: true,
    },
    {
      name: t('modules.rules.panel.versionField'),
      value: t('modules.rules.panel.versionValue', { version: config.version, count: accepted }),
      inline: true,
    },
    {
      name: t('modules.rules.panel.logField'),
      value: config.logChannelId ? `<#${config.logChannelId}>` : t('modules.rules.panel.notSet'),
      inline: true,
    },
    { name: t('modules.rules.panel.previewField'), value: truncate(config.content) },
  );

  if (!roleAssignable) {
    embed.addFields({ name: '⚠️', value: t('modules.rules.panel.roleWarning') });
  }

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.rules.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'role'))
        .setPlaceholder(t('modules.rules.panel.rolePlaceholder'))
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'logchan'))
        .setPlaceholder(t('modules.rules.panel.logPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'text'))
        .setLabel(t('modules.rules.panel.editText'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'btn'))
        .setLabel(t('modules.rules.panel.editButton'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'revalidate'))
        .setLabel(t('modules.rules.panel.revalidate'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'publish'))
        .setLabel(t('modules.rules.panel.publish'))
        .setStyle(ButtonStyle.Success),
    ),
  ];

  return { embed, components };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateRulesConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateRulesConfig(ctx, guildId, { roleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'logchan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateRulesConfig(ctx, guildId, { logChannelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'text': {
      if (!interaction.isButton()) return;
      const config = await getRulesConfig(ctx, guildId);
      await interaction.showModal(textModal(config.title, config.content));
      return;
    }
    case 'textmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateRulesConfig(ctx, guildId, {
        title: interaction.fields.getTextInputValue('title'),
        content: interaction.fields.getTextInputValue('content'),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'btn': {
      if (!interaction.isButton()) return;
      const config = await getRulesConfig(ctx, guildId);
      await interaction.showModal(buttonModal(config.buttonLabel));
      return;
    }
    case 'btnmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const label = interaction.fields.getTextInputValue('label').trim();
      await updateRulesConfig(ctx, guildId, { buttonLabel: label || "✅ J'accepte le règlement" });
      await interaction.update(await renderPage());
      return;
    }
    case 'revalidate': {
      if (!interaction.isButton()) return;
      const config = await getRulesConfig(ctx, guildId);
      await updateRulesConfig(ctx, guildId, { version: config.version + 1 });
      // Le panneau (éphémère) est rafraîchi en place : le champ « Version »
      // reflète la nouvelle version, les membres devront ré-accepter.
      await interaction.update(await renderPage());
      return;
    }
    case 'publish': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const config = await getRulesConfig(ctx, guildId);
      const result = await publishRules(interaction.guild, config);
      if (!result.ok) {
        await interaction.reply({
          content: t(`modules.rules.panel.publishError.${result.error}`),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateRulesConfig(ctx, guildId, { messageId: result.messageId });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Règlement ». */
export const rulesPanel: ConfigPanel = { render, handle };
