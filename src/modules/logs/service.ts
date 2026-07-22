import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type AuditLogEvent,
  type Guild,
  type GuildTextBasedChannel,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { BotContext, PanelRow } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import { MODULE_NAME, type LogCategory, getLogsConfig } from './config.js';
import type { RollbackKind } from './rollback.js';

const MAX_FIELD = 1024;
const AUDIT_LOG_WINDOW_MS = 15_000;

export function clip(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 3)}...` : text;
}

function codeSafe(value: string): string {
  return value.replace(/```/g, "''' ").slice(0, 450);
}

export function auditEmbed(title: string, color: number = Colors.info): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
}

export function targetEmbed(
  title: string,
  color: number,
  target: string,
  targetId?: string,
): EmbedBuilder {
  const embed = auditEmbed(title, color).setDescription(target);
  if (targetId) embed.setFooter({ text: `ID ${targetId}` });
  return embed;
}

export function changeBlock(before: string, after: string): string {
  return `\`\`\`diff\n- ${codeSafe(before)}\n+ ${codeSafe(after)}\n\`\`\``;
}

export function addExecutor(embed: EmbedBuilder, executorId: string | null): EmbedBuilder {
  return embed.addFields({
    name: t('modules.logs.fields.executor'),
    value: executorValue(executorId),
  });
}

export async function findAuditExecutor(
  guild: Guild,
  action: AuditLogEvent,
  targetId: string,
): Promise<string | null> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

  const logs = await guild.fetchAuditLogs({ type: action, limit: 6 }).catch(() => null);
  const entry = logs?.entries.find(
    (item) =>
      item.targetId === targetId && Date.now() - item.createdTimestamp <= AUDIT_LOG_WINDOW_MS,
  );
  return entry?.executorId ?? null;
}

export function executorValue(executorId: string | null): string {
  return executorId ? `<@${executorId}>` : t('modules.logs.fields.unknown');
}

export async function createRollback(
  ctx: BotContext,
  guildId: string,
  kind: RollbackKind,
  targetId: string | null,
  payload: unknown,
): Promise<string> {
  const record = await ctx.db.logRollback.create({
    data: {
      guildId,
      kind,
      targetId,
      payload: JSON.stringify(payload),
    },
  });
  return record.id;
}

export function rollbackRow(rollbackId: string): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|rollback|${rollbackId}`)
      .setLabel(t('modules.logs.rollback.button'))
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function isLogCategoryEnabled(
  ctx: BotContext,
  guildId: string,
  category: LogCategory,
): Promise<boolean> {
  if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) return false;

  const config = await getLogsConfig(ctx, guildId);
  return Boolean(config.logChannelId && config[category]);
}

export async function sendLog(
  ctx: BotContext,
  guild: Guild,
  category: LogCategory,
  embed: EmbedBuilder,
  components: PanelRow[] = [],
): Promise<void> {
  if (!(await isLogCategoryEnabled(ctx, guild.id, category))) return;

  const config = await getLogsConfig(ctx, guild.id);
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await (channel as GuildTextBasedChannel)
    .send({ embeds: [embed], components })
    .catch(() => undefined);
}

export async function logClearAction(
  ctx: BotContext,
  guild: Guild,
  data: {
    channelId: string;
    moderatorId: string;
    count: number;
    targetUserId: string | null;
    reason: string | null;
  },
): Promise<void> {
  const embed = targetEmbed(
    t('modules.logs.events.clear.title'),
    Colors.warning,
    `<#${data.channelId}>`,
    data.channelId,
  ).addFields(
    {
      name: t('modules.logs.fields.moderator'),
      value: `<@${data.moderatorId}>`,
      inline: true,
    },
    {
      name: t('modules.logs.fields.count'),
      value: String(data.count),
      inline: true,
    },
    {
      name: t('modules.logs.fields.target'),
      value: data.targetUserId ? `<@${data.targetUserId}>` : t('modules.logs.fields.everyone'),
      inline: true,
    },
    {
      name: t('modules.logs.fields.reason'),
      value: data.reason || t('modules.logs.fields.noReason'),
    },
  );

  await sendLog(ctx, guild, 'moderation', embed);
}
