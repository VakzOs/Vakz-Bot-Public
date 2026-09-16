import { EmbedBuilder } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { createLogger } from '../../core/logger.js';
import { fetchWithTimeout } from '../../lib/http.js';
import { MODULE_NAME, type FreegamesConfig, type Platform, getFreegamesConfig } from './config.js';

const log = createLogger('freegames');

/**
 * Recherche du store Steam restreinte aux promotions tombées à zéro
 * (`specials=1&maxprice=free`). C'est la seule vue qui liste *tous* les jeux
 * « gratuits à garder » : la vitrine `featuredcategories` n'en montre qu'une
 * vingtaine, choisis éditorialement, et rate donc la plupart des offres.
 */
const STEAM_SEARCH_URL =
  'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&maxprice=free&specials=1&infinite=1&cc=fr&l=french';
/** Vitrine Steam, gardée en second filet : elle ne coûte qu'un appel. */
const STEAM_FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?cc=fr&l=french';
const STEAM_APPDETAILS_URL = 'https://store.steampowered.com/api/appdetails';
/** Garde-fou : la recherche ne devrait ramener qu'une poignée d'offres. */
const STEAM_MAX_APPS = 12;
const EPIC_PROMOTIONS_URL =
  'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR';
const GOG_CATALOG_URL =
  'https://catalog.gog.com/v1/catalog?limit=48&page=1&order=desc:trending&productType=in:game,pack&price=between:0,0&discounted=eq:true&countryCode=FR&locale=fr-FR&currencyCode=EUR';
/** Ancienne API de giveaway GOG, gardée en second filet (souvent vide ou absente). */
const GOG_GIVEAWAY_URL = 'https://www.gog.com/giveaway/api/get_current_giveaway';

/** Identité envoyée aux boutiques : un `user-agent` absent se fait parfois refuser. */
const USER_AGENT = 'Vakz-Bot (+https://github.com/VakzOs/Vakz-Bot)';

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

/**
 * Appel JSON tolérant : renvoie `null` plutôt que de lever, mais **journalise**
 * l'échec. Sans cette trace, une boutique qui répond 403 ou du HTML est
 * indiscernable d'un « aucune offre en ce moment » : le module semble marcher
 * alors qu'il ne voit plus rien.
 *
 * La source et le code HTTP vont dans le **texte** du message, pas seulement
 * dans les champs pino : le hublot du dashboard ne retient que `msg`, `scope`
 * et `err` (voir `core/log-buffer.ts`). Une alerte « source injoignable » sans
 * le nom de la source ni le statut ne dit rien à qui la lit depuis là.
 */
async function fetchJson(url: string, source: string): Promise<unknown> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'accept-language': 'fr', 'user-agent': USER_AGENT },
    });
    if (!res.ok) {
      log.warn(
        { source, status: res.status },
        `Jeux gratuits : ${source} injoignable (HTTP ${res.status})`,
      );
      return null;
    }
    return await res.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn({ err: error, source }, `Jeux gratuits : ${source} illisible (${reason})`);
    return null;
  }
}

