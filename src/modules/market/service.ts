import type { BotContext } from '../../core/module.js';
import { addBalance, getBalance } from '../economy/service.js';
import { addToInventory, takeFromInventory, type Item } from '../items/service.js';
import { getMarketConfig } from './config.js';

/** Nombre d'annonces affichées par page dans l'hôtel des ventes. */
export const PAGE_SIZE = 10;

/** Une annonce avec son objet résolu. */
export interface Listing {
  id: string;
  guildId: string;
  sellerId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  createdAt: Date;
  item: Item;
}

function toListing(row: {
  id: string;
  guildId: string;
  sellerId: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  createdAt: Date;
  item: Item | null;
}): Listing | null {
  return row.item ? { ...row, item: row.item } : null;
}

/** Annonces actives (page `page`, 0-index), les plus récentes d'abord. */
export async function listActiveListings(
  ctx: BotContext,
  guildId: string,
  page = 0,
): Promise<Listing[]> {
  const rows = await ctx.db.marketListing.findMany({
    where: { guildId, quantity: { gt: 0 } },
    include: { item: true },
    orderBy: { createdAt: 'desc' },
    skip: Math.max(0, page) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return rows.map(toListing).filter((l): l is Listing => l !== null);
}

/** Nombre total d'annonces actives sur le serveur. */
export async function countActiveListings(ctx: BotContext, guildId: string): Promise<number> {
  return ctx.db.marketListing.count({ where: { guildId, quantity: { gt: 0 } } });
}

/** Annonces actives d'un membre. */
export async function userListings(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<Listing[]> {
  const rows = await ctx.db.marketListing.findMany({
    where: { guildId, sellerId: userId, quantity: { gt: 0 } },
    include: { item: true },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  return rows.map(toListing).filter((l): l is Listing => l !== null);
}

export type CreateResult =
  | { ok: true; listing: Listing }
  | { ok: false; reason: 'tooMany' | 'notOwned' }
  | { ok: false; reason: 'tooCheap'; min: number };

/**
 * Prix unitaire minimum autorisé pour vendre `item` : le max entre le plancher
 * fixe (`minPrice`) et un pourcentage du prix boutique (`minPricePercent`).
 */
export function minListingPrice(
  item: Item,
  config: {
    minPrice: number;
    minPricePercent: number;
  },
): number {
  const fromShop = Math.floor((item.price * config.minPricePercent) / 100);
  return Math.max(config.minPrice, fromShop);
}

/**
 * Met `qty` exemplaires de `item` en vente à `unitPrice`. Les objets sont
 * RETIRÉS de l'inventaire du vendeur (séquestre) le temps de l'annonce.
 */
export async function createListing(
  ctx: BotContext,
  guildId: string,
  sellerId: string,
  item: Item,
  qty: number,
  unitPrice: number,
): Promise<CreateResult> {
  const config = await getMarketConfig(ctx, guildId);
  const minUnit = minListingPrice(item, config);
  if (unitPrice < minUnit) return { ok: false, reason: 'tooCheap', min: minUnit };

  const active = await ctx.db.marketListing.count({
    where: { guildId, sellerId, quantity: { gt: 0 } },
  });
  if (active >= config.maxListingsPerUser) return { ok: false, reason: 'tooMany' };

  // Séquestre : on retire d'abord les objets, l'annonce n'existe que s'ils y sont.
  const took = await takeFromInventory(ctx, guildId, sellerId, item.id, qty);
  if (!took) return { ok: false, reason: 'notOwned' };

  const row = await ctx.db.marketListing.create({
    data: { guildId, sellerId, itemId: item.id, quantity: qty, unitPrice },
    include: { item: true },
  });
  const listing = toListing(row);
  if (!listing) {
    // Cas improbable (objet supprimé entre-temps) : on rend les objets.
    await addToInventory(ctx, guildId, sellerId, item.id, qty);
    return { ok: false, reason: 'notOwned' };
  }
  return { ok: true, listing };
}

export type BuyResult =
  | {
      ok: true;
      item: Item;
      qty: number;
      cost: number;
      sellerId: string;
      sellerGain: number;
      tax: number;
      balance: number;
    }
  | { ok: false; reason: 'gone' | 'ownListing' | 'insufficient' };

/**
 * Achète `qty` exemplaires de l'annonce `listingId`. Débite l'acheteur, paie le
 * vendeur (moins la taxe serveur), livre les objets et décrémente l'annonce.
 * La décrémentation est CONDITIONNELLE (concurrence : « premier arrivé »).
 */
export async function buyListing(
  ctx: BotContext,
  guildId: string,
  buyerId: string,
  listingId: string,
  qty: number,
): Promise<BuyResult> {
  const row = await ctx.db.marketListing.findFirst({
    where: { id: listingId, guildId },
    include: { item: true },
  });
  const listing = row ? toListing(row) : null;
  if (!listing || listing.quantity <= 0) return { ok: false, reason: 'gone' };
  if (listing.sellerId === buyerId) return { ok: false, reason: 'ownListing' };

  const buyQty = Math.min(Math.max(1, qty), listing.quantity);
  const cost = buyQty * listing.unitPrice;

  const balance = await getBalance(ctx, guildId, buyerId);
  if (balance < cost) return { ok: false, reason: 'insufficient' };

  // Réservation atomique de la quantité : évite un double-achat concurrent.
  const reserved = await ctx.db.marketListing.updateMany({
    where: { id: listingId, quantity: { gte: buyQty } },
    data: { quantity: { decrement: buyQty } },
  });
  if (reserved.count === 0) return { ok: false, reason: 'gone' };

  // L'annonce vidée est supprimée.
  await ctx.db.marketListing
    .deleteMany({ where: { id: listingId, quantity: { lte: 0 } } })
    .catch(() => undefined);

  const config = await getMarketConfig(ctx, guildId);
  const tax = Math.floor((cost * config.taxPercent) / 100);
  const sellerGain = cost - tax;

  const newBalance = await addBalance(ctx, guildId, buyerId, -cost);
  await addBalance(ctx, guildId, listing.sellerId, sellerGain);
  await addToInventory(ctx, guildId, buyerId, listing.itemId, buyQty);

  return {
    ok: true,
    item: listing.item,
    qty: buyQty,
    cost,
    sellerId: listing.sellerId,
    sellerGain,
    tax,
    balance: newBalance,
  };
}

export type CancelResult =
  | { ok: true; item: Item; qty: number; sellerId: string }
  | { ok: false; reason: 'gone' | 'notYours' };

/**
 * Annule une annonce et rend les objets séquestrés au vendeur. Réservé au
 * vendeur, sauf `isAdmin` (staff) qui peut retirer n'importe quelle annonce.
 */
export async function cancelListing(
  ctx: BotContext,
  guildId: string,
  userId: string,
  listingId: string,
  isAdmin: boolean,
): Promise<CancelResult> {
  const row = await ctx.db.marketListing.findFirst({
    where: { id: listingId, guildId },
    include: { item: true },
  });
  const listing = row ? toListing(row) : null;
  if (!listing) return { ok: false, reason: 'gone' };
  if (listing.sellerId !== userId && !isAdmin) return { ok: false, reason: 'notYours' };

  // Suppression atomique : si une autre action l'a déjà retirée, on n'y touche pas.
  const removed = await ctx.db.marketListing.deleteMany({ where: { id: listingId, guildId } });
  if (removed.count === 0) return { ok: false, reason: 'gone' };

  await addToInventory(ctx, guildId, listing.sellerId, listing.itemId, listing.quantity);
  return { ok: true, item: listing.item, qty: listing.quantity, sellerId: listing.sellerId };
}

/** Récupère une annonce précise (avec objet). */
export async function getListingById(
  ctx: BotContext,
  guildId: string,
  listingId: string,
): Promise<Listing | null> {
  const row = await ctx.db.marketListing.findFirst({
    where: { id: listingId, guildId },
    include: { item: true },
  });
  return row ? toListing(row) : null;
}
