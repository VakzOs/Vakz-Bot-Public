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
import { MODULE_NAME, type LogCategory, getLogsConfig, updateLogsConfig } from './config.js';

const CATEGORIES: LogCategory[] = ['messages', 'members', 'channels', 'roles', 'moderation'];

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function status(value: boolean): string {
  return value ? t('modules.logs.panel.on') : t('modules.logs.panel.off');
}

function categoryButton(category: LogCategory, enabled: boolean): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'toggle', category))
    .setLabel(t(`modules.logs.panel.categories.${category}`))
    .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getLogsConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.logs.label'),
    description: t('modules.logs.panel.intro'),
  }).addFields(
    {
      name: t('modules.logs.panel.channelField'),
      value: config.logChannelId ? `<#${config.logChannelId}>` : t('modules.logs.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.logs.panel.enabledField'),
      value: CATEGORIES.map((category) =>
        t('modules.logs.panel.categoryLine', {
          category: t(`modules.logs.panel.categories.${category}`),
          status: status(config[category]),
        }),
      ).join('\n'),
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.logs.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      categoryButton('messages', config.messages),
      categoryButton('members', config.members),
      categoryButton('channels', config.channels),
    ),
    row().addComponents(
      categoryButton('roles', config.roles),
      categoryButton('moderation', config.moderation),
    ),
  ];

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
  if (action === 'chan') {
    if (!interaction.isChannelSelectMenu()) return;
    await updateLogsConfig(ctx, guildId, { logChannelId: interaction.values[0] ?? null });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'toggle') {
    if (!interaction.isButton()) return;
    const category = params[0] as LogCategory | undefined;
    if (!category || !CATEGORIES.includes(category)) return;
    const config = await getLogsConfig(ctx, guildId);
    await updateLogsConfig(ctx, guildId, { [category]: !config[category] });
    await interaction.update(await renderPage());
  }
}

export const logsPanel: ConfigPanel = { render, handle };
