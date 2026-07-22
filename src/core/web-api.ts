import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { logger } from './logger.js';
import { t } from './i18n.js';
import { moduleVisual } from './config-panel.js';
import type { BotContext } from './module.js';
import type { ModuleRegistry } from './loader.js';
import { readResult, readStatus, requestDeploy } from '../modules/deploy/service.js';
import { deployBranches, deployEnabled, isOwner } from '../modules/deploy/service.js';
import { PermissionFlagsBits, type Guild } from 'discord.js';
import { publishRules } from '../modules/rules/service.js';
import type { RulesConfig } from '../modules/rules/config.js';
import { publishPanel as publishTicketsPanel } from '../modules/tickets/service.js';
import type { TicketsConfig } from '../modules/tickets/config.js';
import { publishVerification } from '../modules/verification/service.js';
import type { VerificationConfig } from '../modules/verification/config.js';
import { publishMenu } from '../modules/reactionroles/menu.js';
import type { ReactionRolesConfig } from '../modules/reactionroles/config.js';
import { publishStreamer } from '../modules/streamer/menu.js';
import type { StreamerConfig } from '../modules/streamer/config.js';

/** Résultat commun d'une publication de panneau. */
type PublishOutcome = { ok: boolean; messageId?: string; error?: string };

/**
 * Modules dont le panneau (embed + boutons) peut être publié / mis à jour
 * depuis le dashboard web. Chaque fonction publie dans le salon configuré et
 * renvoie l'`messageId` à persister.
 */
const PUBLISHERS: Record<string, (guild: Guild, config: unknown) => Promise<PublishOutcome>> = {
  rules: (g, c) => publishRules(g, c as RulesConfig),
  tickets: (g, c) => publishTicketsPanel(g, c as TicketsConfig),
  verification: (g, c) => publishVerification(g, c as VerificationConfig),
  reactionroles: (g, c) => publishMenu(g, c as ReactionRolesConfig),
  streamer: (g, c) => publishStreamer(g, c as StreamerConfig),
};

const log = logger.child({ scope: 'web-api' });

/**
 * Comparaison à temps constant du token d'API. On compare des empreintes
 * SHA-256 (longueur fixe) : aucune information — pas même la longueur du
 * token — ne fuit par le temps de réponse.
 */
function tokenMatches(provided: string): boolean {
  const expected = env.WEB_API_TOKEN;
  if (!expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Un identifiant Discord (snowflake) plausible — défense en profondeur. */
function isSnowflake(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{5,25}$/.test(value);
}

function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token.length > 0 && tokenMatches(token);
}

/**
 * Identifiant de l'utilisateur à l'origine de l'action (en-tête `x-actor-id`),
 * transmis par le dashboard. Le token seul prouve « le site parle » ; l'acteur
 * dit « QUI » agit — indispensable pour une autorisation par serveur/propriétaire
 * côté bot (défense en profondeur : on ne délègue pas toute l'autz à Vercel).
 */
function getActorId(req: IncomingMessage): string | undefined {
  const raw = req.headers['x-actor-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isSnowflake(value) ? value : undefined;
}

/**
 * L'acteur peut-il administrer CE serveur ? Vérifié depuis le cache du bot
 * (source de vérité) : propriétaire du serveur, ou membre ayant « Gérer le
 * serveur ». Empêche un porteur du token de purger n'importe quel serveur.
 */
async function actorCanManageGuild(
  ctx: BotContext,
  guildId: string,
  actorId: string,
): Promise<boolean> {
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) return false;
  if (guild.ownerId === actorId) return true;
  const member = await guild.members.fetch(actorId).catch(() => null);
  return member?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;
}

/**
 * Limiteur de débit en mémoire (mono-processus) pour les actions destructrices.
 * Renvoie `false` si `key` a dépassé `max` appels dans `windowMs`.
 */
const rateBuckets = new Map<string, number[]>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
  if (hits.length >= max) {
    rateBuckets.set(key, hits);
    return false;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return true;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 512_000) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Sérialise l'état d'un module pour le dashboard. */
async function serializeModule(
  ctx: BotContext,
  guildId: string,
  module: ModuleRegistry['modules'][number],
): Promise<Record<string, unknown>> {
  const state = await ctx.config.getModuleState(guildId, module.name, module.configSchema);
  const visual = moduleVisual(module.name);
  return {
    name: module.name,
    label: t(module.labelKey),
    description: t(module.descriptionKey),
    category: visual.category,
    emoji: visual.emoji,
    enabled: state.enabled,
    config: state.config,
    configUI: module.configUI ?? null,
    publishable: PUBLISHERS[module.name] !== undefined,
  };
}

/** Salons et rôles d'un serveur, pour peupler les sélecteurs du dashboard. */
function serializeGuildMeta(guild: Guild): Record<string, unknown> {
  const channels = guild.channels.cache
    .filter((c) => c.type === 0 || c.type === 2 || c.type === 4 || c.type === 5 || c.type === 15)
    .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id) // exclut @everyone
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))
    .sort((a, b) => b.name.localeCompare(a.name));
  return { channels, roles };
}

