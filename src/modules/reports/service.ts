import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildMember,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Report } from '@prisma/client';
import { t } from '../../core/i18n.js';
import type { PanelRow } from '../../core/module.js';
import { Colors } from '../../lib/embeds.js';
import { MODULE_NAME, type ReportsConfig } from './config.js';

export type ReportStatus = 'open' | 'taken' | 'resolved' | 'ignored';

const STATUS_COLORS: Record<ReportStatus, number> = {
  open: Colors.warning,
  taken: Colors.info,
  resolved: Colors.success,
  ignored: Colors.error,
};

const TERMINAL_STATUSES: ReportStatus[] = ['resolved', 'ignored'];

function asStatus(value: string): ReportStatus {
  if (value === 'taken' || value === 'resolved' || value === 'ignored') return value;
  return 'open';
}

function sourceLink(report: Report): string {
  if (report.sourceChannelId && report.sourceMessageId) {
    return `[${t('modules.reports.embed.jump')}](https://discord.com/channels/${report.guildId}/${report.sourceChannelId}/${report.sourceMessageId})`;
  }
  if (report.sourceChannelId) return `<#${report.sourceChannelId}>`;
  return t('modules.reports.embed.none');
}

export function isReportStaff(member: GuildMember, config: ReportsConfig): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(config.staffRoleId && member.roles.cache.has(config.staffRoleId));
}

export function buildReportEmbed(report: Report): EmbedBuilder {
  const status = asStatus(report.status);
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLORS[status])
    .setTitle(t('modules.reports.embed.title'))
    .setDescription(report.reason)
    .setFooter({ text: t('modules.reports.embed.footer', { id: report.id.slice(0, 8) }) })
    .setTimestamp(report.createdAt)
    .addFields(
      {
        name: t('modules.reports.embed.target'),
        value: `<@${report.targetId}>`,
        inline: true,
      },
      {
        name: t('modules.reports.embed.reporter'),
        value: `<@${report.reporterId}>`,
        inline: true,
      },
      {
        name: t('modules.reports.embed.status'),
        value: t(`modules.reports.status.${status}`),
        inline: true,
      },
      {
        name: t('modules.reports.embed.source'),
        value: sourceLink(report),
        inline: true,
      },
    );

  if (report.assigneeId) {
    embed.addFields({
      name: t('modules.reports.embed.assignee'),
      value: `<@${report.assigneeId}>`,
      inline: true,
    });
  }

  if (report.resolvedBy) {
    embed.addFields({
      name: t('modules.reports.embed.resolvedBy'),
      value: `<@${report.resolvedBy}>`,
      inline: true,
    });
  }

  return embed;
}

export function buildReportComponents(report: Report): PanelRow[] {
  const status = asStatus(report.status);
  const closed = TERMINAL_STATUSES.includes(status);

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${MODULE_NAME}|take|${report.id}`)
        .setLabel(t('modules.reports.button.take'))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(closed || status === 'taken'),
      new ButtonBuilder()
        .setCustomId(`${MODULE_NAME}|resolve|${report.id}`)
        .setLabel(t('modules.reports.button.resolve'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(closed),
      new ButtonBuilder()
        .setCustomId(`${MODULE_NAME}|ignore|${report.id}`)
        .setLabel(t('modules.reports.button.ignore'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(closed),
    ),
  ];
}

export function parseMessageLink(
  value: string | null,
  guildId: string,
): { channelId: string; messageId: string } | null {
  if (!value) return null;
  const match = value.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i);
  if (!match) return null;
  const [, linkGuildId, channelId, messageId] = match;
  if (linkGuildId !== guildId || !channelId || !messageId) return null;
  return { channelId, messageId };
}
