import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, type PatchSubscription, getPatchnotesConfig } from './config.js';
import { type PatchSource, getPatchSource, patchSourceLabel } from './catalog.js';

const USER_AGENT = 'Vakz-Bot PatchNotes/1.0 (+https://github.com/VakzOs/Vakz-Bot)';
const PATCH_DESCRIPTION_MAX_LENGTH = 420;
const PATCH_KEYWORDS = [
  'patch',
  'patch notes',
  'notes de patch',
  'update',
  'mise a jour',
  'mise à jour',
  'hotfix',
  'correctif',
  'changelog',
  'release notes',
  'balance',
  'equilibrage',
  'équilibrage',
];

export interface PatchNote {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  description: string;
  imageUrl?: string;
  publishedAt?: Date;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripMarkup(value: string): string {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\[url=[^\]]+\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsefulDescription(value: string): boolean {
  if (value.length < 60) return false;
  const lower = value.toLowerCase();
  const blocked = [
    'menu menu icon',
    'close close',
    'stroke-width',
    'opacity:',
    'fill:',
    'cookie',
    'javascript',
  ];
  return !blocked.some((token) => lower.includes(token));
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.6' },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.text().catch(() => null);
}

async function fetchJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.6' },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

function metaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyFirst = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i',
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i',
  );
  return (
    decodeHtml(propertyFirst.exec(html)?.[1] ?? contentFirst.exec(html)?.[1] ?? '').trim() ||
    undefined
  );
}

function firstTitle(html: string): string | undefined {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? stripMarkup(title) : undefined;
}
function firstHeading(html: string): string | undefined {
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return heading ? stripMarkup(heading) : undefined;
}

function firstParagraph(html: string): string | undefined {
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripMarkup(match[1] ?? ''))
    .filter(isUsefulDescription);
  return paragraphs[0];
}

function articleDescription(html: string, source: PatchSource): string {
  const metaDescription = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  const candidates =
    source.kind === 'html'
      ? [metaDescription, firstParagraph(html)]
      : [firstParagraph(html), metaDescription];
  return (
    candidates.find((value): value is string => Boolean(value && isUsefulDescription(value))) ??
    metaDescription ??
    t('modules.patchnotes.embed.noDescription')
  );
}

function cleanImageUrl(value: string | undefined): string | undefined {
  if (!value || value.startsWith('data:')) return undefined;
  return decodeHtml(value).replace(/&amp;/g, '&');
}

function imageDimensions(url: string): { width: number; height: number } | null {
  const match = /-(\d{3,5})x(\d{3,5})\.(?:jpg|jpeg|png|webp)/i.exec(url);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function extractRiotHighlightImage(html: string): string | undefined {
  const images = [...html.matchAll(/<img[^>]+>/gi)]
    .map((match) => /src=["']([^"']+)["']/i.exec(match[0])?.[1])
    .map(cleanImageUrl)
    .filter((url): url is string => Boolean(url));

  return images.find((url) => {
    const dimensions = imageDimensions(url);
    if (!dimensions) return false;
    return dimensions.width >= 1000 && dimensions.height >= 600;
  });
}

function absoluteUrl(url: string, base: string): string | null {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function extractLinks(html: string, source: PatchSource): string[] {
  const base = source.indexUrl ?? source.homeUrl;
  const marker = source.linkPattern ?? '/news/';
  const links = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html))) {
    const href = decodeHtml(match[1] ?? '');
    if (!href.includes(marker)) continue;
    const url = absoluteUrl(href, base);
    if (url) links.add(url);
  }
  const rawRegex = new RegExp(
    `https?:\\/\\/[^"'\\s<>]+${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"'\\s<>]+`,
    'gi',
  );
  while ((match = rawRegex.exec(html))) {
    links.add(decodeHtml(match[0]).replace(/\\u002F/g, '/'));
  }
  return [...links].slice(0, 8);
}

async function fetchArticleNote(source: PatchSource, url: string): Promise<PatchNote | null> {
  const html = await fetchText(url);
  if (!html) return null;
  const title = firstHeading(html) ?? metaContent(html, 'og:title') ?? firstTitle(html);
  if (!title) return null;
  const description = articleDescription(html, source);

  const published =
    metaContent(html, 'article:published_time') ??
    /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
  const imageUrl = extractRiotHighlightImage(html) ?? cleanImageUrl(metaContent(html, 'og:image'));
  const id = new URL(url).pathname.replace(/\/$/, '').split('/').pop() ?? url;
  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    title: truncate(title, 250),
    url,
    description: truncate(description, PATCH_DESCRIPTION_MAX_LENGTH),
    imageUrl,
    publishedAt: published ? new Date(published) : undefined,
  };
}

async function fetchRiotNotes(source: PatchSource): Promise<PatchNote[]> {
  if (!source.indexUrl) return [];
  const html = await fetchText(source.indexUrl);
  if (!html) return [];
  const links = extractLinks(html, source);
  const notes = await Promise.all(links.map((url) => fetchArticleNote(source, url)));
  return notes.filter((note): note is PatchNote => Boolean(note));
}

