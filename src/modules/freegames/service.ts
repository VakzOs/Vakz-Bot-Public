import { EmbedBuilder } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { fetchWithTimeout } from '../../lib/http.js';
import { MODULE_NAME, type FreegamesConfig, type Platform, getFreegamesConfig } from './config.js';

const STEAM_FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?cc=fr&l=french';
const EPIC_PROMOTIONS_URL =
  'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR';
const GOG_GIVEAWAY_URL = 'https://www.gog.com/giveaway/api/get_current_giveaway';

/** Couleur d'embed par plateforme. */
const PLATFORM_COLOR: Record<Platform, number> = {
  steam: 0x1b2838,
  epic: 0x2a2a2a,
  gog: 0x7b32a8,
};

/** Libellé « boutique » affiché en pied d'embed. */
const PLATFORM_STORE: Record<Platform, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
};

export interface FreeGame {
  platform: Platform;
  gameId: string;
  name: string;
  image: string;
  url: string;
  /** Prix d'origine formaté (ex. « 19,99 EUR »), ou null. */
  originalPrice: string | null;
}

// --- Steam ------------------------------------------------------------------

interface SteamSpecialItem {
  id?: number;
  name?: string;
  discount_percent?: number;
  discounted?: boolean;
  final_price?: number;
  original_price?: number;
  currency?: string;
  header_image?: string;
}

/**
 * Extrait les jeux « offerts » (100 % de remise) d'une réponse Steam
 * `featuredcategories`. Les jeux free-to-play (non soldés) sont ignorés.
 */
export function parseSteamFreeGames(data: unknown): FreeGame[] {
  const specials = (data as { specials?: { items?: unknown[] } } | null)?.specials;
  const items = Array.isArray(specials?.items) ? specials.items : [];
  const games: FreeGame[] = [];
  for (const raw of items) {
    const item = raw as SteamSpecialItem;
    const free =
      item.discount_percent === 100 || (item.discounted === true && item.final_price === 0);
    if (!free || typeof item.id !== 'number' || !item.name) continue;
    const originalPrice =
      typeof item.original_price === 'number' && item.original_price > 0
        ? `${(item.original_price / 100).toFixed(2).replace('.', ',')} ${item.currency ?? ''}`.trim()
        : null;
    games.push({
      platform: 'steam',
      gameId: String(item.id),
      name: item.name,
      image:
        item.header_image ??
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`,
      url: `https://store.steampowered.com/app/${item.id}`,
      originalPrice,
    });
  }
  return games;
}

async function fetchSteamFreeGames(): Promise<FreeGame[]> {
  const res = await fetchWithTimeout(STEAM_FEATURED_URL, {
    headers: { 'accept-language': 'fr' },
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => null)) as unknown;
  return data ? parseSteamFreeGames(data) : [];
}

// --- Epic Games -------------------------------------------------------------

interface EpicElement {
  title?: string;
  id?: string;
  productSlug?: string | null;
  urlSlug?: string;
  keyImages?: Array<{ type?: string; url?: string }>;
  catalogNs?: { mappings?: Array<{ pageSlug?: string }> };
  offerMappings?: Array<{ pageSlug?: string }>;
  price?: {
    totalPrice?: {
      discountPrice?: number;
      originalPrice?: number;
      currencyCode?: string;
      fmtPrice?: { originalPrice?: string };
    };
  };
  promotions?: {
    promotionalOffers?: Array<{
      promotionalOffers?: Array<{
        startDate?: string;
        endDate?: string;
        discountSetting?: { discountPercentage?: number };
      }>;
    }>;
  } | null;
}

function epicIsFreeNow(el: EpicElement): boolean {
  const offers = el.promotions?.promotionalOffers ?? [];
  const now = Date.now();
  const active = offers.some((group) =>
    (group.promotionalOffers ?? []).some((offer) => {
      const start = offer.startDate ? Date.parse(offer.startDate) : NaN;
      const end = offer.endDate ? Date.parse(offer.endDate) : NaN;
      const inRange = (Number.isNaN(start) || start <= now) && (Number.isNaN(end) || end >= now);
      const fullDiscount = offer.discountSetting?.discountPercentage === 0;
      return inRange && fullDiscount;
    }),
  );
  return active && el.price?.totalPrice?.discountPrice === 0;
}

function epicSlug(el: EpicElement): string | null {
  const raw =
    el.offerMappings?.[0]?.pageSlug ??
    el.catalogNs?.mappings?.[0]?.pageSlug ??
    (el.productSlug && el.productSlug !== '[]' ? el.productSlug : null) ??
    el.urlSlug ??
    null;
  return raw ? raw.replace(/\/home$/, '') : null;
}

function epicImage(el: EpicElement): string {
  const images = el.keyImages ?? [];
  const priority = ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'OfferImageTall'];
  for (const type of priority) {
    const found = images.find((img) => img.type === type && img.url);
    if (found?.url) return found.url;
  }
  return images.find((img) => img.url)?.url ?? '';
}

