import { type EmbedBuilder, PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { Colors, brandedEmbed, rankLabel } from '../../lib/embeds.js';
import { levelFromXp } from './curve.js';
import { type LevelsConfig, MODULE_NAME, getLevelsConfig, updateLevelsConfig } from './config.js';

export interface XpGainResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  xp: number;
}

function randomInt(min: number, max: number): number {
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - min + 1)) + min;
}

/** Multiplicateur d'XP d'un membre : `boosterMultiplier` s'il a un rôle boost. */
export function xpMultiplierFor(member: GuildMember, config: LevelsConfig): number {
  const boosted = config.boosterRoleIds.some((roleId) => member.roles.cache.has(roleId));
  return boosted ? config.boosterMultiplier : 1;
}

/** Un membre est-il exclu des gains d'XP (rôle ignoré) ? */
export function hasIgnoredRole(member: GuildMember, config: LevelsConfig): boolean {
  return config.ignoredRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Attribue de l'XP à un membre, en respectant le cooldown anti-spam. `multiplier`
 * applique un bonus (rôle boost) et `baseAmount` force un gain fixe (vocal) au
 * lieu du tirage aléatoire. Renvoie `null` si le membre est encore en cooldown.
 */
export async function awardXp(
  ctx: BotContext,
  guildId: string,
  userId: string,
  config: LevelsConfig,
  options: { multiplier?: number; baseAmount?: number; ignoreCooldown?: boolean } = {},
): Promise<XpGainResult | null> {
  const existing = await ctx.db.memberLevel.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });

  const now = Date.now();
  if (existing && config.cooldown > 0 && !options.ignoreCooldown) {
    const elapsedSeconds = (now - existing.lastXpAt.getTime()) / 1000;
    if (elapsedSeconds < config.cooldown) return null;
  }

  const oldXp = existing?.xp ?? 0;
  const oldLevel = existing?.level ?? 0;
  const base = options.baseAmount ?? randomInt(config.xpMin, config.xpMax);
  const gain = Math.max(0, Math.round(base * (options.multiplier ?? 1)));
  const newXp = oldXp + gain;
  const rawLevel = levelFromXp(newXp, config.curveFactor);
  const newLevel = config.maxLevel > 0 ? Math.min(rawLevel, config.maxLevel) : rawLevel;

  await ctx.db.memberLevel.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { xp: newXp, level: newLevel, lastXpAt: new Date(now) },
    create: { guildId, userId, xp: newXp, level: newLevel, lastXpAt: new Date(now) },
  });

  return { leveledUp: newLevel > oldLevel, oldLevel, newLevel, xp: newXp };
}

/** Embed du classement (top membres) pour l'affichage auto ou la commande. */
export function buildLeaderboardEmbed(
  guild: Guild,
  entries: LeaderboardEntry[],
  color: number | null,
): EmbedBuilder {
  const lines = entries.length
    ? entries.map((entry, index) => {
        return `${rankLabel(index)} <@${entry.userId}> — niveau **${entry.level}** · ${entry.xp} XP`;
      })
    : ['*Aucun membre classé pour le moment.*'];
  return brandedEmbed({
    color: color ?? Colors.brand,
    title: `🏆 Classement · ${guild.name}`,
    description: lines.join('\n'),
  });
}

export interface RankInfo {
  xp: number;
  level: number;
  rank: number;
}

/** Renvoie l'XP, le niveau et le rang d'un membre, ou `null` s'il n'a pas d'XP. */
export async function getRank(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<RankInfo | null> {
  const row = await ctx.db.memberLevel.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!row) return null;

  const higher = await ctx.db.memberLevel.count({ where: { guildId, xp: { gt: row.xp } } });
  return { xp: row.xp, level: row.level, rank: higher + 1 };
}

export interface LeaderboardEntry {
  userId: string;
  xp: number;
  level: number;
}

