import { EmbedBuilder } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { env } from '../../core/env.js';
import { t } from '../../core/i18n.js';
import { fetchWithTimeout } from '../../lib/http.js';
import {
  MODULE_NAME,
  type StreamPlatform,
  type StreamSubscription,
  getStreamalertsConfig,
} from './config.js';

const TWITCH_COLOR = 0x9146ff;
const YOUTUBE_COLOR = 0xff0000;
const REDDIT_COLOR = 0xff4500;
const DEALABS_COLOR = 0xf29400;
const RSS_COLOR = 0xee802f;

const PLATFORM_COLOR: Record<StreamPlatform, number> = {
  twitch: TWITCH_COLOR,
  youtube: YOUTUBE_COLOR,
  reddit: REDDIT_COLOR,
  dealabs: DEALABS_COLOR,
  rss: RSS_COLOR,
};

// User-Agent « navigateur » descriptif : Reddit refuse les requêtes sans agent
// (429/403) et Dealabs/Cloudflare bloque volontiers les agents non-navigateur.
const FEED_USER_AGENT =
  'Mozilla/5.0 (compatible; VakzBot/1.0; +https://github.com/VakzOs/Vakz-Bot)';

// --- Contournement Cloudflare via FlareSolverr (optionnel) ------------------

/** FlareSolverr est-il configuré (résolveur Cloudflare pour Dealabs) ? */
function flaresolverrConfigured(): boolean {
  return Boolean(env.FLARESOLVERR_URL);
}

interface CloudflareSession {
  cookieHeader: string;
  userAgent: string;
  expiresAt: number;
}
let cfSession: CloudflareSession | null = null;

/**
 * Demande à FlareSolverr de résoudre le challenge Cloudflare pour `sampleUrl`,
 * puis mémorise les cookies (cf_clearance…) + le User-Agent renvoyés. Ces cookies
 * sont liés à l'IP et au User-Agent : FlareSolverr tournant sur le même hôte que
 * le bot (même IP de sortie), un fetch direct réutilisant ces valeurs passe
 * ensuite Cloudflare — y compris pour récupérer du XML brut (le flux RSS).
 */
