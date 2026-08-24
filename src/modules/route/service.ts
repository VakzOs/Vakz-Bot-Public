import { randomInt } from 'node:crypto';
import type { BotContext } from '../../core/module.js';
import { addBalance, getBalance } from '../economy/service.js';
import { addToInventory, rollDropByChances } from '../items/service.js';
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
  deaths: number;
  lastMoveAt: Date | null;
  energyAt: Date;
}

/** Borne basse de l'énergie (le négatif déclenche des malus d'épuisement). */
export const ENERGY_MIN = -100;
export const ENERGY_MAX = 100;

/**
 * Provisions de la Route : achetées à `/route boutique` ou au marchand
 * ambulant (événement `peddler`) — l'effet est appliqué IMMÉDIATEMENT à
 * l'achat, il n'y a pas de stock.
 */
export const GOODS = {
  potion: { health: 40, energy: 0 },
  tonic: { health: 0, energy: 50 },
  ration: { health: 15, energy: 20 },
} as const;

export type GoodKey = keyof typeof GOODS;

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
  // --- Événements supplémentaires ---
  { key: 'oasis', weight: 7, health: [6, 14], energy: [10, 22], distance: [2, 5], coins: [0, 0] },
  {
    key: 'ruins',
    weight: 6,
    health: [0, 0],
    energy: [-5, -2],
    distance: [6, 12],
    coins: [20, 55],
    item: true,
  },
  {
    key: 'wolves',
    weight: 8,
    health: [-20, -7],
    energy: [-6, -2],
    distance: [8, 16],
    coins: [0, 0],
  },
  { key: 'river', weight: 7, health: [0, 0], energy: [-12, -5], distance: [12, 22], coins: [0, 0] },
  { key: 'shrine', weight: 5, health: [15, 30], energy: [5, 15], distance: [3, 8], coins: [5, 20] },
  { key: 'mirage', weight: 5, health: [0, 0], energy: [-8, -3], distance: [1, 4], coins: [0, 0] },
  {
    key: 'bandits',
    weight: 6,
    health: [-16, -5],
    energy: [-5, -2],
    distance: [6, 12],
    coins: [15, 45],
  },
  {
    key: 'volcano',
    weight: 3,
    health: [-40, -20],
    energy: [-12, -6],
    distance: [15, 28],
    coins: [30, 80],
  },
  // --- Événements qui font RECULER (distance négative) ---
  {
    key: 'quicksand',
    weight: 7,
    health: [-10, -4],
    energy: [-8, -3],
    distance: [-10, -3],
    coins: [0, 0],
  },
  {
    key: 'landslide',
    weight: 6,
    health: [-12, -5],
    energy: [-6, -2],
    distance: [-15, -6],
    coins: [0, 0],
  },
  { key: 'lost', weight: 6, health: [0, 0], energy: [-10, -4], distance: [-20, -8], coins: [0, 0] },
  {
    key: 'bog',
    weight: 6,
    health: [-6, -2],
    energy: [-12, -6],
    distance: [-8, -2],
    coins: [0, 0],
  },
  {
    key: 'ravine',
    weight: 5,
    health: [-22, -10],
    energy: [-8, -3],
    distance: [-12, -5],
    coins: [0, 0],
  },
  {
    key: 'curse',
    weight: 3,
    health: [-15, -8],
    energy: [-10, -5],
    distance: [-30, -15],
    coins: [0, 0],
  },
  {
    key: 'echo',
    weight: 2,
    health: [0, 0],
    energy: [10, 20],
    distance: [-40, -20],
    coins: [0, 0],
  },
  // --- Événements à pièces perdues ou aléatoires ---
  {
    key: 'thief',
    weight: 6,
    health: [-5, -1],
    energy: [-4, -1],
    distance: [2, 6],
    coins: [-40, -10],
  },
  {
    key: 'gambler',
    weight: 5,
    health: [0, 0],
    energy: [-3, -1],
    distance: [5, 10],
    coins: [-30, 60],
  },
  {
    key: 'sphinx',
    weight: 4,
    health: [0, 0],
    energy: [-5, -2],
    distance: [-10, 25],
    coins: [-20, 60],
  },
  // --- Rencontres & dangers variés ---
  {
    key: 'ambush',
    weight: 7,
    health: [-18, -8],
    energy: [-7, -3],
    distance: [6, 12],
    coins: [8, 20],
  },
  {
    key: 'bridge',
    weight: 6,
    health: [-4, 0],
    energy: [-9, -4],
    distance: [-5, 12],
    coins: [0, 0],
  },
  {
    key: 'golem',
    weight: 4,
    health: [-28, -12],
    energy: [-8, -4],
    distance: [8, 14],
    coins: [25, 55],
  },
  {
    key: 'meteor',
    weight: 3,
    health: [-20, -10],
    energy: [-6, -2],
    distance: [15, 25],
    coins: [40, 90],
  },
  {
    key: 'dragon',
    weight: 2,
    health: [-50, -30],
    energy: [-15, -8],
    distance: [20, 35],
    coins: [80, 150],
  },
  // --- Coups de pouce & merveilles ---
  {
    key: 'caravan',
    weight: 7,
    health: [4, 10],
    energy: [5, 12],
    distance: [8, 14],
    coins: [15, 35],
  },
  {
    key: 'herbalist',
    weight: 6,
    health: [12, 25],
    energy: [0, 5],
    distance: [3, 7],
    coins: [0, 0],
  },
  {
    key: 'waterfall',
    weight: 6,
    health: [5, 12],
    energy: [8, 18],
    distance: [4, 9],
    coins: [0, 0],
  },
  {
    key: 'fireflies',
    weight: 6,
    health: [0, 0],
    energy: [8, 16],
    distance: [6, 12],
    coins: [0, 0],
  },
  { key: 'well', weight: 5, health: [3, 8], energy: [0, 0], distance: [2, 5], coins: [20, 50] },
  {
    key: 'hermit',
    weight: 5,
    health: [0, 0],
    energy: [15, 30],
    distance: [2, 5],
    coins: [0, 0],
    item: true,
  },
  {
    key: 'eagle',
    weight: 4,
    health: [0, 0],
    energy: [-10, -5],
    distance: [25, 40],
    coins: [0, 0],
  },
  {
    key: 'fairy',
    weight: 4,
    health: [10, 20],
    energy: [10, 20],
    distance: [5, 10],
    coins: [0, 0],
    item: true,
  },
  {
    key: 'portal',
    weight: 2,
    health: [0, 0],
    energy: [-8, -4],
    distance: [40, 70],
    coins: [0, 0],
  },
  // --- Rencontres sournoises & paris ---
  {
    key: 'witch',
    weight: 5,
    health: [-15, 20],
    energy: [-4, -1],
    distance: [2, 6],
    coins: [-10, 15],
  },
  {
    key: 'mimic',
    weight: 5,
    health: [-16, -6],
    energy: [-3, -1],
    distance: [3, 7],
    coins: [35, 75],
  },
  {
    key: 'ogre',
    weight: 6,
    health: [-24, -10],
    energy: [-6, -2],
    distance: [4, 9],
    coins: [-30, -5],
  },
  {
    key: 'skeletons',
    weight: 7,
    health: [-17, -7],
    energy: [-5, -2],
    distance: [8, 14],
    coins: [10, 30],
  },
  {
    key: 'harpy',
    weight: 5,
    health: [-8, -3],
    energy: [-4, -1],
    distance: [4, 10],
    coins: [-28, -8],
  },
  // --- Événements qui font RECULER (distance négative) ---
  {
    key: 'fog',
    weight: 6,
    health: [0, 0],
    energy: [-9, -4],
    distance: [-14, -5],
    coins: [0, 0],
  },
  {
    key: 'willowisp',
    weight: 5,
    health: [0, 0],
    energy: [-6, -2],
    distance: [-18, -8],
    coins: [0, 0],
  },
  {
    key: 'mermaid',
    weight: 4,
    health: [-10, -3],
    energy: [-5, -2],
    distance: [-12, -5],
    coins: [0, 0],
  },
  // --- Échanges & marchandages ---
  {
    key: 'toll',
    weight: 5,
    health: [0, 0],
    energy: [-3, -1],
    distance: [15, 25],
    coins: [-25, -5],
  },
  {
    key: 'smith',
    weight: 5,
    health: [12, 22],
    energy: [0, 5],
    distance: [2, 5],
    coins: [-15, -5],
  },
  {
    key: 'altar',
    weight: 4,
    health: [-12, -5],
    energy: [0, 0],
    distance: [3, 7],
    coins: [40, 90],
  },
  {
    key: 'mushrooms',
    weight: 6,
    health: [-5, 8],
    energy: [10, 22],
    distance: [1, 4],
    coins: [0, 0],
  },
  {
    key: 'wizard',
    weight: 4,
    health: [0, 0],
    energy: [-5, -2],
    distance: [-10, 30],
    coins: [0, 0],
  },
  {
    key: 'raven',
    weight: 4,
    health: [0, 0],
    energy: [0, 5],
    distance: [5, 10],
    coins: [5, 15],
    item: true,
  },
  {
    key: 'peddler',
    weight: 4,
    health: [0, 0],
    energy: [-2, 0],
    distance: [1, 4],
    coins: [0, 0],
  },
  // --- Grosses rencontres ---
  {
    key: 'giant',
    weight: 3,
    health: [-35, -18],
    energy: [-10, -5],
    distance: [10, 18],
    coins: [50, 100],
  },
  {
    key: 'griffin',
    weight: 3,
    health: [0, 0],
    energy: [-12, -6],
    distance: [30, 45],
    coins: [0, 0],
  },
  // --- Haltes, rencontres & présages (récup. branche route-more-events) ---
  {
    key: 'tavern',
    weight: 7,
    health: [8, 18],
    energy: [10, 20],
    distance: [2, 5],
    coins: [-15, -5],
  },
  {
    key: 'market',
    weight: 6,
    health: [0, 0],
    energy: [-2, 0],
    distance: [4, 8],
    coins: [0, 0],
    item: true,
  },
  { key: 'bear', weight: 7, health: [-22, -9], energy: [-6, -2], distance: [7, 14], coins: [0, 0] },
  {
    key: 'festival',
    weight: 5,
    health: [5, 12],
    energy: [8, 16],
    distance: [3, 7],
    coins: [10, 30],
  },
  {
    key: 'serpent',
    weight: 5,
    health: [-26, -12],
    energy: [-7, -3],
    distance: [8, 15],
    coins: [20, 50],
  },
  {
    key: 'frost',
    weight: 6,
    health: [-8, -2],
    energy: [-14, -7],
    distance: [-6, 2],
    coins: [0, 0],
  },
  { key: 'oracle', weight: 3, health: [0, 0], energy: [-4, -1], distance: [22, 38], coins: [0, 0] },
  {
    key: 'knight',
    weight: 4,
    health: [0, 0],
    energy: [-3, -1],
    distance: [4, 9],
    coins: [25, 60],
    item: true,
  },
  {
    key: 'ghost',
    weight: 4,
    health: [-14, -6],
    energy: [-10, -5],
    distance: [-8, -2],
    coins: [0, 0],
  },
  // --- Événements ULTRA RARES ---
  {
    key: 'timeloop',
    weight: 1,
    health: [0, 0],
    energy: [50, 80],
    distance: [-50, -25],
    coins: [0, 0],
  },
  {
    key: 'wishingstar',
    weight: 1,
    health: [20, 40],
    energy: [20, 40],
    distance: [10, 20],
    coins: [100, 250],
  },
  {
    key: 'fountain',
    weight: 1,
    health: [100, 100],
    energy: [20, 40],
    distance: [3, 8],
    coins: [0, 0],
  },
  {
    key: 'elixir',
    weight: 1,
    health: [100, 100],
    energy: [100, 100],
    distance: [5, 10],
    coins: [0, 0],
  },
  {
    key: 'goldenvault',
    weight: 1,
    health: [0, 0],
    energy: [0, 0],
    distance: [10, 18],
    coins: [200, 400],
  },
  {
    key: 'phoenix',
    weight: 1,
    health: [80, 100],
    energy: [30, 50],
    distance: [15, 25],
    coins: [0, 0],
    item: true,
  },
];

