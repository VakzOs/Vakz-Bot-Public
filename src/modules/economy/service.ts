import type { EmbedBuilder, Guild, GuildMember } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { brandedEmbed, rankLabel } from '../../lib/embeds.js';
import {
  type EconomyConfig,
  MODULE_NAME,
  formatMoney,
  getEconomyConfig,
  updateEconomyConfig,
} from './config.js';

const DAILY_COOLDOWN_MS = 86_400_000;

/** Un membre est-il exclu des gains de monnaie (rôle ignoré) ? */
export function hasIgnoredRole(member: GuildMember, config: EconomyConfig): boolean {
  return config.ignoredRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function randomInt(min: number, max: number): number {
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - min + 1)) + min;
}

export async function getBalance(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<number> {
  const account = await ctx.db.memberEconomy.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  return account?.balance ?? 0;
}

/** Ajoute (ou retire) un montant au solde et renvoie le nouveau solde. */
export async function addBalance(
  ctx: BotContext,
  guildId: string,
  userId: string,
  delta: number,
): Promise<number> {
  const account = await ctx.db.memberEconomy.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { balance: { increment: delta } },
    create: { guildId, userId, balance: Math.max(0, delta) },
  });
  return account.balance;
}

export async function setBalance(
  ctx: BotContext,
  guildId: string,
  userId: string,
  amount: number,
): Promise<void> {
  await ctx.db.memberEconomy.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { balance: amount },
    create: { guildId, userId, balance: amount },
  });
}

export type DailyResult =
  | { ok: true; amount: number; balance: number }
  | { ok: false; nextAt: Date };

export async function claimDaily(
  ctx: BotContext,
  guildId: string,
  userId: string,
  amount: number,
): Promise<DailyResult> {
  const account = await ctx.db.memberEconomy.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  const now = Date.now();
  if (account?.lastDailyAt) {
    const elapsed = now - account.lastDailyAt.getTime();
    if (elapsed < DAILY_COOLDOWN_MS) {
      return { ok: false, nextAt: new Date(account.lastDailyAt.getTime() + DAILY_COOLDOWN_MS) };
    }
  }
  const updated = await ctx.db.memberEconomy.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { balance: { increment: amount }, lastDailyAt: new Date(now) },
    create: { guildId, userId, balance: amount, lastDailyAt: new Date(now) },
  });
  return { ok: true, amount, balance: updated.balance };
}

/** Gain de monnaie à chaque message, en respectant le cooldown. */
export async function earnFromMessage(
  ctx: BotContext,
  guildId: string,
  userId: string,
  config: EconomyConfig,
): Promise<void> {
  const account = await ctx.db.memberEconomy.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  const now = Date.now();
  if (account?.lastEarnAt && config.messageCooldown > 0) {
    if ((now - account.lastEarnAt.getTime()) / 1000 < config.messageCooldown) return;
  }
  const gain = randomInt(config.messageMin, config.messageMax);
  if (gain <= 0) return;

  await ctx.db.memberEconomy.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { balance: { increment: gain }, lastEarnAt: new Date(now) },
    create: { guildId, userId, balance: gain, lastEarnAt: new Date(now) },
  });
}

export type TransferResult = { ok: true } | { ok: false; error: 'insufficient' };

export async function transfer(
  ctx: BotContext,
  guildId: string,
  fromId: string,
  toId: string,
  amount: number,
): Promise<TransferResult> {
  // Défense en profondeur : un montant nul/négatif inverserait le sens du
  // transfert (vol). La commande borne déjà à > 0 ; on re-garde ici.
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'insufficient' };

  // Atomique : le débit est un UPDATE conditionnel (`balance >= amount`), donc
  // deux transferts concurrents ne peuvent pas tous deux passer la garde et
  // rendre le solde négatif. Le `$transaction` lie débit et crédit : un crash
  // entre les deux annule tout (pas de monnaie perdue/dupliquée).
  return ctx.db.$transaction(async (tx) => {
    const debit = await tx.memberEconomy.updateMany({
      where: { guildId, userId: fromId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debit.count === 0) return { ok: false, error: 'insufficient' as const };
    await tx.memberEconomy.upsert({
      where: { guildId_userId: { guildId, userId: toId } },
      update: { balance: { increment: amount } },
      create: { guildId, userId: toId, balance: amount },
    });
    return { ok: true as const };
  });
}

export interface LeaderboardEntry {
  userId: string;
  balance: number;
}

export async function getLeaderboard(
  ctx: BotContext,
  guildId: string,
  limit = 10,
): Promise<LeaderboardEntry[]> {
  const rows = await ctx.db.memberEconomy.findMany({
    where: { guildId, balance: { gt: 0 } },
    orderBy: { balance: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({ userId: row.userId, balance: row.balance }));
}

/** Embed du classement des plus riches (affichage auto ou commande). */
export function buildLeaderboardEmbed(
  guild: Guild,
  entries: LeaderboardEntry[],
  config: EconomyConfig,
): EmbedBuilder {
  const lines = entries.length
    ? entries.map(
        (entry, index) =>
          `${rankLabel(index)} <@${entry.userId}> — ${formatMoney(config, entry.balance)}`,
      )
    : ['*Personne n’a encore de solde.*'];
  return brandedEmbed({
    title: `💰 Les plus riches · ${guild.name}`,
    description: lines.join('\n'),
  });
}

/**
 * Gain de monnaie en vocal (à appeler chaque minute) : crédite les membres actifs
 * en vocal sur chaque serveur où le module et le vocal sont activés. Un salon doit
 * compter au moins deux membres actifs (non sourds/mute, non bots).
 */
export async function runVoiceMoney(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);

  for (const rowConfig of rows) {
    const config = await getEconomyConfig(ctx, rowConfig.guildId);
    if (!config.voiceEnabled || config.voicePerMinute <= 0) continue;
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
        await addBalance(ctx, guild.id, member.id, config.voicePerMinute);
      }
    }
  }
}

/** Met à jour (ou publie) le classement auto des plus riches sur chaque serveur réglé. */
export async function refreshLeaderboards(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);

  for (const rowConfig of rows) {
    const config = await getEconomyConfig(ctx, rowConfig.guildId);
    if (!config.leaderboardChannelId) continue;
    const guild = ctx.client.guilds.cache.get(rowConfig.guildId);
    if (!guild) continue;
    const channel = await guild.channels.fetch(config.leaderboardChannelId).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const entries = await getLeaderboard(ctx, guild.id, 10);
    const embed = buildLeaderboardEmbed(guild, entries, config);

    if (config.leaderboardMessageId) {
      const existing = await channel.messages.fetch(config.leaderboardMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed] }).catch(() => undefined);
        continue;
      }
    }
    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (sent) await updateEconomyConfig(ctx, guild.id, { leaderboardMessageId: sent.id });
  }
}