/**
 * Parcourt récursivement une config et collecte les couples (channelId,
 * messageId) : tout objet portant une clé finissant par « ChannelId » et une
 * finissant par « MessageId » désigne un message publié par le bot (panneaux,
 * classements, sticky, messages interactifs…).
 */
function collectMessagePairs(
  node: unknown,
  pairs: Array<{ channelId: string; messageId: string }>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectMessagePairs(item, pairs);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const channels: string[] = [];
  const messages: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && value) {
      if (/channelId$/i.test(key)) channels.push(value);
      else if (/messageId$/i.test(key)) messages.push(value);
    }
  }
  for (const messageId of messages) {
    for (const channelId of channels) pairs.push({ channelId, messageId });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectMessagePairs(value, pairs);
  }
}

/**
 * Supprime les messages publiés par le bot pour ce serveur (panneaux règlement,
 * tickets, vérification, rôles-réactions, messages interactifs, sticky,
 * classements…), à partir des `messageId` stockés en config. À appeler AVANT
 * d'effacer la config. Best-effort : on ignore les messages déjà supprimés.
 */
async function deleteTrackedMessages(ctx: BotContext, guild: Guild): Promise<void> {
  const rows = await ctx.db.moduleConfig.findMany({ where: { guildId: guild.id } });
  const pairs: Array<{ channelId: string; messageId: string }> = [];
  for (const row of rows) {
    let config: unknown;
    try {
      config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    } catch {
      continue;
    }
    collectMessagePairs(config, pairs);
  }
  // Déduplique (channelId|messageId).
  const seen = new Set<string>();
  for (const { channelId, messageId } of pairs) {
    const dedup = `${channelId}|${messageId}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    const channel =
      guild.channels.cache.get(channelId) ??
      (await guild.channels.fetch(channelId).catch(() => null));
    if (channel?.isTextBased()) {
      await channel.messages.delete(messageId).catch(() => undefined);
    }
  }
}

/**
 * Supprime les SALONS créés par le bot (salons de tickets, salons vocaux
 * temporaires). Les compteurs serverstats sont laissés : ce sont des salons de
 * l'utilisateur simplement renommés.
 */
async function deleteBotChannels(ctx: BotContext, guild: Guild): Promise<void> {
  const [tickets, temp] = await Promise.all([
    ctx.db.ticket.findMany({ where: { guildId: guild.id }, select: { channelId: true } }),
    ctx.db.tempVoiceChannel.findMany({ where: { guildId: guild.id }, select: { id: true } }),
  ]);
  const ids = new Set<string>();
  for (const t of tickets) if (t.channelId) ids.add(t.channelId);
  for (const v of temp) ids.add(v.id);
  for (const id of ids) {
    const channel =
      guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    await channel?.delete().catch(() => undefined);
  }
}

/** Supprime les webhooks créés par le bot (interserveur, profils, rollback…). */
async function deleteBotWebhooks(ctx: BotContext, guild: Guild): Promise<void> {
  const selfId = ctx.client.user?.id;
  if (!selfId) return;
  const webhooks = await guild.fetchWebhooks().catch(() => null);
  if (!webhooks) return;
  for (const webhook of webhooks.values()) {
    if (webhook.owner?.id === selfId) await webhook.delete().catch(() => undefined);
  }
}

/**
 * Supprime TOUT ce que le bot a créé pour un serveur — messages publiés, salons
 * (tickets, vocaux temporaires), webhooks — puis toutes les données (DB), et
 * fait enfin quitter le bot. Les tables sont découvertes dynamiquement (colonne
 * `guildId`) pour rester exhaustif ; les tables enfants partent en cascade (FK).
 */
async function purgeGuild(ctx: BotContext, guildId: string): Promise<number> {
  // 1. Supprime messages, salons et webhooks créés par le bot AVANT d'effacer la config.
  const guild = ctx.client.guilds.cache.get(guildId);
  if (guild) {
    await deleteTrackedMessages(ctx, guild).catch(() => undefined);
    await deleteBotChannels(ctx, guild).catch(() => undefined);
    await deleteBotWebhooks(ctx, guild).catch(() => undefined);
  }

  const tables = await ctx.db.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) p ' +
      "WHERE m.type = 'table' AND p.name = 'guildId'",
  );
  let deleted = 0;
  for (const { name } of tables) {
    // `name` vient de sqlite_master (jamais d'entrée utilisateur) ; guildId est paramétré.
    deleted += await ctx.db.$executeRawUnsafe(`DELETE FROM "${name}" WHERE "guildId" = ?`, guildId);
  }
  // Ligne Guild elle-même (clé `id`) : supprime la config restante en cascade.
  await ctx.db.$executeRawUnsafe(`DELETE FROM "Guild" WHERE "id" = ?`, guildId).catch(() => 0);

  // Le bot quitte le serveur (best-effort).
  await guild?.leave().catch(() => undefined);

  return deleted;
}

/**
 * Petite API HTTP privée consommée par le dashboard web (Vercel). Toutes les
 * routes exigent le token `WEB_API_TOKEN`. Rien n'est exposé sans ce secret ;
 * le site est seul à le connaître (côté serveur uniquement).
 */
export function startWebApi(ctx: BotContext, registry: ModuleRegistry): void {
  if (!env.WEB_API_TOKEN) {
    log.info('WEB_API_TOKEN absent : API web désactivée.');
    return;
  }

  log.warn(
    'API web active : à publier UNIQUEMENT via HTTPS (reverse-proxy Caddy ou ' +
      "tunnel). En HTTP clair, le token d'administration voyagerait interceptable.",
  );

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log.error({ err: error }, 'Erreur API web');
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    if (parts[0] !== 'api') return send(res, 404, { error: 'not_found' });
    if (parts[1] === 'health') return send(res, 200, { ok: true });

    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

    // Défense en profondeur : tout identifiant de serveur doit être un snowflake.
    if (parts[1] === 'guilds' && !isSnowflake(parts[2])) {
      return send(res, 400, { error: 'invalid_guild_id' });
    }

    // POST /api/guilds/:id/purge  -> efface toutes les données + le bot quitte
    if (req.method === 'POST' && parts[1] === 'guilds' && parts[3] === 'purge' && parts[2]) {
      const guildId = parts[2];
      // Autorisation forte côté bot : l'acteur doit pouvoir gérer CE serveur.
      const actorId = getActorId(req);
      if (!actorId || !(await actorCanManageGuild(ctx, guildId, actorId))) {
        return send(res, 403, { error: 'forbidden' });
      }
      if (!rateLimit(`purge:${guildId}`, 3, 60_000)) {
        return send(res, 429, { error: 'rate_limited' });
      }
      const deleted = await purgeGuild(ctx, guildId);
      log.warn({ guildId, actorId, deleted }, 'Purge des données du serveur (demande web)');
      return send(res, 200, { ok: true, deleted });
    }

    // GET /api/guilds/:id/modules
    if (req.method === 'GET' && parts[1] === 'guilds' && parts[3] === 'modules' && parts[2]) {
      const guildId = parts[2];
      const guild = ctx.client.guilds.cache.get(guildId);
      const modules = await Promise.all(
        registry.modules.filter((m) => !m.internal).map((m) => serializeModule(ctx, guildId, m)),
      );
      return send(res, 200, {
        guild: guild ? { id: guild.id, name: guild.name } : null,
        botPresent: Boolean(guild),
        modules,
      });
    }

    // GET /api/guilds/:id/meta  -> salons + rôles pour les sélecteurs
    if (req.method === 'GET' && parts[1] === 'guilds' && parts[3] === 'meta' && parts[2]) {
      const guild = ctx.client.guilds.cache.get(parts[2]);
      if (!guild) return send(res, 404, { error: 'unknown_guild' });
      return send(res, 200, serializeGuildMeta(guild));
    }

    // POST /api/guilds/:id/modules/:module/toggle   { enabled: boolean }
    if (
      req.method === 'POST' &&
      parts[1] === 'guilds' &&
      parts[3] === 'modules' &&
      parts[5] === 'toggle' &&
      parts[2] &&
      parts[4]
    ) {
      const guildId = parts[2];
      const module = registry.modules.find((m) => m.name === parts[4] && !m.internal);
      if (!module) return send(res, 404, { error: 'unknown_module' });
      const body = (await readJson(req)) as { enabled?: unknown };
      const enabled = body.enabled === true;
      await ctx.config.setEnabled(guildId, module.name, enabled, module.defaultConfig ?? {});
      if (enabled) await module.onLoad?.(ctx).catch(() => undefined);
      return send(res, 200, await serializeModule(ctx, guildId, module));
    }

    // POST /api/guilds/:id/modules/:module/config   { config: unknown }
    if (
      req.method === 'POST' &&
      parts[1] === 'guilds' &&
      parts[3] === 'modules' &&
      parts[5] === 'config' &&
      parts[2] &&
      parts[4]
    ) {
      const guildId = parts[2];
      const module = registry.modules.find((m) => m.name === parts[4] && !m.internal);
      if (!module) return send(res, 404, { error: 'unknown_module' });
      const body = (await readJson(req)) as { config?: unknown };
      // Validation zod stricte : on ne persiste jamais une config invalide.
      if (module.configSchema) {
        const parsed = module.configSchema.safeParse(body.config);
        if (!parsed.success) return send(res, 400, { error: 'invalid_config' });
        await ctx.config.setConfig(guildId, module.name, parsed.data);
      } else {
        await ctx.config.setConfig(guildId, module.name, body.config ?? {});
      }
      return send(res, 200, await serializeModule(ctx, guildId, module));
    }

    // POST /api/guilds/:id/modules/:module/publish  -> publie/màj le panneau
    if (
      req.method === 'POST' &&
      parts[1] === 'guilds' &&
      parts[3] === 'modules' &&
      parts[5] === 'publish' &&
      parts[2] &&
      parts[4]
    ) {
      const guildId = parts[2];
      const module = registry.modules.find((m) => m.name === parts[4] && !m.internal);
      if (!module) return send(res, 404, { error: 'unknown_module' });
      const publisher = PUBLISHERS[module.name];
      if (!publisher) return send(res, 400, { error: 'not_publishable' });
      const guild = ctx.client.guilds.cache.get(guildId);
      if (!guild) return send(res, 404, { error: 'unknown_guild' });
      const state = await ctx.config.getModuleState(guildId, module.name, module.configSchema);
      const result = await publisher(guild, state.config);
      // Persiste le messageId retourné pour permettre les mises à jour futures.
      if (result.ok && result.messageId && state.config && typeof state.config === 'object') {
        await ctx.config.setConfig(guildId, module.name, {
          ...(state.config as Record<string, unknown>),
          messageId: result.messageId,
        });
      }
      return send(res, result.ok ? 200 : 400, result);
    }

    // GET /api/deploy  -> statut ; POST /api/deploy { branch } -> déclenche /maj
    if (parts[1] === 'deploy' && parts.length === 2) {
      if (!deployEnabled()) return send(res, 404, { error: 'deploy_disabled' });
      if (req.method === 'GET') {
        return send(res, 200, {
          branches: deployBranches(),
          status: await readStatus(),
          result: await readResult(),
        });
      }
      if (req.method === 'POST') {
        // Déploiement hôte (rebuild/restart) : réservé au propriétaire du bot,
        // vérifié ICI et pas seulement via le bouton caché du dashboard.
        const actorId = getActorId(req);
        if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });
        if (!rateLimit('deploy', 3, 60_000)) return send(res, 429, { error: 'rate_limited' });
        const body = (await readJson(req)) as { branch?: unknown };
        const branch = typeof body.branch === 'string' ? body.branch : undefined;
        if (branch && !deployBranches().includes(branch)) {
          return send(res, 400, { error: 'unknown_branch' });
        }
        const requestedAt = await requestDeploy(actorId, undefined, branch);
        return send(res, 202, { ok: true, requestedAt });
      }
    }

    return send(res, 404, { error: 'not_found' });
  }

  server.listen(env.WEB_API_PORT, () => {
    log.info({ port: env.WEB_API_PORT }, 'API web démarrée');
  });
  server.on('error', (error) => log.error({ err: error }, 'API web : erreur serveur'));
}