/** Retire les doublons d'un même jeu remonté par deux sources d'une plateforme. */
function dedupe(games: FreeGame[]): FreeGame[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    const key = `${game.platform}:${game.gameId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

/** Ce que la page de résultats dit déjà d'un jeu, avant toute vérification. */
export interface SteamSearchRow {
  appId: string;
  name: string | null;
  /** Remise affichée (100 pour « -100% »), ou null si absente de la ligne. */
  discountPercent: number | null;
  /** Prix final en centimes (0 pour une offre à zéro), ou null. */
  finalPriceCents: number | null;
  /** Prix barré tel qu'affiché (ex. « 16,79€ »), ou null. */
  originalPrice: string | null;
}

/** Entités HTML courantes dans un titre de jeu. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Relève les `appid` d'une page de résultats de recherche Steam.
 *
 * Steam sert cette recherche sous **deux formes** selon les paramètres, et
 * l'une comme l'autre répond 200 : `infinite=1` enrobe du HTML dans
 * `results_html`, tandis que `json=1` rend une liste `items` où l'appid
 * n'apparaît que dans l'URL de la vignette. Ne reconnaître qu'une des deux
 * revient à lire une réponse valide comme « aucune offre ». On les accepte
 * donc toutes les deux, plus le HTML nu au cas où.
 */
export function parseSteamSearchRows(data: unknown): SteamSearchRow[] {
  const rows: SteamSearchRow[] = [];
  const seen = new Set<string>();
  const add = (row: SteamSearchRow): boolean => {
    if (seen.has(row.appId)) return true;
    seen.add(row.appId);
    rows.push(row);
    return rows.length < STEAM_MAX_APPS;
  };

  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const html =
    typeof data === 'string'
      ? data
      : typeof record.results_html === 'string'
        ? record.results_html
        : null;

  if (html !== null) {
    // Les lots (appids séparés par une virgule, ou `data-ds-bundleid`) ne
    // correspondent pas au motif et sont écartés d'eux-mêmes.
    const pattern = /<a\b([^>]*data-ds-appid="(\d+)"[^>]*)>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const attrs = match[1] ?? '';
      const appId = match[2];
      const inner = match[3] ?? '';
      if (!appId) continue;
      const pct = /discount_pct[^>]*>\s*-?\s*(\d+)\s*%/.exec(inner)?.[1];
      const final =
        /data-price-final="(\d+)"/.exec(attrs)?.[1] ?? /data-price-final="(\d+)"/.exec(inner)?.[1];
      const original = /discount_original_price[^>]*>([^<]*)</.exec(inner)?.[1];
      const title = /<span class="title">([^<]*)<\/span>/.exec(inner)?.[1];
      if (
        !add({
          appId,
          name: title ? decodeEntities(title) : null,
          discountPercent: pct ? Number.parseInt(pct, 10) : null,
          finalPriceCents: final ? Number.parseInt(final, 10) : null,
          originalPrice: original ? decodeEntities(original) : null,
        })
      ) {
        break;
      }
    }
    if (rows.length > 0) return rows;
  }

  const items = Array.isArray(record.items) ? record.items : [];
  for (const raw of items) {
    const item = raw as {
      logo?: unknown;
      gameid?: unknown;
      appid?: unknown;
      name?: unknown;
      discount_percent?: unknown;
      final_price?: unknown;
      original_price?: unknown;
    };
    const direct = item.appid ?? item.gameid;
    const fromLogo =
      typeof item.logo === 'string' ? /\/apps\/(\d+)\//.exec(item.logo)?.[1] : undefined;
    const appId =
      typeof direct === 'number' || (typeof direct === 'string' && /^\d+$/.test(direct))
        ? String(direct)
        : fromLogo;
    if (!appId) continue;
    const original = item.original_price;
    if (
      !add({
        appId,
        name: typeof item.name === 'string' ? decodeEntities(item.name) : null,
        discountPercent: typeof item.discount_percent === 'number' ? item.discount_percent : null,
        finalPriceCents: typeof item.final_price === 'number' ? item.final_price : null,
        originalPrice:
          typeof original === 'number' && original > 0
            ? `${(original / 100).toFixed(2).replace('.', ',')} EUR`
            : null,
      })
    ) {
      break;
    }
  }
  return rows;
}

/**
 * Jeu offert reconstruit à partir de la seule ligne de recherche, quand
 * `appdetails` n'a pas confirmé. La recherche est déjà filtrée sur
 * `specials=1&maxprice=free` ; on exige en plus une marque explicite de
 * gratuité sur la ligne, pour ne jamais annoncer un jeu encore payant.
 */
export function steamRowToFreeGame(row: SteamSearchRow): FreeGame | null {
  // Un free-to-play affiche lui aussi un prix final nul : ce qui distingue une
  // offre à saisir, c'est la remise de 100 % ou le prix barré à côté du zéro.
  const free =
    row.discountPercent === 100 || (row.finalPriceCents === 0 && row.originalPrice !== null);
  if (!free || !row.name) return null;
  return {
    platform: 'steam',
    gameId: row.appId,
    name: row.name,
    image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${row.appId}/header.jpg`,
    url: `https://store.steampowered.com/app/${row.appId}`,
    originalPrice: row.originalPrice,
  };
}

interface SteamAppDetails {
  name?: string;
  is_free?: boolean;
  header_image?: string;
  price_overview?: {
    currency?: string;
    initial?: number;
    final?: number;
    discount_percent?: number;
    initial_formatted?: string;
  };
}

/**
 * Convertit une réponse `appdetails` en jeu offert, ou `null` si l'app n'est pas
 * gratuite à garder. Un free-to-play n'a pas de `price_overview` : exiger une
 * remise de 100 % sur un prix d'origine non nul écarte à la fois les F2P, les
 * démos et les week-ends gratuits.
 */
