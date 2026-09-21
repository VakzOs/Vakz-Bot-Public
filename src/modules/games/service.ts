import { randomInt } from 'node:crypto';
import type { SendableChannels } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { brandedEmbed } from '../../lib/embeds.js';
import { type GameOutcome, rarityColor, rarityLabel, rollGameDrop } from '../items/service.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'games';

/** Coups possibles à pierre-feuille-ciseaux. */
export const PFC_CHOICES = ['pierre', 'feuille', 'ciseaux'] as const;
export type PfcChoice = (typeof PFC_CHOICES)[number];

/** Emoji illustrant chaque coup. */
export const PFC_EMOJI: Record<PfcChoice, string> = {
  pierre: '🪨',
  feuille: '📄',
  ciseaux: '✂️',
};

export type Outcome = 'win' | 'loss' | 'draw';

/** Issue inverse (pour enregistrer les stats de l'adversaire). */
export function invertOutcome(outcome: Outcome): Outcome {
  if (outcome === 'win') return 'loss';
  if (outcome === 'loss') return 'win';
  return 'draw';
}

/** Ce que chaque coup bat. */
const BEATS: Record<PfcChoice, PfcChoice> = {
  pierre: 'ciseaux',
  ciseaux: 'feuille',
  feuille: 'pierre',
};

/** Coup aléatoire du bot. */
export function botPfcChoice(): PfcChoice {
  return PFC_CHOICES[randomInt(PFC_CHOICES.length)] ?? 'pierre';
}

/** Issue d'une manche du point de vue du joueur. */
export function pfcOutcome(player: PfcChoice, bot: PfcChoice): Outcome {
  if (player === bot) return 'draw';
  return BEATS[player] === bot ? 'win' : 'loss';
}

/** Entier aléatoire non biaisé dans `[1, faces]`. */
export function rollDie(faces: number): number {
  return randomInt(faces) + 1;
}

/** Statistiques d'un membre pour un jeu. */
export interface GameStatRow {
  game: string;
  wins: number;
  losses: number;
  draws: number;
  plays: number;
}

/** Enregistre le résultat d'une partie (incrémente les compteurs). */
export async function recordResult(
  ctx: BotContext,
  guildId: string,
  userId: string,
  game: string,
  outcome: Outcome,
): Promise<void> {
  const wins = outcome === 'win' ? 1 : 0;
  const losses = outcome === 'loss' ? 1 : 0;
  const draws = outcome === 'draw' ? 1 : 0;
  await ctx.db.gameStat
    .upsert({
      where: { guildId_userId_game: { guildId, userId, game } },
      update: {
        plays: { increment: 1 },
        wins: { increment: wins },
        losses: { increment: losses },
        draws: { increment: draws },
      },
      create: { guildId, userId, game, plays: 1, wins, losses, draws },
    })
    .catch((error: unknown) =>
      ctx.logger.warn({ err: error, guildId, userId, game }, 'Enregistrement stat de jeu échoué'),
    );
}

/** Toutes les statistiques de jeu d'un membre. */
export async function getStats(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<GameStatRow[]> {
  const rows = await ctx.db.gameStat.findMany({ where: { guildId, userId } }).catch(() => []);
  return rows as GameStatRow[];
}

/**
 * Tente un drop d'objet pour `userId` selon son issue de partie, et l'annonce
 * dans le salon le cas échéant. Sans effet si le module « Objets » ou les drops
 * sont désactivés, ou si le tirage échoue. Best-effort (jamais bloquant).
 */
export async function awardGameDrop(
  ctx: BotContext,
  channel: SendableChannels | null,
  guildId: string,
  userId: string,
  outcome: GameOutcome,
): Promise<void> {
  if (!channel) return;
  const item = await rollGameDrop(ctx, guildId, userId, outcome).catch(() => null);
  if (!item) return;
  const embed = brandedEmbed({
    color: rarityColor(item.rarity),
    description: t('modules.games.drop.announce', {
      user: `<@${userId}>`,
      emoji: item.emoji,
      name: item.name,
      rarity: rarityLabel(item.rarity),
    }),
  });
  await channel.send({ embeds: [embed] }).catch(() => undefined);
}
