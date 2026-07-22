import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getModerationConfig, updateModerationConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getModerationConfig(ctx, guildId);

  const embed = infoEmbed({
    title: t('modules.moderation.label'),
    description: t('modules.moderation.panel.intro'),
  }).addFields(
    {
      name: t('modules.moderation.panel.logChannel'),
      value: config.logChannelId
        ? `<#${config.logChannelId}>`
        : t('modules.moderation.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.moderation.panel.dm'),
      value: config.dmOnSanction
        ? t('modules.moderation.panel.on')
        : t('modules.moderation.panel.off'),
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'logchan'))
        .setPlaceholder(t('modules.moderation.panel.logPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'dm'))
        .setLabel(t('modules.moderation.panel.dmToggle'))
        .setStyle(config.dmOnSanction ? ButtonStyle.Success : ButtonStyle.Secondary),
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
  if (action === 'logchan') {
    if (!interaction.isChannelSelectMenu()) return;
    await updateModerationConfig(ctx, guildId, { logChannelId: interaction.values[0] ?? null });
    await interaction.update(await renderPage());
    return;
  }
  if (action === 'dm') {
    if (!interaction.isButton()) return;
    const config = await getModerationConfig(ctx, guildId);
    await updateModerationConfig(ctx, guildId, { dmOnSanction: !config.dmOnSanction });
    await interaction.update(await renderPage());
  }
}

/** Panneau de configuration interactif du module « Modération ». */
export const moderationPanel: ConfigPanel = { render, handle };