export function parseSteamAppDetails(appId: string, data: unknown): FreeGame | null {
  const entry = (
    data as Record<string, { success?: boolean; data?: SteamAppDetails } | undefined> | null
  )?.[appId];
  const app = entry?.success === true ? entry.data : undefined;
  const price = app?.price_overview;
  if (!app?.name || app.is_free === true || !price) return null;
  if (price.discount_percent !== 100 || price.final !== 0) return null;

  const originalPrice =
    price.initial_formatted && price.initial_formatted.length > 0
      ? price.initial_formatted
      : typeof price.initial === 'number' && price.initial > 0
        ? `${(price.initial / 100).toFixed(2).replace('.', ',')} ${price.currency ?? ''}`.trim()
        : null;

  return {
    platform: 'steam',
    gameId: appId,
    name: app.name,
    image:
      app.header_image ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    url: `https://store.steampowered.com/app/${appId}`,
    originalPrice,
  };
}

/**
 * Nom et visuel officiels d'une app, quelle que soit la forme de la réponse.
 * Sert à habiller une offre dont le prix vient de la page de résultats :
 * `appdetails` reste la meilleure source pour le titre et l'image, même quand
 * il ne dit rien d'utile du prix.
 */
export function parseSteamAppInfo(
  appId: string,
  data: unknown,
): { name: string | null; image: string | null } | null {
  const entry = (
    data as Record<string, { success?: boolean; data?: SteamAppDetails } | undefined> | null
  )?.[appId];
  const app = entry?.success === true ? entry.data : undefined;
  if (!app) return null;
  return {
    name: typeof app.name === 'string' && app.name.length > 0 ? app.name : null,
    image:
      typeof app.header_image === 'string' && app.header_image.length > 0 ? app.header_image : null,
  };
}

/**
 * Pourquoi `appdetails` n'a pas confirmé une offre, en clair. Le hublot du
 * dashboard ne garde que le texte du message : sans ces chiffres, un rejet est
 * indiscernable d'une absence d'offre.
 */
export function steamRejectionReason(appId: string, data: unknown): string {
  const entry = (
    data as Record<string, { success?: boolean; data?: SteamAppDetails } | undefined> | null
  )?.[appId];
  if (!entry) return 'app absente de la réponse';
  if (entry.success !== true) return 'success=false';
  const app = entry.data;
  if (!app) return 'data vide';
  if (!app.name) return 'nom absent';
  if (app.is_free === true) return `is_free=true (${app.name})`;
  const price = app.price_overview;
  if (!price) return `price_overview absent (${app.name})`;
  return `${app.name} : remise=${String(price.discount_percent ?? '?')}%, final=${String(price.final ?? '?')}`;
}

/** Recherche du store : liste les appids soldés à 100 %, puis vérifie chacun. */
async function fetchSteamSearchFreeGames(): Promise<FreeGame[]> {
  const data = await fetchJson(STEAM_SEARCH_URL, 'steam:search');
  if (!data) return [];

  const rows = parseSteamSearchRows(data);
  if (rows.length === 0) {
    // Une réponse 200 dont on ne tire rien est ambiguë : soit Steam n'a
    // effectivement aucune offre, soit sa réponse a changé de forme. Le
    // `total_count` tranche, et la liste des clés dit sur quoi se rebrancher.
    const record = typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const total = record.total_count;
    log.warn(
      { source: 'steam:search', total, keys: Object.keys(record) },
      `Jeux gratuits : steam:search sans appid (total_count=${String(total ?? '?')}, champs: ${Object.keys(record).join(', ') || 'aucun'})`,
    );
    return [];
  }

  const games = await Promise.all(
    rows.map(async (row) => {
      const url = `${STEAM_APPDETAILS_URL}?appids=${row.appId}&cc=fr&l=french`;
      const details = await fetchJson(url, `steam:appdetails:${row.appId}`);
      const confirmed = details ? parseSteamAppDetails(row.appId, details) : null;
      if (confirmed) return confirmed;

      // Cas courant, et non une anomalie : Steam bascule `is_free` à true et
      // retire le `price_overview` d'un jeu mis à -100 %. Le prix vient alors de
      // la page de résultats, le titre et le visuel restent ceux d'`appdetails`.
      const fallback = steamRowToFreeGame(row);
      const reason = details ? steamRejectionReason(row.appId, details) : 'réponse illisible';
      if (!fallback) {
        log.warn(
          { source: 'steam:appdetails', appId: row.appId },
          `Jeux gratuits : appdetails ${row.appId} non confirmé — ${reason} ; aucun repli possible`,
        );
        return null;
      }
      const info = details ? parseSteamAppInfo(row.appId, details) : null;
      if (info?.name) fallback.name = info.name;
      if (info?.image) fallback.image = info.image;
      log.info(
        { source: 'steam:appdetails', appId: row.appId },
        `Jeux gratuits : ${fallback.name} — prix lu sur la recherche (${reason})`,
      );
      return fallback;
    }),
  );
  const kept = games.filter((game): game is FreeGame => game !== null);
  log.info(
    { source: 'steam:search', found: rows.length, kept: kept.length },
    `Jeux gratuits : steam:search → ${rows.length} résultat(s), ${kept.length} retenu(s)`,
  );
  return kept;
}

