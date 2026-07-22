import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { resolveEmojiInput } from '../../lib/emoji.js';
import { MODULE_NAME, getStarboardConfig, updateStarboardConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getStarboardConfig(ctx, guildId);

  const embed = infoEmbed({
    title: t('modules.starboard.label'),
    description: t('modules.starboard.panel.intro'),
  }).addFields(
    {
      name: t('modules.starboard.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.starboard.panel.notSet'),
      inline: true,
    },
    { name: t('modules.starboard.panel.emojiField'), value: config.emoji, inline: true },
    {
      name: t('modules.starboard.panel.thresholdField'),
      value: String(config.threshold),
      inline: true,
    },
    {
      name: t('modules.starboard.panel.ignoreBotsField'),
      value: config.ignoreBots ? t('modules.starboard.panel.on') : t('modules.starboard.panel.off'),
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.starboard.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'emoji'))
        .setLabel(t('modules.starboard.panel.editEmoji'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'threshold'))
        .setLabel(t('modules.starboard.panel.editThreshold'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'bots'))
        .setLabel(t('modules.starboard.panel.ignoreBotsToggle'))
        .setStyle(config.ignoreBots ? ButtonStyle.Success : ButtonStyle.Secondary),
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
      await updateStarboardConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'emoji': {
      if (!interaction.isButton()) return;
      const config = await getStarboardConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'emojimodal'))
          .setTitle(t('modules.starboard.panel.emojiModal'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('emoji')
                .setLabel(t('modules.starboard.panel.emojiField'))
                .setStyle(TextInputStyle.Short)
                .setMaxLength(64)
                .setRequired(true)
                .setValue(config.emoji)
                .setPlaceholder('⭐ ou :nom:'),
            ),
          ),
      );
      return;
    }
    case 'emojimodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const input = interaction.fields.getTextInputValue('emoji');
      const emoji = interaction.guild ? resolveEmojiInput(input, interaction.guild) : input.trim();
      await updateStarboardConfig(ctx, guildId, { emoji: emoji || '⭐' });
      await interaction.update(await renderPage());
      return;
    }
    case 'threshold': {
      if (!interaction.isButton()) return;
      const config = await getStarboardConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'thresholdmodal'))
          .setTitle(t('modules.starboard.panel.thresholdModal'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('threshold')
                .setLabel(t('modules.starboard.panel.thresholdField'))
                .setStyle(TextInputStyle.Short)
                .setMaxLength(3)
                .setRequired(true)
                .setValue(String(config.threshold))
                .setPlaceholder('3'),
            ),
          ),
      );
      return;
    }
    case 'thresholdmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const value = Number(interaction.fields.getTextInputValue('threshold'));
      const threshold = Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : 3;
      await updateStarboardConfig(ctx, guildId, { threshold });
      await interaction.update(await renderPage());
      return;
    }
    case 'bots': {
      if (!interaction.isButton()) return;
      const config = await getStarboardConfig(ctx, guildId);
      await updateStarboardConfig(ctx, guildId, { ignoreBots: !config.ignoreBots });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Starboard ». */
export const starboardPanel: ConfigPanel = { render, handle };