/** Extrait les jeux actuellement offerts d'une réponse Epic `freeGamesPromotions`. */
export function parseEpicFreeGames(data: unknown): FreeGame[] {
  const elements = (
    data as { data?: { Catalog?: { searchStore?: { elements?: unknown[] } } } } | null
  )?.data?.Catalog?.searchStore?.elements;
  const list = Array.isArray(elements) ? elements : [];
  const games: FreeGame[] = [];
  for (const raw of list) {
    const el = raw as EpicElement;
    if (!el.title || !epicIsFreeNow(el)) continue;
    const slug = epicSlug(el);
    if (!slug) continue;
    const total = el.price?.totalPrice;
    const originalPrice =
      total?.fmtPrice?.originalPrice && total.fmtPrice.originalPrice !== '0'
        ? total.fmtPrice.originalPrice
        : typeof total?.originalPrice === 'number' && total.originalPrice > 0
          ? `${(total.originalPrice / 100).toFixed(2).replace('.', ',')} ${total.currencyCode ?? ''}`.trim()
          : null;
    games.push({
      platform: 'epic',
      gameId: el.id ?? slug,
      name: el.title,
      image: epicImage(el),
      url: `https://store.epicgames.com/p/${slug}`,
      originalPrice,
    });
  }
  return games;
}

async function fetchEpicFreeGames(): Promise<FreeGame[]> {
  const res = await fetchWithTimeout(EPIC_PROMOTIONS_URL, {
    headers: { 'accept-language': 'fr' },
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => null)) as unknown;
  return data ? parseEpicFreeGames(data) : [];
}

// --- GOG --------------------------------------------------------------------

interface GogGiveaway {
  id?: string | number;
  name?: string;
  title?: string;
  gameId?: string | number;
  slug?: string;
  url?: string;
  image?: string;
}

/**
 * Extrait le jeu offert de l'API de giveaway GOG. GOG ne publie qu'un giveaway
 * à la fois (souvent aucun) : la réponse est `null`/vide hors période. Best-effort
 * et tolérant aux changements de structure (renvoie [] si non reconnue).
 */
export function parseGogGiveaway(data: unknown): FreeGame[] {
  const g = data as GogGiveaway | null;
  const name = g?.name ?? g?.title;
  if (!g || !name) return [];
  const id = String(g.gameId ?? g.id ?? g.slug ?? name);
  const slug = g.slug ?? g.url;
  const url = slug
    ? /^https?:\/\//.test(slug)
      ? slug
      : `https://www.gog.com/game/${slug}`
    : 'https://www.gog.com/#giveaway';
  return [
    {
      platform: 'gog',
      gameId: id,
      name,
      image: g.image ?? '',
      url,
      originalPrice: null,
    },
  ];
}

async function fetchGogFreeGames(): Promise<FreeGame[]> {
  const res = await fetchWithTimeout(GOG_GIVEAWAY_URL, {
    headers: { 'accept-language': 'fr' },
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => null)) as unknown;
  return data ? parseGogGiveaway(data) : [];
}

// --- Agrégation -------------------------------------------------------------

const FETCHERS: Record<Platform, () => Promise<FreeGame[]>> = {
  steam: fetchSteamFreeGames,
  epic: fetchEpicFreeGames,
  gog: fetchGogFreeGames,
};

/** Récupère les jeux gratuits des plateformes demandées (erreurs isolées par plateforme). */
export async function fetchFreeGames(platforms: readonly Platform[]): Promise<FreeGame[]> {
  const results = await Promise.all(
    platforms.map((platform) => FETCHERS[platform]().catch(() => [] as FreeGame[])),
  );
  return results.flat();
}

// --- Annonce ----------------------------------------------------------------

/** Embed d'annonce d'un jeu gratuit. */
export function buildFreeGameEmbed(game: FreeGame): EmbedBuilder {
  const store = PLATFORM_STORE[game.platform];
  const embed = new EmbedBuilder()
    .setColor(PLATFORM_COLOR[game.platform])
    .setTitle(game.name)
    .setURL(game.url)
    .setDescription(t('modules.freegames.embedDescription', { store, url: game.url }))
    .setFooter({ text: store });
  if (game.image) embed.setImage(game.image);
  if (game.originalPrice) {
    embed.addFields({
      name: t('modules.freegames.priceField'),
      value: `~~${game.originalPrice}~~ → **${t('modules.freegames.free')}**`,
    });
  }
  return embed;
}

/** Annonce sur un serveur les jeux pas encore annoncés (dédup par plateforme + id). */
async function announceForGuild(
  ctx: BotContext,
  guildId: string,
  config: FreegamesConfig,
  games: FreeGame[],
): Promise<void> {
  if (!config.channelId) return;
  const channel = await ctx.client.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) return;

  for (const game of games) {
    if (!config.platforms.includes(game.platform)) continue;
    // La contrainte d'unicité (guildId, source, gameId) sert de dédup.
    const isNew = await ctx.db.freeGameAnnouncement
      .create({ data: { guildId, source: game.platform, gameId: game.gameId } })
      .then(() => true)
      .catch(() => false);
    if (!isNew) continue;

    await channel
      .send({
        ...(config.roleId ? { content: `<@&${config.roleId}>` } : {}),
        embeds: [buildFreeGameEmbed(game)],
        allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] },
      })
      .catch((error: unknown) =>
        ctx.logger.warn({ err: error, guildId }, 'Annonce de jeu gratuit échouée'),
      );
  }
}

/** Contrôle périodique : annonce les nouveaux jeux gratuits sur les serveurs actifs. */
export async function pollFreeGames(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);
  if (rows.length === 0) return;

  const configs = await Promise.all(
    rows.map(async (row) => ({
      guildId: row.guildId,
      config: await getFreegamesConfig(ctx, row.guildId),
    })),
  );

  // On ne récupère que les plateformes réellement utilisées par au moins un serveur.
  const used = new Set<Platform>();
  for (const { config } of configs) for (const p of config.platforms) used.add(p);
  if (used.size === 0) return;

  const games = await fetchFreeGames([...used]);
  if (games.length === 0) return;

  for (const { guildId, config } of configs) {
    await announceForGuild(ctx, guildId, config, games);
  }
}
