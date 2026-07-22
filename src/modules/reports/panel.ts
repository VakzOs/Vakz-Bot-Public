import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getReportsConfig, updateReportsConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getReportsConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.reports.label'),
    description: t('modules.reports.panel.intro'),
  }).addFields(
    {
      name: t('modules.reports.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.reports.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.reports.panel.staffField'),
      value: config.staffRoleId
        ? `<@&${config.staffRoleId}>`
        : t('modules.reports.panel.staffDefault'),
      inline: true,
    },
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'channel'))
    .setPlaceholder(t('modules.reports.panel.channelPlaceholder'))
    .addChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (config.channelId) channelSelect.setDefaultChannels([config.channelId]);

  const staffSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'staff'))
    .setPlaceholder(t('modules.reports.panel.staffPlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  if (config.staffRoleId) staffSelect.setDefaultRoles([config.staffRoleId]);

  return {
    embed,
    components: [row().addComponents(channelSelect), row().addComponents(staffSelect)],
  };
}

async function handle({ interaction, ctx, guildId, action, renderPage }: PanelHandlerArgs) {
  if (action === 'channel') {
    if (!interaction.isChannelSelectMenu()) return;
    await updateReportsConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'staff') {
    if (!interaction.isRoleSelectMenu()) return;
    await updateReportsConfig(ctx, guildId, { staffRoleId: interaction.values[0] ?? null });
    await interaction.update(await renderPage());
  }
}

export const reportsPanel: ConfigPanel = { render, handle };
