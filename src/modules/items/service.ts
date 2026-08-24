import { randomInt } from 'node:crypto';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import {
  MODULE_NAME,
  RARITIES,
  RARITIES_BY_RARITY,
  type Rarity,
  getItemsConfig,
} from './config.js';
import { itemEffectsSchema } from './effects-schema.js';

/** Un objet du catalogue (sous-ensemble des colonnes Prisma utilisées). */
export interface Item {
  id: string;
  guildId: string;
  name: string;
  emoji: string;
  description: string;
  rarity: string;
  price: number;
  buyable: boolean;
  tradable: boolean;
  droppable: boolean;
  usable: boolean;
  roleReward: string | null;
  /** Effets à l'utilisation (JSON validé par itemEffectsSchema). */
  effects: string;
  /** true = consommé (supprimé) à l'usage ; false = réutilisable. */
  consumable: boolean;
  /** Délai (s) entre deux usages si non consommable (0 = aucun). */
  cooldownSeconds: number;
}

/** Données modifiables d'un objet (création / édition). */
export type ItemInput = Partial<
  Pick<
    Item,
    | 'name'
    | 'emoji'
    | 'description'
    | 'rarity'
    | 'price'
    | 'buyable'
    | 'tradable'
    | 'droppable'
    | 'usable'
    | 'roleReward'
    | 'effects'
    | 'consumable'
    | 'cooldownSeconds'
  >
>;

/** Cooldown maximum acceptable pour un objet réutilisable (30 jours). */
const COOLDOWN_MAX = 2_592_000;

/** Bornes de prix (identiques à la saisie Discord). */
const PRICE_MIN = 0;
const PRICE_MAX = 100_000_000;

/** Emoji personnalisé Discord (`<:name:id>` / `<a:name:id>`). */
const CUSTOM_EMOJI = /^<a?:\w+:\d+>$/;

/** Ne garde qu'un emoji « affichable » : personnalisé Discord ou pictogramme. */
function sanitizeEmoji(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (CUSTOM_EMOJI.test(value)) return value;
  if (/\p{Extended_Pictographic}/u.test(value)) return value;
  return '📦';
}

/** Convertit/borne un prix venu de l'extérieur (nombre ou chaîne). */
function clampPrice(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return PRICE_MIN;
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.trunc(n)));
}

/**
 * Nettoie et borne une entrée d'objet provenant d'une source externe (API web) :
 * mêmes règles que la saisie Discord (longueurs, rareté connue, prix borné,
 * emoji affichable). Seules les clés présentes sont renvoyées, pour permettre
 * les mises à jour partielles. Le nom, s'il est fourni, peut ressortir vide :
 * l'appelant décide alors s'il le rejette (création) ou l'ignore (édition).
 */
export function sanitizeItemInput(raw: Record<string, unknown>): ItemInput {
  const out: ItemInput = {};
  if (typeof raw.name === 'string') out.name = raw.name.trim().slice(0, 60);
  if (raw.emoji !== undefined) out.emoji = sanitizeEmoji(raw.emoji);
  if (typeof raw.description === 'string') out.description = raw.description.trim().slice(0, 300);
  if (typeof raw.rarity === 'string') {
    out.rarity = (RARITIES as readonly string[]).includes(raw.rarity) ? raw.rarity : 'common';
  }
  if (raw.price !== undefined) out.price = clampPrice(raw.price);
  for (const flag of ['buyable', 'tradable', 'droppable', 'usable'] as const) {
    if (raw[flag] !== undefined) out[flag] = raw[flag] === true;
  }
  if (raw.roleReward !== undefined) {
    out.roleReward =
      typeof raw.roleReward === 'string' && /^\d{5,25}$/.test(raw.roleReward)
        ? raw.roleReward
        : null;
  }
  if (raw.consumable !== undefined) out.consumable = raw.consumable === true;
  if (raw.cooldownSeconds !== undefined) {
    const n =
      typeof raw.cooldownSeconds === 'number'
        ? raw.cooldownSeconds
        : Number.parseInt(String(raw.cooldownSeconds ?? ''), 10);
    out.cooldownSeconds = Number.isFinite(n)
      ? Math.min(COOLDOWN_MAX, Math.max(0, Math.trunc(n)))
      : 0;
  }
  if (raw.effects !== undefined) {
    // Accepte un tableau (API web) ou une chaîne JSON ; ne persiste que du valide.
    const value =
      typeof raw.effects === 'string'
        ? (() => {
            try {
              return JSON.parse(raw.effects) as unknown;
            } catch {
              return [];
            }
          })()
        : raw.effects;
    const parsed = itemEffectsSchema.safeParse(value);
    out.effects = JSON.stringify(parsed.success ? parsed.data : []);
  }
  return out;
}