function matchesSourceKeywords(note: PatchNote, source: PatchSource): boolean {
  const keywords = source.matchKeywords ?? [];
  if (keywords.length === 0) return true;
  const haystack = `${note.title} ${note.description}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

async function fetchHtmlNotes(source: PatchSource): Promise<PatchNote[]> {
  if (!source.indexUrl) return [];
  const html = await fetchText(source.indexUrl);
  if (!html) return [];

  const links = extractLinks(html, source);
  if (links.length === 0) {
    const note = await fetchArticleNote(source, source.indexUrl);
    return note ? [note] : [];
  }

  const notes = (await Promise.all(links.map((url) => fetchArticleNote(source, url)))).filter(
    (note): note is PatchNote => Boolean(note),
  );
  const filtered = notes.filter((note) => matchesSourceKeywords(note, source));
  return (filtered.length ? filtered : notes).slice(0, 5);
}
interface SteamNewsItem {
  gid?: string;
  title?: string;
  url?: string;
  contents?: string;
  date?: number;
  feedlabel?: string;
}

function looksLikePatch(item: SteamNewsItem): boolean {
  const haystack = `${item.title ?? ''} ${item.contents ?? ''}`.toLowerCase();
  return PATCH_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function extractSteamImage(contents: string | undefined): string | undefined {
  if (!contents) return undefined;
  const decoded = decodeHtml(contents);
  const bbcode = /\[img\](https?:[^[]+)\[\/img\]/i.exec(decoded)?.[1];
  const html = /<img[^>]+src=["']([^"']+)["']/i.exec(decoded)?.[1];
  const plain = /(https?:\/\/[^\s"'<>[\]]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>[\]]*)?)/i.exec(
    decoded,
  )?.[1];
  return cleanImageUrl(bbcode ?? html ?? plain);
}

function steamHeaderImage(appId: number | undefined): string | undefined {
  return appId
    ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
    : undefined;
}

async function fetchSteamNotes(source: PatchSource): Promise<PatchNote[]> {
  if (!source.steamAppId) return [];
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${source.steamAppId}&count=10&maxlength=1400&format=json&l=french`;
  const data = await fetchJson(url);
  const items = (data as { appnews?: { newsitems?: SteamNewsItem[] } } | null)?.appnews?.newsitems;
  if (!Array.isArray(items)) return [];
  const patchItems = items.filter(looksLikePatch);
  const selected = (patchItems.length ? patchItems : items).slice(0, 5);
  return selected
    .filter((item) => item.gid && item.title && item.url)
    .map((item) => ({
      id: item.gid!,
      sourceId: source.id,
      sourceName: source.name,
      title: truncate(decodeHtml(item.title!), 250),
      url: item.url!,
      description: truncate(stripMarkup(item.contents ?? ''), PATCH_DESCRIPTION_MAX_LENGTH),
      imageUrl: extractSteamImage(item.contents) ?? steamHeaderImage(source.steamAppId),
      publishedAt: item.date ? new Date(item.date * 1000) : undefined,
    }));
}

function readTag(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return match ? stripMarkup(match[1] ?? '') : undefined;
}

async function fetchRssNotes(source: PatchSource): Promise<PatchNote[]> {
  if (!source.rssUrl) return [];
  const xml = await fetchText(source.rssUrl);
  if (!xml) return [];
  const blocks = [...xml.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)]
    .map((match) => match[0])
    .slice(0, 8);
  return blocks
    .map((block): PatchNote | null => {
      const title = readTag(block, 'title');
      const guid = readTag(block, 'guid') ?? readTag(block, 'id');
      const link =
        readTag(block, 'link') ??
        /<link[^>]+href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1] ??
        source.homeUrl;
      if (!title) return null;
      const description = readTag(block, 'description') ?? readTag(block, 'summary') ?? '';
      const date =
        readTag(block, 'pubDate') ?? readTag(block, 'updated') ?? readTag(block, 'published');
      return {
        id: guid || link,
        sourceId: source.id,
        sourceName: source.name,
        title: truncate(title, 250),
        url: link,
        description: truncate(
          description || t('modules.patchnotes.embed.noDescription'),
          PATCH_DESCRIPTION_MAX_LENGTH,
        ),
        publishedAt: date ? new Date(date) : undefined,
      } satisfies PatchNote;
    })
    .filter((note): note is PatchNote => Boolean(note));
}

export async function fetchPatchNotes(source: PatchSource): Promise<PatchNote[]> {
  switch (source.kind) {
    case 'riot':
      return fetchRiotNotes(source);
    case 'steam':
      return fetchSteamNotes(source);
    case 'rss':
      return fetchRssNotes(source);
    case 'html':
      return fetchHtmlNotes(source);
    default:
      return [];
  }
}