/**
 * Un événement « soin pur » : il donne de la vie à coup sûr, sans pièces,
 * sans objet et avec un déplacement minime (le gain d'énergie est cosmétique).
 * Exemples : repos, oasis, herboriste, cascade, fontaine, élixir, forgeron.
 */
function isPureHeal(event: RouteEvent): boolean {
  return event.health[0] > 0 && event.coins[1] <= 0 && !event.item && event.distance[1] <= 10;
}

/** Entier aléatoire non biaisé dans [min, max]. */
function between([min, max]: readonly [number, number]): number {
  if (max <= min) return min;
  return min + randomInt(max - min + 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Énergie EFFECTIVE d'un voyageur à l'instant `now`, après régénération
 * passive : +`energyRegenRate` par minute écoulée depuis le dernier changement
 * d'énergie, sans jamais dépasser `energyRegenCap`. Depuis le négatif, la
 * remontée prend simplement plus de temps (ex. -30 → 15 = 45 min au taux 1).
 * Au-delà du plafond, l'énergie stockée est conservée telle quelle.
 */
export function applyEnergyRegen(
  traveler: Pick<Traveler, 'energy' | 'energyAt'>,
  config: Pick<RouteConfig, 'energyRegenRate' | 'energyRegenCap'>,
  now = new Date(),
): number {
  if (config.energyRegenRate <= 0 || traveler.energy >= config.energyRegenCap) {
    return traveler.energy;
  }
  const minutes = Math.floor((now.getTime() - traveler.energyAt.getTime()) / 60_000);
  if (minutes <= 0) return traveler.energy;
  return Math.min(config.energyRegenCap, traveler.energy + minutes * config.energyRegenRate);
}

/**
 * Tire un événement pondéré. À FULL VIE, les événements « soin pur » sont
 * retirés du tirage (inutiles) : leurs poids sont redistribués aux autres.
 */
function pickEvent(fullHealth: boolean): RouteEvent {
  const pool = fullHealth ? EVENTS.filter((event) => !isPureHeal(event)) : EVENTS;
  const list = pool.length > 0 ? pool : EVENTS;
  const totalWeight = list.reduce((sum, event) => sum + event.weight, 0);
  let roll = randomInt(totalWeight);
  for (const event of list) {
    roll -= event.weight;
    if (roll < 0) return event;
  }
  return list[0] as RouteEvent;
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

/** Résultat de dégâts infligés à un voyageur par une source externe (objet). */
export interface DamageResult {
  health: number;
  maxHealth: number;
  fainted: boolean;
}

/**
 * Inflige `amount` dégâts au voyageur d'un membre (effet d'objet). Renvoie
 * `null` si la cible n'est PAS sur la Route (aucun voyageur). Si les PV tombent
 * à 0, le voyageur « tombe » comme lors d'un déplacement : PV réinitialisés,
 * distance divisée par deux, compteur de morts incrémenté.
 */
export async function damageTraveler(
  ctx: BotContext,
  guildId: string,
  userId: string,
  amount: number,
): Promise<DamageResult | null> {
  const current = await getTraveler(ctx, guildId, userId);
  if (!current) return null;
  const hit = Math.max(0, Math.trunc(amount));
  let health = current.health - hit;
  const fainted = health <= 0;
  const distance = fainted ? Math.floor(current.distance / 2) : current.distance;
  if (fainted) health = current.maxHealth;
  const traveler = await ctx.db.traveler.update({
    where: { guildId_userId: { guildId, userId } },
    data: {
      health: clamp(health, 0, current.maxHealth),
      distance,
      deaths: fainted ? { increment: 1 } : undefined,
    },
  });
  return { health: traveler.health, maxHealth: traveler.maxHealth, fainted };
}

/** Effets « sur soi » d'un objet (potion, boussole…) appliqués au voyageur. */
export interface SelfBoost {
  health: number;
  energy: number;
  distance: number;
}

/**
 * Applique un bonus/malus au PROPRE voyageur d'un membre (soin, énergie,
 * distance). Crée le voyageur si besoin. Valeurs bornées comme en jeu.
 */
export async function boostTraveler(
  ctx: BotContext,
  guildId: string,
  userId: string,
  boost: SelfBoost,
): Promise<Traveler> {
  const current = await ensureTraveler(ctx, guildId, userId);
  return ctx.db.traveler.update({
    where: { guildId_userId: { guildId, userId } },
    data: {
      health: clamp(current.health + boost.health, 0, current.maxHealth),
      energy: clamp(current.energy + boost.energy, ENERGY_MIN, ENERGY_MAX),
      energyAt: new Date(),
      distance: Math.max(0, current.distance + boost.distance),
    },
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
  /** Vrai si le voyageur est parti avec une énergie NÉGATIVE (malus appliqués). */
  exhausted: boolean;
  traveler: Traveler;
}

/** Fait avancer le voyageur : résout un événement, applique ses effets, persiste. */
export async function move(ctx: BotContext, guildId: string, userId: string): Promise<MoveOutcome> {
  const config = await getRouteConfig(ctx, guildId);
  const current = await ensureTraveler(ctx, guildId, userId);
  const event = pickEvent(current.health >= current.maxHealth);

  // Régénération passive AVANT l'événement (elle peut sortir du négatif).
  const startEnergy = applyEnergyRegen(current, config);
  // ÉPUISÉ (énergie négative au départ) : progression réduite de moitié et
  // dégâts amplifiés ×1.5 — mieux vaut se reposer ou utiliser une provision.
  const exhausted = startEnergy < 0;

  const deltas = {
    health: between(event.health),
    energy: between(event.energy),
    distance: between(event.distance),
    coins: between(event.coins),
  };
  if (exhausted) {
    if (deltas.distance > 0) deltas.distance = Math.floor(deltas.distance / 2);
    if (deltas.health < 0) deltas.health = Math.floor(deltas.health * 1.5);
  }

  let health = current.health + deltas.health;
  // Certains événements font RECULER (distance négative) : on autorise le recul,
  // sans jamais repasser sous 0.
  let distance = Math.max(0, current.distance + deltas.distance);
  const fainted = health <= 0;
  if (fainted) {
    health = current.maxHealth;
    distance = Math.floor(distance / 2);
  }
  // L'énergie peut passer en NÉGATIF (malus au prochain pas) ; la régénération
  // passive repart de maintenant.
  const energy = clamp(startEnergy + deltas.energy, ENERGY_MIN, ENERGY_MAX);

  // Pièces du voyageur : certains événements (voleur, pari perdu…) en VOLENT —
  // le compteur peut baisser, sans jamais passer sous 0.
  const coinsTotal = Math.max(0, current.coins + deltas.coins);

  // Objet trouvé (marchand) si activé : tirage par rareté avec le barème PROPRE
  // à la Route, limité aux objets marqués « Drop en jeu » (droppable).
  let itemFound: { emoji: string; name: string } | null = null;
  if (event.item && config.giveItems) {
    const pick = await rollDropByChances(ctx, guildId, config.drops);
    if (pick) {
      await addToInventory(ctx, guildId, userId, pick.id, 1);
      itemFound = { emoji: pick.emoji, name: pick.name };
    }
  }

  // Pièces créditées sur l'économie du serveur si activé (gains uniquement :
  // les vols/pertes ne touchent que le compteur de la Route).
  if (config.giveCoins && deltas.coins > 0) {
    await addBalance(ctx, guildId, userId, deltas.coins);
  }

  const traveler = await ctx.db.traveler.update({
    where: { guildId_userId: { guildId, userId } },
    data: {
      health: clamp(health, 0, current.maxHealth),
      energy,
      energyAt: new Date(),
      distance,
      coins: coinsTotal,
      events: { increment: 1 },
      deaths: fainted ? { increment: 1 } : undefined,
      lastMoveAt: new Date(),
    },
  });

  return { eventKey: event.key, deltas, itemFound, fainted, exhausted, traveler };
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

// --- Provisions (boutique / marchand ambulant) --------------------------------

export type BuyResult =
  | { ok: true; traveler: Traveler; price: number; balance: number }
  | { ok: false; reason: 'poor'; price: number; balance: number };

/** Achat avec effet IMMÉDIAT : débite le solde et applique la provision. */
async function purchaseGood(
  ctx: BotContext,
  guildId: string,
  userId: string,
  good: GoodKey,
  price: number,
  config: RouteConfig,
): Promise<BuyResult> {
  const balance = await getBalance(ctx, guildId, userId);
  if (balance < price) return { ok: false, reason: 'poor', price, balance };
  await addBalance(ctx, guildId, userId, -price);
  const current = await ensureTraveler(ctx, guildId, userId);
  const effect = GOODS[good];
  const traveler = await ctx.db.traveler.update({
    where: { guildId_userId: { guildId, userId } },
    data: {
      health: clamp(current.health + effect.health, 0, current.maxHealth),
      energy: clamp(applyEnergyRegen(current, config) + effect.energy, ENERGY_MIN, ENERGY_MAX),
      energyAt: new Date(),
    },
  });
  return { ok: true, traveler, price, balance: balance - price };
}

/** Achète une provision à la boutique (prix boutique). */
export async function buyGood(
  ctx: BotContext,
  guildId: string,
  userId: string,
  good: GoodKey,
): Promise<BuyResult> {
  const config = await getRouteConfig(ctx, guildId);
  return purchaseGood(ctx, guildId, userId, good, config.shopPrices[good], config);
}

/** Achète une provision au marchand ambulant (prix préférentiels de l'événement). */
export async function peddlerBuy(
  ctx: BotContext,
  guildId: string,
  userId: string,
  good: GoodKey,
): Promise<BuyResult> {
  const config = await getRouteConfig(ctx, guildId);
  return purchaseGood(ctx, guildId, userId, good, config.peddlerPrices[good], config);
}