// --- Cooldown d'utilisation (objets réutilisables) --------------------------

/** Horodatage du dernier usage d'un objet par un membre (null si jamais). */
export async function getItemUsedAt(
  ctx: BotContext,
  guildId: string,
  userId: string,
  itemId: string,
): Promise<Date | null> {
  const row = await ctx.db.inventoryItem.findUnique({
    where: { guildId_userId_itemId: { guildId, userId, itemId } },
  });
  return row?.usedAt ?? null;
}

/** Marque un objet comme utilisé maintenant (base du cooldown). */
export async function markItemUsed(
  ctx: BotContext,
  guildId: string,
  userId: string,
  itemId: string,
): Promise<void> {
  await ctx.db.inventoryItem
    .update({
      where: { guildId_userId_itemId: { guildId, userId, itemId } },
      data: { usedAt: new Date() },
    })
    .catch(() => undefined);
}

const RARITY_EMOJI: Record<Rarity, string> = {
  common: '⚪',
  rare: '🔵',
  epic: '🟣',
  legendary: '🟠',
};

const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x9aa0a6,
  rare: 0x1f6feb,
  epic: 0x8957e5,
  legendary: 0xf59e0b,
};

function asRarity(rarity: string): Rarity {
  return rarity in RARITY_EMOJI ? (rarity as Rarity) : 'common';
}

/** Pastille d'une rareté (emoji + libellé traduit). */
export function rarityLabel(rarity: string): string {
  const r = asRarity(rarity);
  return `${RARITY_EMOJI[r]} ${t(`modules.items.rarity.${r}`)}`;
}

/** Couleur d'embed associée à la rareté. */
export function rarityColor(rarity: string): number {
  return RARITY_COLOR[asRarity(rarity)] ?? Colors.brand;
}

// --- Catalogue --------------------------------------------------------------

export async function listItems(ctx: BotContext, guildId: string): Promise<Item[]> {
  return ctx.db.item.findMany({
    where: { guildId },
    orderBy: [{ price: 'asc' }, { name: 'asc' }],
  });
}

export async function getItem(
  ctx: BotContext,
  guildId: string,
  itemId: string,
): Promise<Item | null> {
  const item = await ctx.db.item.findUnique({ where: { id: itemId } });
  return item && item.guildId === guildId ? item : null;
}

export async function countItems(ctx: BotContext, guildId: string): Promise<number> {
  return ctx.db.item.count({ where: { guildId } });
}

export async function createItem(
  ctx: BotContext,
  guildId: string,
  data: ItemInput & { name: string },
): Promise<Item> {
  return ctx.db.item.create({ data: { guildId, ...data } });
}

export async function updateItem(ctx: BotContext, itemId: string, data: ItemInput): Promise<void> {
  await ctx.db.item.update({ where: { id: itemId }, data });
}

export async function deleteItem(ctx: BotContext, itemId: string): Promise<void> {
  // Les entrées d'inventaire sont supprimées en cascade (onDelete: Cascade).
  await ctx.db.item.delete({ where: { id: itemId } }).catch(() => undefined);
}

// --- Inventaires ------------------------------------------------------------

export interface InventoryLine {
  item: Item;
  quantity: number;
}