async function fetchSteamFeaturedFreeGames(): Promise<FreeGame[]> {
  const data = await fetchJson(STEAM_FEATURED_URL, 'steam:featured');
  return data ? parseSteamFreeGames(data) : [];
}

async function fetchSteamFreeGames(): Promise<FreeGame[]> {
  const [fromSearch, fromFeatured] = await Promise.all([
    fetchSteamSearchFreeGames().catch(() => [] as FreeGame[]),
    fetchSteamFeaturedFreeGames().catch(() => [] as FreeGame[]),
  ]);
  return dedupe([...fromSearch, ...fromFeatured]);
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
  const data = await fetchJson(EPIC_PROMOTIONS_URL, 'epic:promotions');
  return data ? parseEpicFreeGames(data) : [];
}

// --- GOG --------------------------------------------------------------------

interface GogCatalogProduct {
  id?: string | number;
  slug?: string;
  title?: string;
  coverHorizontal?: string;
  coverVertical?: string;
  storeLink?: string;
  price?: {
    base?: string;
    final?: string;
    baseMoney?: { amount?: string; currency?: string };
  };
}

/** Lit un montant GOG (« 9.99 ») ; `null` si absent ou illisible. */
function gogAmount(value: string | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extrait les jeux offerts du catalogue GOG filtré sur « soldé à 0 ». On exige un
 * prix d'origine non nul : sinon les jeux gratuits en permanence (Gwent, démos)
 * seraient annoncés comme des offres à saisir.
 */
export function parseGogCatalog(data: unknown): FreeGame[] {
  const products = (data as { products?: unknown[] } | null)?.products;
  const list = Array.isArray(products) ? products : [];
  const games: FreeGame[] = [];
  for (const raw of list) {
    const product = raw as GogCatalogProduct;
    const base = gogAmount(product.price?.base ?? product.price?.baseMoney?.amount);
    const final = gogAmount(product.price?.final);
    if (!product.title || final !== 0 || base === null || base <= 0) continue;
    const slug = product.slug;
    const url =
      product.storeLink ?? (slug ? `https://www.gog.com/game/${slug}` : 'https://www.gog.com/');
    const currency = product.price?.baseMoney?.currency ?? 'EUR';
    games.push({
      platform: 'gog',
      gameId: String(product.id ?? slug ?? product.title),
      name: product.title,
      image: product.coverHorizontal ?? product.coverVertical ?? '',
      url,
      originalPrice: `${base.toFixed(2).replace('.', ',')} ${currency}`.trim(),
    });
  }
  return games;
}

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
  const [catalog, giveaway] = await Promise.all([
    fetchJson(GOG_CATALOG_URL, 'gog:catalog'),
    fetchJson(GOG_GIVEAWAY_URL, 'gog:giveaway'),
  ]);
  return dedupe([
    ...(catalog ? parseGogCatalog(catalog) : []),
    ...(giveaway ? parseGogGiveaway(giveaway) : []),
  ]);
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
    platforms.map((platform) =>
      FETCHERS[platform]().catch((error: unknown) => {
        log.warn({ err: error, platform }, `Jeux gratuits : relevé ${platform} échoué`);
        return [] as FreeGame[];
      }),
    ),
  );
  const games = dedupe(results.flat());
  log.info(
    { platforms, count: games.length },
    `Jeux gratuits : ${games.length} offre(s) relevée(s) sur ${platforms.join(', ')}`,
  );
  return games;
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