export async function getLeaderboard(
  ctx: BotContext,
  guildId: string,
  limit = 10,
): Promise<LeaderboardEntry[]> {
  const rows = await ctx.db.memberLevel.findMany({
    where: { guildId },
    orderBy: { xp: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({ userId: row.userId, xp: row.xp, level: row.level }));
}

function formatLevelMessage(template: string, member: GuildMember, level: number): string {
  return template
    .replaceAll('{mention}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{level}', String(level));
}

/** Annonce un passage de niveau dans le salon d'annonce configuré (si activé). */
export async function announceLevelUp(
  ctx: BotContext,
  member: GuildMember,
  config: LevelsConfig,
  level: number,
): Promise<void> {
  if (!config.announce.enabled || !config.announce.channelId) return;
  const channel = await member.guild.channels.fetch(config.announce.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel
      .send({
        content: formatLevelMessage(config.announce.message, member, level),
        allowedMentions: { users: [member.id] },
      })
      .catch(() => undefined);
  }
}

/**
 * Gain d'XP vocal (à appeler chaque minute) : crédite les membres actifs en
 * vocal sur chaque serveur où le module et le vocal sont activés. Un salon doit
 * compter au moins deux membres actifs (non sourds, non bots) pour compter.
 */
export async function runVoiceXp(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);

  for (const rowConfig of rows) {
    const config = await getLevelsConfig(ctx, rowConfig.guildId);
    if (!config.voiceEnabled || config.voiceXpPerMinute <= 0) continue;
    const guild = ctx.client.guilds.cache.get(rowConfig.guildId);
    if (!guild) continue;

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) continue;
      if (config.ignoredChannelIds.includes(channel.id)) continue;

      const active = channel.members.filter(
        (member) => !member.user.bot && !member.voice.deaf && !member.voice.mute,
      );
      if (active.size < 2) continue;

      for (const member of active.values()) {
        if (hasIgnoredRole(member, config)) continue;
        const result = await awardXp(ctx, guild.id, member.id, config, {
          baseAmount: config.voiceXpPerMinute,
          multiplier: xpMultiplierFor(member, config),
          ignoreCooldown: true,
        });
        if (result?.leveledUp) {
          await applyRewardRoles(ctx, member, config, result.newLevel);
          await announceLevelUp(ctx, member, config, result.newLevel);
        }
      }
    }
  }
}

/** Met à jour (ou publie) le message de classement auto sur chaque serveur réglé. */
export async function refreshLeaderboards(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);

  for (const rowConfig of rows) {
    const config = await getLevelsConfig(ctx, rowConfig.guildId);
    if (!config.leaderboardChannelId) continue;
    const guild = ctx.client.guilds.cache.get(rowConfig.guildId);
    if (!guild) continue;
    const channel = await guild.channels.fetch(config.leaderboardChannelId).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const entries = await getLeaderboard(ctx, guild.id, 10);
    const embed = buildLeaderboardEmbed(guild, entries, config.cardColor);

    let messageId = config.leaderboardMessageId;
    if (messageId) {
      const existing = await channel.messages.fetch(messageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed] }).catch(() => undefined);
        continue;
      }
      messageId = null;
    }
    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (sent) {
      await updateLevelsConfig(ctx, guild.id, { leaderboardMessageId: sent.id });
    }
  }
}

/**
 * Attribue les rôles récompense dus jusqu'au niveau atteint (sans rien retirer).
 * Respecte la hiérarchie et la permission « Gérer les rôles » du bot, et journalise
 * la raison lorsqu'un rôle ne peut pas être attribué.
 */
export async function applyRewardRoles(
  ctx: BotContext,
  member: GuildMember,
  config: LevelsConfig,
  level: number,
): Promise<void> {
  const dueRoleIds = config.rewards.filter((reward) => reward.level <= level).map((r) => r.roleId);
  if (dueRoleIds.length === 0) return;

  const me = member.guild.members.me ?? (await member.guild.members.fetchMe().catch(() => null));
  if (!me) return;

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    ctx.logger.warn(
      { guildId: member.guild.id },
      'Rôles récompense : permission « Gérer les rôles » manquante pour le bot',
    );
    return;
  }

  const botHighest = me.roles.highest.position;

  for (const roleId of dueRoleIds) {
    if (member.roles.cache.has(roleId)) continue;
    const role =
      member.guild.roles.cache.get(roleId) ??
      (await member.guild.roles.fetch(roleId).catch(() => null));
    if (!role) continue;
    if (role.position >= botHighest) {
      ctx.logger.warn(
        { guildId: member.guild.id, role: role.name },
        'Rôle récompense au-dessus du rôle du bot : non attribuable (déplace le rôle du bot plus haut)',
      );
      continue;
    }
    try {
      await member.roles.add(role);
    } catch (error) {
      ctx.logger.warn({ err: error, role: role.name }, 'Échec d’attribution d’un rôle récompense');
    }
  }
}
