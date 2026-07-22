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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getReactionRolesConfig, updateReactionRolesConfig } from './config.js';
import { publishMenu, resolveEmojiInput } from './menu.js';

const MAX_ROLES = 25;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

/** Regroupe des lignes en blocs respectant la limite de longueur d'un message. */
function chunkLines(lines: string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function roleModal(roleId: string, defaultLabel: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'rolemodal', roleId))
    .setTitle(t('modules.reactionroles.panel.roleModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel(t('modules.reactionroles.panel.labelField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true)
          .setValue(defaultLabel.slice(0, 80)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('emoji')
          .setLabel(t('modules.reactionroles.panel.emojiField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(64)
          .setRequired(false)
          .setPlaceholder('😀 ou :nom:'),
      ),
    );
}

function textModal(title: string, description: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'textmodal'))
    .setTitle(t('modules.reactionroles.panel.textModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(t('modules.reactionroles.panel.titleField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(true)
          .setValue(title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(t('modules.reactionroles.panel.descriptionField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
          .setValue(description),
      ),
    );
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getReactionRolesConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);

  const me = guild?.members.me ?? null;
  const botHighest = me?.roles.highest.position ?? 0;
  const canManageRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;

  let hasUnassignable = false;
  let hasNoEmoji = false;
  const rolesText = config.roles.length
    ? config.roles
        .map((r) => {
          const role = guild?.roles.cache.get(r.roleId);
          const assignable = canManageRoles && !!role && role.position < botHighest;
          if (!assignable) hasUnassignable = true;
          if (!r.emoji) hasNoEmoji = true;
          const emoji = r.emoji ? `${r.emoji} ` : '';
          const flag = !assignable ? ' ⚠️' : !r.emoji ? ' ❓' : '';
          return `${emoji}**${r.label}** → <@&${r.roleId}>${flag}`;
        })
        .join('\n')
    : t('modules.reactionroles.panel.noRoles');

  const embed = infoEmbed({
    title: t('modules.reactionroles.label'),
    description: t('modules.reactionroles.panel.intro'),
  }).addFields(
    {
      name: t('modules.reactionroles.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.reactionroles.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.reactionroles.panel.statusField'),
      value: config.messageId
        ? t('modules.reactionroles.panel.published')
        : t('modules.reactionroles.panel.notPublished'),
      inline: true,
    },
    { name: t('modules.reactionroles.panel.rolesField'), value: rolesText },
  );

  if (hasUnassignable) {
    embed.addFields({ name: '⚠️', value: t('modules.reactionroles.panel.roleWarning') });
  }
  if (hasNoEmoji) {
    embed.addFields({ name: '❓', value: t('modules.reactionroles.panel.emojiWarning') });
  }

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.reactionroles.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'addrole'))
        .setPlaceholder(t('modules.reactionroles.panel.addRole'))
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (config.roles.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'removerole'))
          .setPlaceholder(t('modules.reactionroles.panel.removeRole'))
          .addOptions(
            config.roles
              .slice(0, 25)
              .map((r) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(r.label.slice(0, 100))
                  .setValue(r.roleId),
              ),
          ),
      ),
    );
  }

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'text'))
        .setLabel(t('modules.reactionroles.panel.editText'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'emojis'))
        .setLabel(t('modules.reactionroles.panel.emojisButton'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'publish'))
        .setLabel(t('modules.reactionroles.panel.publish'))
        .setStyle(ButtonStyle.Success),
    ),
  );

  return { embed, components };
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
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateReactionRolesConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'addrole': {
      if (!interaction.isRoleSelectMenu()) return;
      const roleId = interaction.values[0];
      if (!roleId) return;
      const defaultLabel = interaction.guild?.roles.cache.get(roleId)?.name ?? '';
      await interaction.showModal(roleModal(roleId, defaultLabel));
      return;
    }
    case 'rolemodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const roleId = params[0];
      if (!roleId) return;
      const config = await getReactionRolesConfig(ctx, guildId);
      const roles = config.roles.filter((r) => r.roleId !== roleId);
      if (roles.length >= MAX_ROLES) {
        await interaction.reply({
          content: t('modules.reactionroles.panel.tooMany', { max: MAX_ROLES }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const emojiInput = interaction.fields.getTextInputValue('emoji');
      roles.push({
        roleId,
        label: interaction.fields.getTextInputValue('label').trim() || roleId,
        emoji: interaction.guild
          ? resolveEmojiInput(emojiInput, interaction.guild)
          : emojiInput.trim(),
      });
      await updateReactionRolesConfig(ctx, guildId, { roles });
      await interaction.update(await renderPage());
      return;
    }
    case 'emojis': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const emojis = interaction.guild.emojis.cache;
      if (emojis.size === 0) {
        await interaction.reply({
          content: t('modules.reactionroles.panel.noEmojis'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const lines = [...emojis.values()].map(
        (emoji) => `${emoji.toString()} \`${emoji.name ? `:${emoji.name}:` : emoji.toString()}\``,
      );
      const chunks = chunkLines([t('modules.reactionroles.panel.emojiList'), ...lines], 1900);
      await interaction.reply({
        content: chunks[0] ?? t('modules.reactionroles.panel.emojiList'),
        flags: MessageFlags.Ephemeral,
      });
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    case 'removerole': {
      if (!interaction.isStringSelectMenu()) return;
      const roleId = interaction.values[0];
      const config = await getReactionRolesConfig(ctx, guildId);
      await updateReactionRolesConfig(ctx, guildId, {
        roles: config.roles.filter((r) => r.roleId !== roleId),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'text': {
      if (!interaction.isButton()) return;
      const config = await getReactionRolesConfig(ctx, guildId);
      await interaction.showModal(textModal(config.title, config.description));
      return;
    }
    case 'textmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateReactionRolesConfig(ctx, guildId, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'publish': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const config = await getReactionRolesConfig(ctx, guildId);
      const result = await publishMenu(interaction.guild, config, ctx.logger);
      if (!result.ok) {
        await interaction.reply({
          content: t(`modules.reactionroles.panel.publishError.${result.error}`),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateReactionRolesConfig(ctx, guildId, { messageId: result.messageId });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Rôles-réactions ». */
export const reactionRolesPanel: ConfigPanel = { render, handle };