export function buildPatchNoteEmbed(note: PatchNote, source: PatchSource): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(source.color)
    .setTitle(note.title)
    .setURL(note.url)
    .setDescription(
      truncate(
        note.description || t('modules.patchnotes.embed.noDescription'),
        PATCH_DESCRIPTION_MAX_LENGTH,
      ),
    )
    .setFooter({ text: t('modules.patchnotes.embed.footer', { source: source.name }) });

  if (source.iconUrl) embed.setThumbnail(source.iconUrl);
  if (note.imageUrl) embed.setImage(note.imageUrl);
  if (note.publishedAt && !Number.isNaN(note.publishedAt.getTime())) {
    embed.setTimestamp(note.publishedAt);
  }
  return embed;
}

export interface PublishLatestPatchNotesResult {
  sent: number;
  fetched: number;
  reason?:
    | 'missingSource'
    | 'missingChannel'
    | 'channelUnavailable'
    | 'missingPermissions'
    | 'noNotes'
    | 'sendFailed';
}

export async function publishLatestPatchNotes(
  ctx: BotContext,
  sub: PatchSubscription,
  limit = 3,
): Promise<PublishLatestPatchNotesResult> {
  const source = getPatchSource(sub.sourceId);
  if (!source) return { sent: 0, fetched: 0, reason: 'missingSource' };
  if (!sub.channelId) return { sent: 0, fetched: 0, reason: 'missingChannel' };

  const notes = await fetchPatchNotes(source);
  if (notes.length === 0) return { sent: 0, fetched: 0, reason: 'noNotes' };

  const channel = await ctx.client.channels.fetch(sub.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    return { sent: 0, fetched: Math.min(notes.length, limit), reason: 'channelUnavailable' };
  }

  const clientUserId = ctx.client.user?.id;
  if (clientUserId && 'permissionsFor' in channel) {
    const permissions = channel.permissionsFor(clientUserId);
    if (
      !permissions?.has(PermissionFlagsBits.SendMessages) ||
      !permissions.has(PermissionFlagsBits.EmbedLinks)
    ) {
      return { sent: 0, fetched: Math.min(notes.length, limit), reason: 'missingPermissions' };
    }
  }

  let sent = 0;
  for (const note of notes.slice(0, limit).reverse()) {
    const ok = await channel
      .send({
        ...(sent === 0 && sub.roleId ? { content: `<@&${sub.roleId}>` } : {}),
        embeds: [buildPatchNoteEmbed(note, source)],
        allowedMentions: sub.roleId ? { roles: [sub.roleId] } : { parse: [] },
      })
      .then(() => true)
      .catch((error: unknown) => {
        ctx.logger.warn(
          { err: error, sourceId: sub.sourceId, channelId: sub.channelId },
          'Publication manuelle patchnote echouee',
        );
        return false;
      });
    if (ok) sent += 1;
  }

  return {
    sent,
    fetched: Math.min(notes.length, limit),
    reason: sent > 0 ? undefined : 'sendFailed',
  };
}
async function announceNote(
  ctx: BotContext,
  guildId: string,
  sub: PatchSubscription,
  note: PatchNote,
): Promise<void> {
  const source = getPatchSource(sub.sourceId);
  if (!source || !sub.channelId) return;
  const isNew = await ctx.db.patchNoteAnnouncement
    .create({ data: { guildId, sourceId: sub.sourceId, noteId: note.id } })
    .then(() => true)
    .catch(() => false);
  if (!isNew) return;

  const channel = await ctx.client.channels.fetch(sub.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) return;

  await channel
    .send({
      ...(sub.roleId ? { content: `<@&${sub.roleId}>` } : {}),
      embeds: [buildPatchNoteEmbed(note, source)],
      allowedMentions: sub.roleId ? { roles: [sub.roleId] } : { parse: [] },
    })
    .catch((error: unknown) =>
      ctx.logger.warn(
        { err: error, guildId, sourceId: sub.sourceId, channelId: sub.channelId },
        'Annonce patchnote echouee',
      ),
    );
}

export async function pollPatchNotes(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);
  if (rows.length === 0) return;

  const cache = new Map<string, PatchNote[]>();
  for (const row of rows) {
    const config = await getPatchnotesConfig(ctx, row.guildId);
    for (const sub of config.subscriptions) {
      if (!sub.channelId) continue;
      const source = getPatchSource(sub.sourceId);
      if (!source) continue;
      let notes = cache.get(source.id);
      if (!notes) {
        notes = await fetchPatchNotes(source).catch((error: unknown) => {
          ctx.logger.warn({ err: error, sourceId: source.id }, 'Recuperation patchnotes echouee');
          return [];
        });
        cache.set(source.id, notes);
      }
      for (const note of notes.slice(0, 1).reverse()) {
        await announceNote(ctx, row.guildId, sub, note);
      }
    }
  }
}

export function subscriptionLabel(sub: PatchSubscription): string {
  return `${patchSourceLabel(sub.sourceId)} -> <#${sub.channelId}>`;
}