async function getCloudflareSession(sampleUrl: string): Promise<CloudflareSession | null> {
  const base = env.FLARESOLVERR_URL;
  if (!base) return null;
  if (cfSession && cfSession.expiresAt > Date.now()) return cfSession;
  try {
    const res = await fetchWithTimeout(
      `${base.replace(/\/+$/, '')}/v1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: 'request.get', url: sampleUrl, maxTimeout: 60_000 }),
      },
      // FlareSolverr peut légitimement mettre jusqu'à ~60 s (son propre maxTimeout).
      65_000,
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      solution?: { cookies?: Array<{ name: string; value: string }>; userAgent?: string };
    } | null;
    const cookies = data?.solution?.cookies;
    if (!cookies?.length) return null;
    cfSession = {
      cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      userAgent: data?.solution?.userAgent ?? FEED_USER_AGENT,
      expiresAt: Date.now() + 20 * 60_000,
    };
    return cfSession;
  } catch {
    return null;
  }
}

/**
 * Récupère le texte d'une URL. Si `viaCloudflare` et FlareSolverr est configuré,
 * passe par une session Cloudflare (cookies + UA) ; sinon fetch direct.
 */
async function fetchText(url: string, viaCloudflare = false): Promise<string | null> {
  const accept = 'application/rss+xml, application/atom+xml, application/xml, text/html, */*';
  if (viaCloudflare && env.FLARESOLVERR_URL) {
    const session = await getCloudflareSession(url);
    if (session) {
      const res = await fetchWithTimeout(url, {
        headers: { 'user-agent': session.userAgent, cookie: session.cookieHeader, accept },
      }).catch(() => null);
      if (res?.ok) return res.text().catch(() => null);
      // Échec malgré la session : probablement expirée, on l'invalide.
      cfSession = null;
    }
    return null;
  }
  const res = await fetchWithTimeout(url, {
    headers: { 'user-agent': FEED_USER_AGENT, accept },
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.text().catch(() => null);
}

/** État d'un flux au moment du contrôle. */
interface StreamStatus {
  live: boolean;
  name: string;
  title?: string;
  url: string;
  game?: string;
  image?: string;
  videoId?: string;
  /** Logo de la chaîne (icône d'auteur de l'embed). */
  authorIcon?: string;
  /** Dealabs : « température » du deal (ex. « 113° »), extraite du titre RSS. */
  temperature?: string;
  /** Dealabs : prix du deal, issu du flux (`<pepper:merchant>`). */
  price?: string;
  /** Dealabs : marchand, issu du flux (`<pepper:merchant>`). */
  merchant?: string;
}

// --- Twitch -----------------------------------------------------------------

let twitchToken: { value: string; expiresAt: number } | null = null;

function twitchConfigured(): boolean {
  return Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
}

async function getTwitchToken(): Promise<string | null> {
  if (!twitchConfigured()) return null;
  if (twitchToken && twitchToken.expiresAt > Date.now()) return twitchToken.value;

  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID as string,
    client_secret: env.TWITCH_CLIENT_SECRET as string,
    grant_type: 'client_credentials',
  });
  const res = await fetchWithTimeout(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
    method: 'POST',
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!data?.access_token) return null;
  twitchToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
  };
  return twitchToken.value;
}

/** Cache login Twitch → logo (image de profil), qui change rarement. */
const twitchIconCache = new Map<string, string>();

async function getTwitchIcon(login: string, token: string): Promise<string | undefined> {
  const cached = twitchIconCache.get(login);
  if (cached) return cached;
  const res = await fetchWithTimeout(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    {
      headers: { 'Client-Id': env.TWITCH_CLIENT_ID as string, Authorization: `Bearer ${token}` },
    },
  ).catch(() => null);
  if (!res?.ok) return undefined;
  const data = (await res.json().catch(() => null)) as {
    data?: Array<{ profile_image_url?: string }>;
  } | null;
  const icon = data?.data?.[0]?.profile_image_url;
  if (icon) twitchIconCache.set(login, icon);
  return icon;
}

async function checkTwitch(login: string): Promise<StreamStatus | null> {
  const token = await getTwitchToken();
  if (!token) return null;
  const res = await fetchWithTimeout(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`,
    { headers: { 'Client-Id': env.TWITCH_CLIENT_ID as string, Authorization: `Bearer ${token}` } },
  ).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    data?: Array<{ user_name: string; title: string; game_name: string; thumbnail_url: string }>;
  } | null;
  const stream = data?.data?.[0];
  const url = `https://twitch.tv/${login}`;
  if (!stream) return { live: false, name: login, url };
  return {
    live: true,
    name: stream.user_name || login,
    title: stream.title,
    game: stream.game_name,
    image: stream.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720'),
    url,
    authorIcon: await getTwitchIcon(login, token),
  };
}

// --- YouTube (flux RSS, sans clé API) ---------------------------------------

function firstMatch(source: string, re: RegExp): string | undefined {
  return re.exec(source)?.[1];
}

/** Cache handle/nom → identifiant de chaîne (UC…), et id → logo de chaîne. */
const ytIdCache = new Map<string, string>();
const ytAvatarCache = new Map<string, string>();

/**
 * Résout un identifiant YouTube en identifiant de chaîne `UC…`. Accepte déjà un
 * `UC…`, un `@handle` ou un nom : dans ces derniers cas, on lit la page publique
 * de la chaîne et on en extrait l'identifiant canonique (et le logo), sans clé API.
 */
