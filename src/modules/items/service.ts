import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import { type Rarity } from './config.js';

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
  usable: boolean;
  roleReward: string | null;
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
    | 'usable'
    | 'roleReward'
  >
>;

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
