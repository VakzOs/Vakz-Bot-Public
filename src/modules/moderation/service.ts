import { EmbedBuilder, type Guild, type GuildMember, type User } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { Colors } from '../../lib/embeds.js';
import { t } from '../../core/i18n.js';
import { getModerationConfig } from './config.js';

export type SanctionType = 'warn' | 'kick' | 'ban' | 'unban' | 'timeout' | 'untimeout';

const TYPE_COLOR: Record<SanctionType, number> = {
  warn: Colors.warning,
  kick: Colors.warning,
  ban: Colors.error,
  unban: Colors.success,
  timeout: Colors.warning,
  untimeout: Colors.success,
};

export type TargetIssue = 'self' | 'owner' | 'bot' | 'botHierarchy' | 'modHierarchy';

/** Vérifie qu'un modérateur peut bien agir sur la cible (hiérarchie, propriétaire…). */
export function targetError(
  guild: Guild,
  moderatorId: string,
  target: GuildMember,
): TargetIssue | null {
  if (target.id === moderatorId) return 'self';
  if (target.id === guild.ownerId) return 'owner';

  const me = guild.members.me;
  if (me) {
    if (target.id === me.id) return 'bot';
    if (target.roles.highest.position >= me.roles.highest.position) return 'botHierarchy';
  }

  if (guild.ownerId !== moderatorId) {
    const moderator = guild.members.cache.get(moderatorId);
    if (moderator && target.roles.highest.position >= moderator.roles.highest.position) {
      return 'modHierarchy';
    }
  }
  return null;
}

interface SanctionData {
  type: SanctionType;
  userId: string;
  moderatorId: string;
  reason: string | null;
  expiresAt?: Date | null;
}

/** Enregistre la sanction en base et la journalise dans le salon de logs. */
export async function recordSanction(
  ctx: BotContext,
  guild: Guild,
  data: SanctionData,
): Promise<void> {
  await ctx.db.sanction.create({
    data: {
      guildId: guild.id,
      userId: data.userId,
      moderatorId: data.moderatorId,
      type: data.type,
      reason: data.reason,
      expiresAt: data.expiresAt ?? null,
    },
  });

  const config = await getModerationConfig(ctx, guild.id);
  if (!config.logChannelId) return;

  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(TYPE_COLOR[data.type])
    .setTitle(t(`modules.moderation.types.${data.type}`))
    .addFields(
      {
        name: t('modules.moderation.log.user'),
        value: `<@${data.userId}> \`${data.userId}\``,
        inline: true,
      },
      { name: t('modules.moderation.log.moderator'), value: `<@${data.moderatorId}>`, inline: true },
      {
        name: t('modules.moderation.log.reason'),
        value: data.reason || t('modules.moderation.log.noReason'),
      },
    )
    .setTimestamp();

  if (data.expiresAt) {
    embed.addFields({
      name: t('modules.moderation.log.until'),
      value: `<t:${Math.floor(data.expiresAt.getTime() / 1000)}:F>`,
    });
  }

  await channel.send({ embeds: [embed] }).catch(() => undefined);
}

/** Informe le membre sanctionné par MP (si activé en config). Best effort. */
export async function notifyUser(
  ctx: BotContext,
  guild: Guild,
  user: User,
  type: SanctionType,
  reason: string | null,
  expiresAt?: Date | null,
): Promise<void> {
  const config = await getModerationConfig(ctx, guild.id);
  if (!config.dmOnSanction) return;

  const embed = new EmbedBuilder()
    .setColor(TYPE_COLOR[type])
    .setTitle(t(`modules.moderation.dm.${type}`, { guild: guild.name }))
    .addFields({
      name: t('modules.moderation.log.reason'),
      value: reason || t('modules.moderation.log.noReason'),
    });
  if (expiresAt) {
    embed.addFields({
      name: t('modules.moderation.log.until'),
      value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>`,
    });
  }
  await user.send({ embeds: [embed] }).catch(() => undefined);
}

export interface SanctionRow {
  type: string;
  reason: string | null;
  moderatorId: string;
  createdAt: Date;
}

/** Récupère l'historique des sanctions d'un membre (les plus récentes d'abord). */
export async function getHistory(
  ctx: BotContext,
  guildId: string,
  userId: string,
  limit = 15,
): Promise<SanctionRow[]> {
  return ctx.db.sanction.findMany({
    where: { guildId, userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