/** Inventaire d'un membre : objets encore présents (quantité > 0). */
export async function getInventory(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<InventoryLine[]> {
  const rows = await ctx.db.inventoryItem.findMany({
    where: { guildId, userId, quantity: { gt: 0 } },
    include: { item: true },
  });
  return rows
    .filter((row): row is typeof row & { item: Item } => row.item !== null)
    .map((row) => ({ item: row.item, quantity: row.quantity }))
    .sort((a, b) => a.item.price - b.item.price || a.item.name.localeCompare(b.item.name));
}

export async function getQuantity(
  ctx: BotContext,
  guildId: string,
  userId: string,
  itemId: string,
): Promise<number> {
  const row = await ctx.db.inventoryItem.findUnique({
    where: { guildId_userId_itemId: { guildId, userId, itemId } },
  });
  return row?.quantity ?? 0;
}

/** Ajoute `qty` exemplaires (qty négatif pour retirer). Renvoie la quantité finale. */
export async function addToInventory(
  ctx: BotContext,
  guildId: string,
  userId: string,
  itemId: string,
  qty: number,
): Promise<number> {
  const row = await ctx.db.inventoryItem.upsert({
    where: { guildId_userId_itemId: { guildId, userId, itemId } },
    update: { quantity: { increment: qty } },
    create: { guildId, userId, itemId, quantity: Math.max(0, qty) },
  });
  if (row.quantity <= 0) {
    await ctx.db.inventoryItem.delete({ where: { id: row.id } }).catch(() => undefined);
    return 0;
  }
  return row.quantity;
}

/** Retire `qty` exemplaires si le membre les possède. `false` si stock insuffisant. */
export async function takeFromInventory(
  ctx: BotContext,
  guildId: string,
  userId: string,
  itemId: string,
  qty: number,
): Promise<boolean> {
  const current = await getQuantity(ctx, guildId, userId, itemId);
  if (current < qty) return false;
  await addToInventory(ctx, guildId, userId, itemId, -qty);
  return true;
}

// --- Drops (butin des mini-jeux) --------------------------------------------

/** Issue d'une partie du point de vue d'un joueur (aligné sur le module Jeux). */
export type GameOutcome = 'win' | 'loss' | 'draw';

/** Objets d'une rareté donnée éligibles au drop (`droppable = true`). */
export async function listDroppable(
  ctx: BotContext,
  guildId: string,
  rarity: Rarity,
): Promise<Item[]> {
  return ctx.db.item.findMany({ where: { guildId, rarity, droppable: true } });
}

/** Pourcentage de drop (0-100) par rareté. */
export type RarityChances = Record<Rarity, number>;

/**
 * Tirage d'un objet `droppable` à partir de pourcentages PAR RARETÉ, de la plus
 * rare à la plus commune : la première rareté dont le tirage réussit renvoie un
 * objet aléatoire `droppable` de cette rareté. `null` si aucune ne tombe.
 *
 * Ne touche PAS à l'inventaire (à la charge de l'appelant). Réutilisable par les
 * différents contextes de drop (mini-jeux, Route de l'Infini…), chacun avec son
 * propre barème de chances.
 */
export async function rollDropByChances(
  ctx: BotContext,
  guildId: string,
  chances: RarityChances,
): Promise<Item | null> {
  for (const rarity of RARITIES_BY_RARITY) {
    const chance = chances[rarity];
    if (chance <= 0) continue;
    if (randomInt(100) >= chance) continue;
    const pool = await listDroppable(ctx, guildId, rarity);
    if (pool.length === 0) continue; // pas d'objet de cette rareté : rareté suivante
    const item = pool[randomInt(pool.length)];
    if (item) return item;
  }
  return null;
}

/** Une issue déclenche-t-elle un tirage de drop selon le mode configuré ? */
function outcomeTriggersDrop(outcome: GameOutcome, on: 'win' | 'winDraw' | 'any'): boolean {
  if (on === 'any') return true;
  if (on === 'winDraw') return outcome === 'win' || outcome === 'draw';
  return outcome === 'win';
}

/**
 * Tente de faire tomber un objet pour `userId` après une partie de mini-jeu.
 *
 * - Ne fait rien si le module « Objets » est désactivé, les drops désactivés,
 *   ou l'issue non éligible (selon `drops.on`).
 * - Utilise le barème de chances des mini-jeux (config du module Objets) ; le
 *   membre reçoit l'objet tombé dans son inventaire (+1). Renvoie-le, ou `null`.
 */
export async function rollGameDrop(
  ctx: BotContext,
  guildId: string,
  userId: string,
  outcome: GameOutcome,
): Promise<Item | null> {
  if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) return null;

  const { drops } = await getItemsConfig(ctx, guildId);
  if (!drops.enabled || !outcomeTriggersDrop(outcome, drops.on)) return null;

  const item = await rollDropByChances(ctx, guildId, {
    common: drops.common,
    rare: drops.rare,
    epic: drops.epic,
    legendary: drops.legendary,
  });
  if (!item) return null;
  await addToInventory(ctx, guildId, userId, item.id, 1);
  return item;
}
