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
import { MODULE_NAME, getStreamerConfig, updateStreamerConfig } from './config.js';
import { publishStreamer } from './menu.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function textModal(title: string, description: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'textmodal'))
    .setTitle(t('modules.streamer.panel.textModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(t('modules.streamer.panel.titleField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(true)
          .setValue(title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(t('modules.streamer.panel.descriptionField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
          .setValue(description),
      ),
    );
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getStreamerConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);
  const me = guild?.members.me ?? null;
  const botHighest = me?.roles.highest.position ?? 0;
  const canDeafen = me?.permissions.has(PermissionFlagsBits.DeafenMembers) ?? false;
  const canManageRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;

  const role = config.roleId ? (guild?.roles.cache.get(config.roleId) ?? null) : null;
  const roleAssignable = canManageRoles && !!role && role.position < botHighest;
  const roleText = config.roleId
    ? `<@&${config.roleId}>${roleAssignable ? '' : ' ⚠️'}`
    : t('modules.streamer.panel.notSet');

  const embed = infoEmbed({
    title: t('modules.streamer.label'),
    description: t('modules.streamer.panel.intro'),
  }).addFields(
    { name: t('modules.streamer.panel.roleField'), value: roleText, inline: true },
    {
      name: t('modules.streamer.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.streamer.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.streamer.panel.statusField'),
      value: config.messageId
        ? t('modules.streamer.panel.published')
        : t('modules.streamer.panel.notPublished'),
      inline: true,
    },
  );

  if (!canDeafen || (config.roleId && !roleAssignable)) {
    embed.addFields({ name: '⚠️', value: t('modules.streamer.panel.warning') });
  }

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'role'))
    .setPlaceholder(t('modules.streamer.panel.rolePlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  if (role) roleSelect.setDefaultRoles(role.id);

  const components: PanelRow[] = [
    row().addComponents(roleSelect),
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.streamer.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'text'))
        .setLabel(t('modules.streamer.panel.editText'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'publish'))
        .setLabel(t('modules.streamer.panel.publish'))
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
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateStreamerConfig(ctx, guildId, { roleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateStreamerConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'text': {
      if (!interaction.isButton()) return;
      const config = await getStreamerConfig(ctx, guildId);
      await interaction.showModal(textModal(config.title, config.description));
      return;
    }
    case 'textmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateStreamerConfig(ctx, guildId, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'publish': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const config = await getStreamerConfig(ctx, guildId);
      const result = await publishStreamer(interaction.guild, config);
      if (!result.ok) {
        await interaction.reply({
          content: t(`modules.streamer.panel.publishError.${result.error}`),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateStreamerConfig(ctx, guildId, { messageId: result.messageId });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Mode streameur ». */
export const streamerPanel: ConfigPanel = { render, handle };