async function resolveYouTubeChannelId(input: string): Promise<string | null> {
  const value = input.trim();
  if (/^UC[\w-]{10,}$/.test(value)) return value;
  const cached = ytIdCache.get(value);
  if (cached) return cached;

  const handle = value.replace(/^@/, '');
  const candidates = [
    `https://www.youtube.com/@${handle}`,
    `https://www.youtube.com/c/${handle}`,
    `https://www.youtube.com/user/${handle}`,
  ];
  for (const url of candidates) {
    const res = await fetchWithTimeout(url, { headers: { 'accept-language': 'en' } }).catch(
      () => null,
    );
    if (!res?.ok) continue;
    const html = await res.text().catch(() => '');
    const id =
      firstMatch(html, /"(?:channelId|externalId)":"(UC[\w-]+)"/) ??
      firstMatch(html, /channel\/(UC[\w-]+)/);
    if (!id) continue;
    ytIdCache.set(value, id);
    const avatar =
      firstMatch(html, /"avatar":\{"thumbnails":\[\{"url":"([^"=]+)/) ??
      firstMatch(html, /<meta property="og:image" content="([^"]+)"/);
    if (avatar) ytAvatarCache.set(id, avatar.replace(/\\\//g, '/'));
    return id;
  }
  return null;
}

interface YouTubeVideo {
  videoId: string;
  title?: string;
  name: string;
}

/** YouTube via l'API Data v3 (plus fraîche que le RSS), si une clé est fournie. */
async function checkYouTubeApi(channelId: string): Promise<YouTubeVideo | null> {
  if (!env.YOUTUBE_API_KEY) return null;
  const playlistId = `UU${channelId.slice(2)}`;
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${playlistId}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetchWithTimeout(url).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    items?: Array<{
      snippet?: {
        title?: string;
        channelTitle?: string;
        videoOwnerChannelTitle?: string;
        resourceId?: { videoId?: string };
      };
    }>;
  } | null;
  const snippet = data?.items?.[0]?.snippet;
  const videoId = snippet?.resourceId?.videoId;
  if (!videoId) return null;
  return {
    videoId,
    title: snippet?.title,
    name: snippet?.videoOwnerChannelTitle ?? snippet?.channelTitle ?? channelId,
  };
}

/** YouTube via le flux RSS (sans clé API). */
async function checkYouTubeRss(channelId: string): Promise<YouTubeVideo | null> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
  ).catch(() => null);
  if (!res?.ok) return null;
  const xml = await res.text().catch(() => '');
  const entry = firstMatch(xml, /<entry>([\s\S]*?)<\/entry>/);
  if (!entry) return null;
  const videoId = firstMatch(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/);
  if (!videoId) return null;
  return {
    videoId,
    title: firstMatch(entry, /<title>([^<]*)<\/title>/),
    name: firstMatch(entry, /<name>([^<]*)<\/name>/) ?? channelId,
  };
}

async function checkYouTube(identifier: string): Promise<StreamStatus | null> {
  const channelId = await resolveYouTubeChannelId(identifier);
  if (!channelId) return null;
  const video = (await checkYouTubeApi(channelId)) ?? (await checkYouTubeRss(channelId));
  if (!video) return null;
  return {
    live: false,
    name: video.name,
    title: video.title,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    image: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    videoId: video.videoId,
    authorIcon: ytAvatarCache.get(channelId),
  };
}

// --- Flux génériques : Reddit, RSS, Dealabs ---------------------------------

