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
import { MODULE_NAME, getGiveawaysConfig, updateGiveawaysConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getGiveawaysConfig(ctx, guildId);

  const embed = infoEmbed({
    title: t('modules.giveaways.label'),
    description: t('modules.giveaways.panel.intro'),
  }).addFields(
    {
      name: t('modules.giveaways.panel.logField'),
      value: config.logChannelId
        ? `<#${config.logChannelId}>`
        : t('modules.giveaways.panel.logOff'),
      inline: true,
    },
    { name: t('modules.giveaways.panel.winField'), value: truncate(config.winMessage) },
    { name: t('modules.giveaways.panel.noWinField'), value: truncate(config.noWinnerMessage) },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'logchan'))
        .setPlaceholder(t('modules.giveaways.panel.logPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'winmsg'))
        .setLabel(t('modules.giveaways.panel.editWin'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'nowinmsg'))
        .setLabel(t('modules.giveaways.panel.editNoWin'))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, components };
}

function messageModal(action: string, title: string, value: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, action))
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel(t('modules.giveaways.panel.messageField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1500)
          .setRequired(true)
          .setValue(value)
          .setPlaceholder('{winners} · {prize}'),
      ),
    );
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'logchan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateGiveawaysConfig(ctx, guildId, { logChannelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'winmsg': {
      if (!interaction.isButton()) return;
      const config = await getGiveawaysConfig(ctx, guildId);
      await interaction.showModal(
        messageModal('winmsgmodal', t('modules.giveaways.panel.winModal'), config.winMessage),
      );
      return;
    }
    case 'winmsgmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateGiveawaysConfig(ctx, guildId, {
        winMessage: interaction.fields.getTextInputValue('message'),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'nowinmsg': {
      if (!interaction.isButton()) return;
      const config = await getGiveawaysConfig(ctx, guildId);
      await interaction.showModal(
        messageModal(
          'nowinmsgmodal',
          t('modules.giveaways.panel.noWinModal'),
          config.noWinnerMessage,
        ),
      );
      return;
    }
    case 'nowinmsgmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateGiveawaysConfig(ctx, guildId, {
        noWinnerMessage: interaction.fields.getTextInputValue('message'),
      });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Giveaways ». */
export const giveawaysPanel: ConfigPanel = { render, handle };
