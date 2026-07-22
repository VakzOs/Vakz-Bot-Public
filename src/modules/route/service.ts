import { randomInt } from 'node:crypto';
import type { BotContext } from '../../core/module.js';
import { addBalance } from '../economy/service.js';
import { addToInventory, listItems } from '../items/service.js';
import { type RouteConfig, getRouteConfig } from './config.js';

export interface Traveler {
  guildId: string;
  userId: string;
  health: number;
  maxHealth: number;
  energy: number;
  distance: number;
  coins: number;
  events: number;
  lastMoveAt: Date | null;
}

/** Un événement de la route, avec ses fourchettes d'effets et son poids. */
interface RouteEvent {
  key: string;
  weight: number;
  health: readonly [number, number];
  energy: readonly [number, number];
  distance: readonly [number, number];
  coins: readonly [number, number];
  item?: boolean;
}

const EVENTS: readonly RouteEvent[] = [
  { key: 'path', weight: 20, health: [0, 0], energy: [-6, -2], distance: [8, 15], coins: [0, 0] },
  {
    key: 'treasure',
    weight: 12,
    health: [0, 0],
    energy: [-4, -1],
    distance: [5, 12],
    coins: [30, 80],
  },
  {
    key: 'monster',
    weight: 14,
    health: [-25, -8],
    energy: [-8, -3],
    distance: [10, 20],
    coins: [5, 25],
  },
  { key: 'trap', weight: 10, health: [-18, -6], energy: [-5, -2], distance: [3, 8], coins: [0, 0] },
  {
    key: 'merchant',
    weight: 9,
    health: [0, 0],
    energy: [-3, -1],
    distance: [4, 10],
    coins: [0, 0],
    item: true,
  },
  { key: 'rest', weight: 10, health: [8, 20], energy: [10, 25], distance: [2, 6], coins: [0, 0] },
  {
    key: 'shortcut',
    weight: 8,
    health: [0, 0],
    energy: [-6, -2],
    distance: [18, 30],
    coins: [0, 0],
  },
  {
    key: 'storm',
    weight: 8,
    health: [-14, -4],
    energy: [-12, -6],
    distance: [4, 9],
    coins: [0, 0],
  },
  {
    key: 'friend',
    weight: 6,
    health: [5, 15],
    energy: [3, 10],
    distance: [6, 12],
    coins: [10, 40],
  },
  {
    key: 'abyss',
    weight: 3,
    health: [-45, -25],
    energy: [-10, -4],
    distance: [12, 25],
    coins: [20, 60],
  },
];

const TOTAL_WEIGHT = EVENTS.reduce((sum, event) => sum + event.weight, 0);

/** Entier aléatoire non biaisé dans [min, max]. */
function between([min, max]: readonly [number, number]): number {
  if (max <= min) return min;
  return min + randomInt(max - min + 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickEvent(): RouteEvent {
  let roll = randomInt(TOTAL_WEIGHT);
  for (const event of EVENTS) {
    roll -= event.weight;
    if (roll < 0) return event;
  }
  return EVENTS[0] as RouteEvent;
}

// --- Persistance ------------------------------------------------------------

export async function getTraveler(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<Traveler | null> {
  return ctx.db.traveler.findUnique({ where: { guildId_userId: { guildId, userId } } });
}

async function ensureTraveler(ctx: BotContext, guildId: string, userId: string): Promise<Traveler> {
  return ctx.db.traveler.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {},
    create: { guildId, userId },
  });
}

export interface CooldownState {
  ready: boolean;
  nextAt: Date | null;
}

export function cooldownState(traveler: Traveler | null, config: RouteConfig): CooldownState {
  if (!traveler?.lastMoveAt || config.cooldownMinutes <= 0) return { ready: true, nextAt: null };
  const nextAt = new Date(traveler.lastMoveAt.getTime() + config.cooldownMinutes * 60_000);
  return { ready: nextAt.getTime() <= Date.now(), nextAt };
}

export interface MoveOutcome {
  eventKey: string;
  deltas: { health: number; energy: number; distance: number; coins: number };
  itemFound: { emoji: string; name: string } | null;
  fainted: boolean;
  traveler: Traveler;
}

/** Fait avancer le voyageur : résout un événement, applique ses effets, persiste. */
export async function move(ctx: BotContext, guildId: string, userId: string): Promise<MoveOutcome> {
  const config = await getRouteConfig(ctx, guildId);
  const current = await ensureTraveler(ctx, guildId, userId);
  const event = pickEvent();

  const deltas = {
    health: between(event.health),
    energy: between(event.energy),
    distance: between(event.distance),
    coins: between(event.coins),
  };

  let health = current.health + deltas.health;
  let distance = current.distance + Math.max(0, deltas.distance);
  const fainted = health <= 0;
  if (fainted) {
    health = current.maxHealth;
    distance = Math.floor(distance / 2);
  }
  const energy = clamp(current.energy + deltas.energy, 0, 100);

  // Objet trouvé (marchand) si activé et catalogue non vide.
  let itemFound: { emoji: string; name: string } | null = null;
  if (event.item && config.giveItems) {
    const items = await listItems(ctx, guildId);
    const pick = items[randomInt(items.length)] ?? null;
    if (pick) {
      await addToInventory(ctx, guildId, userId, pick.id, 1);
      itemFound = { emoji: pick.emoji, name: pick.name };
    }
  }

  // Pièces créditées sur l'économie du serveur si activé.
  if (config.giveCoins && deltas.coins > 0) {
    await addBalance(ctx, guildId, userId, deltas.coins);
  }

  const traveler = await ctx.db.traveler.update({
    where: { guildId_userId: { guildId, userId } },
    data: {
      health: clamp(health, 0, current.maxHealth),
      energy,
      distance,
      coins: { increment: Math.max(0, deltas.coins) },
      events: { increment: 1 },
      lastMoveAt: new Date(),
    },
  });

  return { eventKey: event.key, deltas, itemFound, fainted, traveler };
}

export interface LeaderRow {
  userId: string;
  distance: number;
}

export async function leaderboard(
  ctx: BotContext,
  guildId: string,
  limit = 10,
): Promise<LeaderRow[]> {
  const rows = await ctx.db.traveler.findMany({
    where: { guildId, distance: { gt: 0 } },
    orderBy: { distance: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({ userId: row.userId, distance: row.distance }));
}