/** Décode les entités XML/HTML les plus courantes d'un titre de flux. */
function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x?[0-9a-f]+;/gi, (m) => {
      const hex = /^&#x/i.test(m);
      const code = Number.parseInt(m.replace(/&#x?|;/gi, ''), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/&amp;/g, '&')
    .trim();
}

interface FeedItem {
  /** Identifiant stable de l'élément (guid/id/lien) pour la déduplication. */
  itemId: string;
  title?: string;
  link: string;
  image?: string;
  /** Dealabs : prix du deal (attribut `price` de `<pepper:merchant>`). */
  price?: string;
  /** Dealabs : marchand (attribut `name` de `<pepper:merchant>`). */
  merchant?: string;
}

interface FeedResult {
  feedTitle?: string;
  items: FeedItem[];
}

function parseFeedBlock(block: string): FeedItem | null {
  const link =
    firstMatch(block, /<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i) ??
    firstMatch(block, /<link[^>]*\bhref=["']([^"']+)["']/i) ??
    firstMatch(block, /<link>\s*([^<]+?)\s*<\/link>/i);
  const guid =
    firstMatch(block, /<guid[^>]*>\s*([^<]+?)\s*<\/guid>/i) ??
    firstMatch(block, /<id>\s*([^<]+?)\s*<\/id>/i) ??
    link;
  if (!guid) return null;
  const rawTitle = firstMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const image =
    firstMatch(block, /<media:thumbnail[^>]*\burl=["']([^"']+)["']/i) ??
    firstMatch(block, /<media:content[^>]*\burl=["']([^"']+)["']/i) ??
    firstMatch(block, /<enclosure[^>]*\burl=["']([^"']+)["']/i);
  // Dealabs expose un champ structuré : <pepper:merchant name="…" price="…"/>.
  const merchant = firstMatch(block, /<pepper:merchant[^>]*\bname=["']([^"']*)["']/i);
  const price = firstMatch(block, /<pepper:merchant[^>]*\bprice=["']([^"']*)["']/i);
  return {
    itemId: decodeEntities(guid),
    title: rawTitle ? decodeEntities(rawTitle) : undefined,
    link: link ? decodeEntities(link) : decodeEntities(guid),
    ...(image ? { image: decodeEntities(image) } : {}),
    ...(price ? { price: decodeEntities(price) } : {}),
    ...(merchant ? { merchant: decodeEntities(merchant) } : {}),
  };
}

/** Lit un flux RSS 2.0 ou Atom et renvoie ses éléments (les plus récents d'abord). */
async function fetchFeed(url: string, viaCloudflare = false): Promise<FeedResult | null> {
  const xml = await fetchText(url, viaCloudflare);
  if (!xml) return null;

  const items: FeedItem[] = [];
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null && items.length < 15) {
    const item = parseFeedBlock(match[0]);
    if (item) items.push(item);
  }
  // Titre du flux : on ignore le premier <title> d'un <item>/<entry> déjà capturé.
  const header = xml.slice(0, xml.search(blockRe) === -1 ? xml.length : xml.search(blockRe));
  const feedTitle = firstMatch(header, /<title[^>]*>([\s\S]*?)<\/title>/i);
  return { feedTitle: feedTitle ? decodeEntities(feedTitle) : undefined, items };
}

/** Construit l'URL du flux pour une plateforme de type flux (hors YouTube). */
function feedUrlFor(platform: StreamPlatform, identifier: string): string | null {
  const value = identifier.trim();
  if (platform === 'reddit') {
    const sub = value.replace(/^\/?r\//i, '').replace(/^@/, '');
    return sub ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss` : null;
  }
  if (platform === 'dealabs') {
    // Toujours le flux « hot » ; l'identifiant sert de filtre par mot-clé (optionnel).
    return 'https://www.dealabs.com/rss/hot';
  }
  // rss : l'identifiant est directement l'URL du flux.
  return /^https?:\/\//i.test(value) ? value : null;
}

function feedDisplayName(platform: StreamPlatform, identifier: string, feed: FeedResult): string {
  if (platform === 'reddit') return `r/${identifier.replace(/^\/?r\//i, '')}`;
  if (platform === 'dealabs') return 'Dealabs';
  return feed.feedTitle || identifier;
}

/**
 * Contrôle une source de type flux (Reddit, RSS, Dealabs) et renvoie le dernier
 * élément publié. Pour Dealabs, un identifiant non vide filtre par mot-clé.
 */
async function checkFeed(
  platform: StreamPlatform,
  identifier: string,
  opts: { ignoreKeyword?: boolean } = {},
): Promise<StreamStatus | null> {
  const url = feedUrlFor(platform, identifier);
  if (!url) return null;
  const feed = await fetchFeed(url, platform === 'dealabs');
  if (!feed || feed.items.length === 0) return null;

  let items = feed.items;
  // Filtre par mot-clé Dealabs — ignoré en mode test pour toujours montrer le
  // dernier deal hot, même si le mot-clé ne correspond à rien pour l'instant.
  if (platform === 'dealabs' && identifier.trim() && !opts.ignoreKeyword) {
    const keyword = identifier.trim().toLowerCase();
    items = items.filter((item) => (item.title ?? '').toLowerCase().includes(keyword));
    if (items.length === 0) return null;
  }
  const latest = items[0]!;
  // Dealabs : la température préfixe le titre (« 113° - … ») → on la sépare.
  const dealabs = platform === 'dealabs' ? parseDealabsTitle(latest.title) : {};
  return {
    live: false,
    name: feedDisplayName(platform, identifier, feed),
    title: dealabs.title ?? latest.title,
    url: latest.link,
    videoId: latest.itemId,
    ...(latest.image ? { image: latest.image } : {}),
    ...(dealabs.temperature ? { temperature: dealabs.temperature } : {}),
    ...(latest.price ? { price: latest.price } : {}),
    ...(latest.merchant ? { merchant: latest.merchant } : {}),
  };
}

// --- Annonce ----------------------------------------------------------------

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

/** Variables spécifiques à un deal Dealabs (prix, température, marchand). */
interface DealExtras {
  price?: string;
  temperature?: string;
  merchant?: string;
}

/**
 * Sépare la « température » du titre d'un deal Dealabs : les titres du flux « hot »
 * sont préfixés par le score, ex. « 113° - Le Seigneur des Anneaux… ». Renvoie la
 * température (« 113° ») et le titre nettoyé.
 */
function parseDealabsTitle(raw: string | undefined): { temperature?: string; title?: string } {
  const title = raw?.trim();
  if (!title) return {};
  const m = /^(-?\d{1,5})\s*°\s*[-–—:·|]*\s*/.exec(title);
  if (!m) return { title };
  const rest = title.slice(m[0].length).trim();
  return { temperature: `${m[1]}°`, title: rest || title };
}

/** Nettoie un prix scrappé (espaces/entités) : « 18,95€ ». */
function cleanPrice(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

/** Détails scrappés sur la page d'un deal (best-effort, complète le flux). */
interface DealPageDetails {
  newPrice?: string;
  oldPrice?: string;
  temperature?: string;
}

/**
 * Scrape la page d'un deal Dealabs (via FlareSolverr) pour compléter le flux :
 * l'ancien prix barré (absent du flux) et, en secours, le prix courant et la
 * température live. Best-effort : renvoie un objet vide si la page est
 * indisponible ou si sa structure change — le flux fournit déjà l'essentiel.
 */
async function fetchDealPageDetails(url: string): Promise<DealPageDetails> {
  const html = await fetchText(url, true);
  if (!html) return {};
  const newPrice = firstMatch(html, /thread-price[^"]*"[^>]*>\s*([^<]+?)\s*</i);
  const oldPrice = firstMatch(html, /text--lineThrough[^"]*"[^>]*>\s*([^<]+?)\s*</i);
  const temp =
    firstMatch(html, /cept-vote-temp[\s\S]{0,160}?>\s*(-?\d[\d\s]*)\s*°/i) ??
    firstMatch(html, /évalué à\s*(-?\d[\d\s]*)\s*°/i);
  return {
    ...(newPrice ? { newPrice: cleanPrice(newPrice) } : {}),
    ...(oldPrice ? { oldPrice: cleanPrice(oldPrice) } : {}),
    ...(temp ? { temperature: `${temp.replace(/\s+/g, '')}°` } : {}),
  };
}

/** Assemble le prix affiché : « ~~ancien~~ nouveau » si l'ancien est connu. */
function formatDealPrice(newPrice?: string, oldPrice?: string): string | undefined {
  if (!newPrice) return oldPrice;
  if (oldPrice && oldPrice !== newPrice) return `~~${oldPrice}~~ ${newPrice}`;
  return newPrice;
}

function buildEmbed(
  platform: StreamPlatform,
  status: StreamStatus,
  extras: DealExtras = {},
): EmbedBuilder {
  const headline = t(`modules.streamalerts.embed.${platform}Title`, { name: status.name });
  const embed = new EmbedBuilder()
    .setColor(PLATFORM_COLOR[platform])
    .setAuthor({
      name: headline,
      url: status.url,
      ...(status.authorIcon ? { iconURL: status.authorIcon } : {}),
    })
    .setTitle(status.title ?? headline)
    .setURL(status.url)
    .setFooter({ text: t(`modules.streamalerts.platform.${platform}`) })
    .setTimestamp();
  if (status.game) {
    embed.addFields({
      name: t('modules.streamalerts.embed.game'),
      value: status.game,
      inline: true,
    });
  }
  if (extras.price) {
    embed.addFields({
      name: t('modules.streamalerts.embed.price'),
      value: extras.price,
      inline: true,
    });
  }
  if (extras.temperature) {
    embed.addFields({
      name: t('modules.streamalerts.embed.temperature'),
      value: extras.temperature,
      inline: true,
    });
  }
  if (extras.merchant) {
    embed.addFields({
      name: t('modules.streamalerts.embed.merchant'),
      value: extras.merchant,
      inline: true,
    });
  }
  if (status.image) embed.setImage(status.image);
  return embed;
}

async function announce(
  ctx: BotContext,
  sub: StreamSubscription,
  status: StreamStatus,
): Promise<void> {
  const channel = await ctx.client.channels.fetch(sub.channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;

  // Dealabs : le flux fournit prix (nouveau) + marchand + température (titre) ;
  // la page complète avec l'ancien prix barré (best-effort via FlareSolverr).
  const extras: DealExtras = {};
  if (sub.platform === 'dealabs') {
    const details = await fetchDealPageDetails(status.url);
    const price = formatDealPrice(status.price ?? details.newPrice, details.oldPrice);
    if (price) extras.price = price;
    const temperature = status.temperature ?? details.temperature;
    if (temperature) extras.temperature = temperature;
    if (status.merchant) extras.merchant = status.merchant;
  }

  // Par défaut : embed seul. Le texte hors-embed n'existe que si un rôle est à
  // mentionner et/ou si un message personnalisé a été défini.
  const parts: string[] = [];
  if (sub.roleId) parts.push(`<@&${sub.roleId}>`);
  if (sub.message) {
    parts.push(
      fillTemplate(sub.message, {
        name: status.name,
        title: status.title ?? '',
        url: status.url,
        game: status.game ?? '',
        prix: extras.price ?? '',
        price: extras.price ?? '',
        temperature: extras.temperature ?? '',
        marchand: extras.merchant ?? '',
        merchant: extras.merchant ?? '',
      }),
    );
  }
  const content = parts.join(' ').trim();

  await channel
    .send({
      ...(content ? { content: content.slice(0, 2000) } : {}),
      embeds: [buildEmbed(sub.platform, status, extras)],
      allowedMentions: { roles: sub.roleId ? [sub.roleId] : [] },
    })
    .catch(() => undefined);
}

// --- Boucle de contrôle -----------------------------------------------------

interface Target {
  guildId: string;
  sub: StreamSubscription;
}

/**
 * Met à jour l'état d'un abonnement et, si `announceEnabled`, annonce les
 * nouveautés. En mode « amorçage » (announceEnabled = false), on enregistre
 * l'état courant sans rien annoncer — utilisé au démarrage pour ne jamais
 * re-notifier une vidéo/un live déjà existant après un redémarrage.
 */
async function processTarget(
  ctx: BotContext,
  target: Target,
  status: StreamStatus,
  announceEnabled: boolean,
): Promise<void> {
  const { guildId, sub } = target;
  const where = {
    guildId_platform_identifier: { guildId, platform: sub.platform, identifier: sub.identifier },
  };
  const existing = await ctx.db.streamAlert.findUnique({ where }).catch(() => null);

  if (sub.platform === 'twitch') {
    const wasLive = existing?.live ?? false;
    if (announceEnabled && status.live && !wasLive) await announce(ctx, sub, status);
    await ctx.db.streamAlert
      .upsert({
        where,
        create: { guildId, platform: sub.platform, identifier: sub.identifier, live: status.live },
        update: { live: status.live },
      })
      .catch(() => undefined);
    return;
  }

  // YouTube : on annonce quand une nouvelle vidéo apparaît (jamais au premier
  // contrôle ni lors de l'amorçage au démarrage).
  if (!status.videoId) return;
  const last = existing?.lastVideoId ?? null;
  if (status.videoId === last) return;
  if (announceEnabled && last !== null) await announce(ctx, sub, status);
  await ctx.db.streamAlert
    .upsert({
      where,
      create: {
        guildId,
        platform: sub.platform,
        identifier: sub.identifier,
        lastVideoId: status.videoId,
      },
      update: { lastVideoId: status.videoId },
    })
    .catch(() => undefined);
}

/** Contrôle une source selon sa plateforme et renvoie son état courant. */
async function checkStatus(
  platform: StreamPlatform,
  identifier: string,
  opts: { ignoreKeyword?: boolean } = {},
): Promise<StreamStatus | null> {
  if (platform === 'twitch') return twitchConfigured() ? checkTwitch(identifier) : null;
  if (platform === 'youtube') return checkYouTube(identifier);
  return checkFeed(platform, identifier, opts);
}

/** Résultat d'un envoi de test déclenché depuis le panneau de configuration. */
export type TestOutcome = 'ok' | 'nochannel' | 'notfound' | 'unreachable';

/**
 * Envoi de test : poste immédiatement le dernier élément de la source dans le
 * salon configuré, sans toucher à l'état de déduplication (le prochain contrôle
 * périodique se comporte comme si de rien n'était).
 */
export async function testSubscription(
  ctx: BotContext,
  sub: StreamSubscription,
): Promise<TestOutcome> {
  if (!sub.channelId) return 'nochannel';
  // Test : on ignore le filtre par mot-clé pour toujours poster le dernier élément.
  const status = await checkStatus(sub.platform, sub.identifier, { ignoreKeyword: true });
  if (!status) {
    // Diagnostic plus précis pour les flux : distingue « injoignable » (blocage
    // réseau / URL invalide) de « vide » (flux joignable mais sans élément).
    if (sub.platform === 'reddit' || sub.platform === 'rss' || sub.platform === 'dealabs') {
      const url = feedUrlFor(sub.platform, sub.identifier);
      if (url && !(await fetchFeed(url, sub.platform === 'dealabs'))) return 'unreachable';
    }
    return 'notfound';
  }
  await announce(ctx, sub, status);
  return 'ok';
}

/** Parcourt tous les abonnements ; `announceEnabled` distingue poll vs amorçage. */
async function run(ctx: BotContext, announceEnabled: boolean): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);

  const unique = new Map<
    string,
    { platform: StreamPlatform; identifier: string; targets: Target[] }
  >();
  for (const row of rows) {
    const config = await getStreamalertsConfig(ctx, row.guildId);
    for (const sub of config.subscriptions) {
      if (!sub.channelId) continue;
      const norm =
        sub.platform === 'twitch' || sub.platform === 'reddit'
          ? sub.identifier.toLowerCase()
          : sub.identifier;
      const key = `${sub.platform}:${norm}`;
      const entry = unique.get(key) ?? {
        platform: sub.platform,
        identifier: sub.identifier,
        targets: [],
      };
      entry.targets.push({ guildId: row.guildId, sub });
      unique.set(key, entry);
    }
  }

  for (const entry of unique.values()) {
    if (entry.platform === 'twitch' && !twitchConfigured()) continue;
    const status = await checkStatus(entry.platform, entry.identifier);
    if (!status) continue;
    for (const target of entry.targets) {
      await processTarget(ctx, target, status, announceEnabled);
    }
  }
}

/** Contrôle périodique : annonce les nouveautés (live / nouvelle vidéo). */
export async function pollAll(ctx: BotContext): Promise<void> {
  await run(ctx, true);
}

/**
 * Amorçage au démarrage : enregistre l'état courant de chaque flux SANS rien
 * annoncer. Garantit qu'un redémarrage ne re-notifie jamais une vidéo ou un live
 * déjà existant — seules les nouveautés survenues bot allumé sont annoncées.
 */
export async function primeAll(ctx: BotContext): Promise<void> {
  await run(ctx, false);
}

export { flaresolverrConfigured, twitchConfigured };
