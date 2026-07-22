import type { Guild, GuildMember } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { addBalance } from '../economy/service.js';
import { addToInventory, getItem } from '../items/service.js';
import {
  type AdventConfig,
  type DayReward,
  LAST_DAY,
  MODULE_NAME,
  getAdventConfig,
  updateAdventConfig,
} from './config.js';

/**
 * Jour courant du calendrier (1-24), ou 0 s'il n'est pas ouvrable. En mode test,
 * toutes les portes sont ouvrables. Sinon uniquement en décembre, du 1 au 24.
 */
export function currentAdventDay(config: AdventConfig, now = new Date()): number {
  if (config.testMode) return LAST_DAY;
  // getMonth() est 0-indexé : décembre = 11.
  if (now.getMonth() !== 11) return 0;
  const day = now.getDate();
  return day >= 1 && day <= LAST_DAY ? day : 0;
}

/** Récompense d'un jour : entrée dédiée, sinon repli sur les pièces par défaut. */
export function rewardForDay(config: AdventConfig, day: number): DayReward {
  return (
    config.rewards.find((reward) => reward.day === day) ?? {
      day,
      coins: config.defaultCoins,
      itemId: null,
      itemQty: 1,
      message: '',
    }
  );
}

/** Jours déjà ouverts par un membre. */
export async function openedDays(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<number[]> {
  const rows = await ctx.db.adventClaim.findMany({
    where: { guildId, userId },
    select: { day: true },
  });
  return rows.map((row) => row.day);
}

export type OpenResult =
  | {
      ok: true;
      day: number;
      coins: number;
      itemName: string | null;
      itemQty: number;
      message: string;
      balance: number | null;
    }
  | { ok: false; reason: 'closed' | 'locked' | 'already' };

/**
 * Ouvre la porte `day` pour `member` : réserve la porte (l'unicité
 * `(guildId, userId, day)` empêche tout double-claim, y compris concurrent),
 * puis crédite pièces et objet configurés.
 */
export async function openDoor(
  ctx: BotContext,
  member: GuildMember,
  config: AdventConfig,
  day: number,
): Promise<OpenResult> {
  const guildId = member.guild.id;
  const userId = member.id;

  const today = currentAdventDay(config);
  if (today === 0) return { ok: false, reason: 'closed' };
  if (day < 1 || day > today) return { ok: false, reason: 'locked' };

  try {
    await ctx.db.adventClaim.create({ data: { guildId, userId, day } });
  } catch {
    // Violation d'unicité → porte déjà ouverte par ce membre.
    return { ok: false, reason: 'already' };
  }

  const reward = rewardForDay(config, day);
  let balance: number | null = null;
  if (reward.coins > 0) balance = await addBalance(ctx, guildId, userId, reward.coins);

  let itemName: string | null = null;
  if (reward.itemId) {
    const item = await getItem(ctx, guildId, reward.itemId);
    if (item) {
      await addToInventory(ctx, guildId, userId, reward.itemId, reward.itemQty);
      itemName = item.emoji ? `${item.emoji} ${item.name}` : item.name;
    }
  }

  return {
    ok: true,
    day,
    coins: reward.coins,
    itemName,
    itemQty: reward.itemQty,
    message: reward.message,
    balance,
  };
}

/** Envoie l'annonce d'ouverture d'une porte, si un salon est réglé. */
export async function announceDay(
  ctx: BotContext,
  guild: Guild,
  config: AdventConfig,
  content: string,
): Promise<void> {
  if (!config.announceChannelId) return;
  const channel = await guild.channels.fetch(config.announceChannelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({ content }).catch(() => undefined);
  }
}

/**
 * Tâche quotidienne : annonce l'ouverture de la porte du jour dans chaque serveur
 * où le module est actif, avec un salon d'annonce réglé. `lastAnnouncedDay` évite
 * toute annonce en double (redémarrage, double déclenchement).
 */
export async function announceDailyOpenings(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);

  for (const row of rows) {
    const config = await getAdventConfig(ctx, row.guildId);
    if (!config.announceChannelId || config.testMode) continue;
    const day = currentAdventDay(config);
    if (day === 0 || config.lastAnnouncedDay === day) continue;

    const guild = ctx.client.guilds.cache.get(row.guildId);
    if (!guild) continue;

    await announceDay(ctx, guild, config, t('modules.advent.announce', { day }));
    await updateAdventConfig(ctx, row.guildId, { lastAnnouncedDay: day });
  }
}
