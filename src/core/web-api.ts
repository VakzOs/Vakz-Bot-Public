import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { logger } from './logger.js';
import { contextFor } from './context.js';
import { t } from './i18n.js';
import { moduleVisual } from './module-catalog.js';
import { getRegistry } from './loader.js';
import type { BotContext, BotModule, ModuleActionResult, ModuleHttpRoute } from './module.js';
import type { ModuleRegistry } from './loader.js';
import {
  readResult,
  readRunningLog,
  readStatus,
  requestDeploy,
} from '../modules/deploy/service.js';
import { deployEnabled, isOwner, toDeployMode } from '../modules/deploy/service.js';
import {
  branchesFetchedAt,
  isValidBranchName,
  listDeployBranches,
  refreshBranches,
} from '../modules/deploy/branches.js';
import {
  cleanCommitMessage,
  getExtras,
  getFeatures,
  hasPendingSync,
  isValidExcludePattern,
  listPublishableModules,
  readSyncBaseline,
  readSyncLog,
  readSyncResult,
  readSyncStatus,
  requestSync,
  resolveExcludes,
  setExtras,
  setFeatures,
  toSyncTarget,
} from '../modules/deploy/sync.js';
import {
  applyRestartSchedule,
  getRestartSettings,
  restartNow,
  RESTART_AUTO_KEY,
  RESTART_CRON_KEY,
  writeRestartSetting,
} from '../modules/deploy/restart.js';
import {
  applyBootPresence,
  currentPresence,
  DEFAULT_PRESENCE_LINES,
  getPresenceLines,
  MAX_PRESENCE_LENGTH,
  MAX_PRESENCE_LINES,
  setPresenceLines,
} from './presence.js';
import { PermissionFlagsBits, type Guild } from 'discord.js';
import {
  LOG_BUFFER_CAPACITY,
  bufferOldest,
  bufferSize,
  parseLevelNames,
  recentLogs,
} from './log-buffer.js';
import { archiveInfo, isDayKey, readArchive } from './log-archive.js';
import { metricsSnapshot, parseWindow } from './metrics.js';
import {
  CRON_PRESETS,
  type ConfigbackupConfig,
  getBackupConfig,
  updateBackupConfig,
} from '../modules/configbackup/config.js';
import { applyBackup, parseBackup, runBackup } from '../modules/configbackup/service.js';
import { isValidCron, syncGuildBackupJob } from '../modules/configbackup/schedule.js';
import {
  backupsSize,
  decodeBackupFile,
  deleteBackupFile,
  isSafeBackupName,
  listBackups,
  readBackupFile,
} from '../modules/configbackup/storage.js';
import { EXCLUDED_TABLES } from '../modules/configbackup/dump.js';

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

/** Réponse non-JSON (téléchargement d'un fichier de sauvegarde). */
function sendRaw(
  res: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string>,
): void {
  res.writeHead(status, { ...headers, 'content-length': body.length });
  res.end(body);
}

/** Lit le corps brut d'une requête, borné pour ne pas se faire saturer. */
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage, maxBytes = 512_000): Promise<unknown> {
  const body = await readBody(req, maxBytes);
  if (body.length === 0) return {};
  return JSON.parse(body.toString('utf8'));
}

/** Sérialise l'état d'un module pour le dashboard. */
async function serializeModule(
  ctx: BotContext,
  guildId: string,
  module: ModuleRegistry['modules'][number],
): Promise<Record<string, unknown>> {
  const state = await ctx.config.getModuleState(guildId, module.name, module.configSchema);
  const visual = moduleVisual(module);
  return {
    name: module.name,
    label: t(module.labelKey),
    description: t(module.descriptionKey),
    category: visual.category,
    emoji: visual.emoji,
    enabled: state.enabled,
    config: state.config,
    configUI: module.configUI ?? null,
    publishable: typeof module.publishPanel === 'function',
    actions: await Promise.all(
      (module.actions ?? []).map(async (action) => ({
        id: action.id,
        label: action.label,
        help: action.help ?? null,
        style: action.style ?? 'secondary',
        confirm: action.confirm ?? null,
        // `resolveFields` dépend du serveur : une erreur de résolution ne doit
        // pas faire tomber toute la page du module — on retombe sur `fields`.
        fields:
          (await action.resolveFields?.(ctx, guildId).catch(() => null)) ?? action.fields ?? null,
      })),
    ),
  };
}

/** Sérialise un objet du catalogue pour le dashboard (champs éditables). */
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

/** État complet du panneau « Sauvegarde » d'un serveur. */
async function backupState(ctx: BotContext, guildId: string): Promise<Record<string, unknown>> {
  const [settings, backups, totalSize] = await Promise.all([
    getBackupConfig(ctx, guildId),
    listBackups(guildId),
    backupsSize(guildId),
  ]);
  return {
    settings,
    backups,
    totalSize,
    presets: CRON_PRESETS,
    // Ce que la sauvegarde laisse volontairement de côté, pour que le dashboard
    // puisse le dire plutôt que de laisser croire à un oubli.
    excludedTables: [...EXCLUDED_TABLES],
  };
}

/** Restaure un serveur depuis le contenu d'un fichier (compressé ou non). */
async function restoreFrom(
  res: ServerResponse,
  ctx: BotContext,
  guildId: string,
  file: Buffer,
  opts: { recreate: boolean; data: boolean },
): Promise<void> {
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) return send(res, 404, { error: 'unknown_guild' });

  let raw: string;
  try {
    raw = decodeBackupFile(file);
  } catch {
    return send(res, 400, { error: 'invalid_file' });
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) return send(res, 400, { error: `invalid_${parsed.reason}` });

  try {
    const result = await applyBackup(ctx, guild, parsed.backup, opts);
    log.warn({ guildId, rows: result.data?.total ?? 0 }, 'Restauration du serveur (demande web)');
    return send(res, 200, { ok: true, result });
  } catch (error) {
    log.error({ err: error, guildId }, 'Restauration du serveur échouée');
    return send(res, 500, { ok: false, error: 'restore_failed' });
  }
}

/**
 * Petite API HTTP privée consommée par le dashboard web (Vercel). Toutes les
 * routes exigent le token `WEB_API_TOKEN`. Rien n'est exposé sans ce secret ;
 * le site est seul à le connaître (côté serveur uniquement).
 */
/**
 * Les endpoints declares par les modules, indexes par leur premier segment.
 *
 * Construit une fois au demarrage : le registre ne bouge plus ensuite, et un
 * parcours de tous les modules a chaque requete serait payer a chaque appel ce
 * qui se calcule une fois. Un segment reclame deux fois est refuse — mieux
 * vaut un demarrage bruyant qu'une route qui repond pour le mauvais module.
 */
/**
 * Segments de `/api/guilds/:id/…` que le cœur sert lui-même. Un module qui en
 * réclamerait un ne serait jamais appelé — autant le dire au démarrage.
 */
const RESERVED_GUILD_SEGMENTS = new Set(['purge', 'modules', 'meta', 'backup']);

function collectModuleRoutes(modules: BotModule[]): {
  public: Map<string, ModuleHttpRoute>;
  owner: Map<string, ModuleHttpRoute>;
  guild: Map<string, ModuleHttpRoute>;
} {
  const routes = {
    public: new Map<string, ModuleHttpRoute>(),
    owner: new Map<string, ModuleHttpRoute>(),
    guild: new Map<string, ModuleHttpRoute>(),
  };
  for (const module of modules) {
    for (const route of module.httpRoutes ?? []) {
      if (route.guild && RESERVED_GUILD_SEGMENTS.has(route.segment)) {
        log.error(
          { segment: route.segment, module: module.name },
          'Segment de serveur reserve par le coeur : la route ne sera jamais atteinte',
        );
        continue;
      }
      const target = route.guild ? routes.guild : route.owner ? routes.owner : routes.public;
      const existing = target.get(route.segment);
      if (existing) {
        log.error(
          { segment: route.segment, module: module.name },
          'Deux modules reclament le meme segment HTTP : le second est ignore',
        );
        continue;
      }
      target.set(route.segment, route);
    }
  }
  return routes;
}

export function startWebApi(ctx: BotContext, registry: ModuleRegistry): void {
  const moduleRoutes = collectModuleRoutes(registry.modules);
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

    // /api/owner/* -> réglages GLOBAUX de l'instance, réservés au propriétaire
    // du bot. Le token prouve que le site parle ; `x-actor-id` dit qui agit, et
    // seul BOT_OWNER_ID passe : un serveur bloqué ne doit pas pouvoir se
    // débloquer lui-même, fût-ce en appelant l'API directement.
    if (parts[1] === 'owner') {
      const actorId = getActorId(req);
      if (!env.BOT_OWNER_ID || actorId !== env.BOT_OWNER_ID) {
        return send(res, 403, { error: 'forbidden' });
      }

      // Les endpoints qu'un MODULE declare pour le proprietaire (voir
      // `ModuleHttpRoute`). Le coeur ne connait pas leur contenu : il a deja
      // verifie la garde ci-dessus, il lit le corps et relaie.
      const ownerRoute = moduleRoutes.owner.get(parts[2] ?? '');
      if (ownerRoute) {
        const body = await readJson(req, ownerRoute.maxBodyBytes ?? 8_000).catch(() => null);
        const result = await ownerRoute.handle(ctx, {
          method: req.method ?? 'GET',
          segments: parts.slice(3),
          body,
          actorId,
          isOwner: true,
          rateLimit,
        });
        return send(res, result.status, result.body);
      }

      // GET  /api/owner/sync-public      -> inventaire, listes et etat
      // POST /api/owner/sync-public      { features, extras } -> enregistre
      // POST /api/owner/sync-public/run  { dryRun, target, message } -> demande
      //
      // La publication vers les miroirs publics. Deja sous la garde `owner`
      // ci-dessus : c'est un reglage d'instance, pas de serveur.
      if (parts[2] === 'sync-public' && (parts.length === 3 || parts[3] === 'run')) {
        if (req.method === 'GET' && parts.length === 3) {
          return send(res, 200, {
            // Une ligne par fonctionnalite, avec ce qu'elle occupe DANS CHAQUE
            // depot : le dashboard coche une fois et montre les deux cotes.
            modules: await listPublishableModules(ctx, registry.modules),
            features: await getFeatures(ctx, registry.modules),
            // Ce qui n'appartient a aucune fonctionnalite : documents, scripts,
            // outils. Une liste par depot — un module se coche, un chemin
            // s'ecrit.
            extras: {
              bot: await getExtras(ctx, 'bot', registry.modules),
              site: await getExtras(ctx, 'site', registry.modules),
            },
            // Ce qui partirait vraiment, fonctionnalites resolues : c'est la
            // seule facon de verifier AVANT de publier que la case cochee
            // recouvre bien ce qu'on croit.
            resolved: {
              bot: await resolveExcludes(ctx, registry.modules, 'bot'),
              site: await resolveExcludes(ctx, registry.modules, 'site'),
            },
            // Le socle réglé sur l'hôte : affiché en lecture seule, parce que
            // ce qui ne doit jamais sortir ne se confie pas à un navigateur.
            baseline: await readSyncBaseline(),
            pending: await hasPendingSync(),
            status: await readSyncStatus(),
            result: await readSyncResult(),
            // `null` = aucune publication en cours (voir `readSyncLog`).
            runningLog: await readSyncLog(),
          });
        }

        if (req.method === 'POST' && parts.length === 3) {
          const body = (await readJson(req, 32_000).catch(() => null)) as {
            features?: unknown;
            extras?: { bot?: unknown; site?: unknown };
          } | null;
          if (!Array.isArray(body?.features)) return send(res, 400, { error: 'invalid_features' });

          const strings = (value: unknown): string[] =>
            Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

          const submittedBot = strings(body.extras?.bot);
          const submittedSite = strings(body.extras?.site);
          // Dire CE QUI a ete refuse, pas seulement que quelque chose l'a ete :
          // sans cette liste, une ligne qui disparait est un mystere.
          const rejected = [...submittedBot, ...submittedSite].filter(
            (p) => !isValidExcludePattern(p.trim()),
          );

          const features = await setFeatures(ctx, registry.modules, strings(body.features));
          const extras = {
            bot: await setExtras(ctx, 'bot', submittedBot),
            site: await setExtras(ctx, 'site', submittedSite),
          };
          log.warn(
            {
              actorId,
              features: features.length,
              bot: extras.bot.length,
              site: extras.site.length,
            },
            'Miroir public : liste d exclusion modifiee',
          );
          return send(res, 200, { features, extras, rejected });
        }

        if (req.method === 'POST' && parts[3] === 'run') {
          // Meme cadence que `/maj` : c'est un clone, une copie et une
          // construction complete du projet sur l'hote.
          if (!rateLimit('sync-public', 3, 60_000))
            return send(res, 429, { error: 'rate_limited' });
          if (await hasPendingSync()) return send(res, 409, { error: 'already_pending' });
          const body = (await readJson(req, 4_000).catch(() => null)) as {
            dryRun?: unknown;
            target?: unknown;
            message?: unknown;
          } | null;
          // Par defaut on NE POUSSE PAS : publier est irreversible (le miroir
          // est public), la repetition generale ne l'est pas. Et par defaut on
          // vise le bot, le depot historique de cet outil.
          const dryRun = body?.dryRun !== false;
          const target = toSyncTarget(body?.target);
          const requestedAt = await requestSync(ctx, registry.modules, actorId, {
            dryRun,
            target,
            message: cleanCommitMessage(body?.message),
          });
          log.warn({ actorId, dryRun, target }, 'Miroir public : publication demandee');
          return send(res, 202, { ok: true, requestedAt, dryRun, target });
        }
      }

      return send(res, 404, { error: 'not_found' });
    }

    // Les endpoints qu'un MODULE declare (voir `ModuleHttpRoute`). C'est ce
    // qui remplace un `if (parts[1] === '<module>')` par module dans le coeur :
    // sans cela, retirer un dossier de module casse la compilation d'ici.
    const moduleRoute = moduleRoutes.public.get(parts[1] ?? '');
    if (moduleRoute) {
      const actorId = getActorId(req);
      const body = await readJson(req, moduleRoute.maxBodyBytes ?? 8_000).catch(() => null);
      const result = await moduleRoute.handle(ctx, {
        method: req.method ?? 'GET',
        segments: parts.slice(2),
        body,
        actorId,
        isOwner: Boolean(actorId && isOwner(actorId)),
        rateLimit,
      });
      return send(res, result.status, result.body);
    }

    // Les endpoints qu'un module declare sous `/api/guilds/:id/<segment>`.
    // L'identifiant a deja ete valide plus haut ; le coeur fournit en plus
    // `canManageGuild()`, pour qu'une autorisation ne se reimplemente pas par
    // module. Place avant les routes de serveur du coeur, dont les segments
    // sont reserves (voir `RESERVED_GUILD_SEGMENTS`) : aucune ne peut donc
    // etre masquee par un module.
    const guildRoute = parts[1] === 'guilds' ? moduleRoutes.guild.get(parts[3] ?? '') : undefined;
    if (guildRoute && parts[2]) {
      const guildId = parts[2];
      const actorId = getActorId(req);
      const body = await readJson(req, guildRoute.maxBodyBytes ?? 8_000).catch(() => null);
      const result = await guildRoute.handle(ctx, {
        method: req.method ?? 'GET',
        segments: parts.slice(4),
        body,
        actorId,
        isOwner: Boolean(actorId && isOwner(actorId)),
        guildId,
        canManageGuild: async () =>
          Boolean(actorId && (await actorCanManageGuild(ctx, guildId, actorId))),
        rateLimit,
      });
      return send(res, result.status, result.body);
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
      // Un module fermé sur ce serveur n'a pas à s'y proposer : le configurer
      // n'y ferait rien, et la carte promettrait un jeu qui refusera de jouer.
      const candidates = registry.modules.filter((m) => !m.internal);
      const availability = await Promise.all(
        candidates.map((m) => m.isAvailable?.(ctx, guildId) ?? Promise.resolve(true)),
      );
      const modules = await Promise.all(
        candidates
          .filter((_, index) => availability[index] !== false)
          .map((m) => serializeModule(ctx, guildId, m)),
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
      const moduleCtx = contextFor(ctx, module.name);
      moduleCtx.logger.info(
        { guildId, enabled, actorId: getActorId(req) },
        enabled ? 'Module activé depuis le dashboard' : 'Module désactivé depuis le dashboard',
      );
      if (enabled) {
        // `catch(() => undefined)` avalait ici l'échec d'un `onLoad` : le module
        // s'affichait activé, ne fonctionnait pas, et rien nulle part ne disait
        // pourquoi. On avale toujours (le dashboard ne doit pas planter), mais
        // on le dit.
        await module.onLoad?.(moduleCtx).catch((error: unknown) => {
          moduleCtx.logger.error({ err: error, guildId }, 'Échec de onLoad après activation');
        });
      }
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
      // Config remplacée : le module en a besoin pour nettoyer ce qui disparaît.
      const before = (await ctx.config.getModuleState(guildId, module.name, module.configSchema))
        .config;
      let saved: unknown;
      if (module.configSchema) {
        const parsed = module.configSchema.safeParse(body.config);
        if (!parsed.success) {
          // Le dashboard est le seul point de configuration : un refus doit dire
          // QUEL champ pose problème, pas seulement « config invalide ».
          // Il le dit aussi aux logs : une config refusée en boucle est un
          // symptôme qu'on ne voit pas depuis l'écran de l'administrateur.
          contextFor(ctx, module.name).logger.warn(
            { guildId, champs: parsed.error.issues.map((issue) => issue.path.join('.')) },
            'Configuration refusée',
          );
          return send(res, 400, {
            error: 'invalid_config',
            issues: parsed.error.issues.slice(0, 20).map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          });
        }
        saved = parsed.data;
      } else {
        saved = body.config ?? {};
      }
      await ctx.config.setConfig(guildId, module.name, saved);
      const savedCtx = contextFor(ctx, module.name);
      savedCtx.logger.info(
        { guildId, actorId: getActorId(req) },
        'Configuration enregistrée depuis le dashboard',
      );
      // Le module réaligne ce qui dépend de la config (cadences, tâches…).
      await module.onConfigSaved?.(savedCtx, guildId, saved, before).catch((error: unknown) => {
        savedCtx.logger.error({ err: error, guildId }, 'onConfigSaved a échoué');
      });
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
      const publisher = module.publishPanel?.bind(module);
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

    // POST /api/guilds/:id/modules/:module/actions/:action  { input }
    if (
      req.method === 'POST' &&
      parts[1] === 'guilds' &&
      parts[3] === 'modules' &&
      parts[5] === 'actions' &&
      parts[2] &&
      parts[4] &&
      parts[6]
    ) {
      const guildId = parts[2];
      const module = registry.modules.find((m) => m.name === parts[4] && !m.internal);
      if (!module) return send(res, 404, { error: 'unknown_module' });
      const action = module.actions?.find((a) => a.id === parts[6]);
      if (!action) return send(res, 404, { error: 'unknown_action' });
      // Une action agit sur le serveur (publie, envoie, supprime) : on exige le
      // même niveau de preuve que pour une purge — l'acteur doit gérer CE serveur.
      const actorId = getActorId(req);
      if (!actorId || !(await actorCanManageGuild(ctx, guildId, actorId))) {
        return send(res, 403, { error: 'forbidden' });
      }
      if (!rateLimit(`action:${guildId}:${action.id}`, 10, 60_000)) {
        return send(res, 429, { error: 'rate_limited' });
      }
      const body = (await readJson(req)) as { input?: unknown };
      const input =
        body.input && typeof body.input === 'object' && !Array.isArray(body.input)
          ? (body.input as Record<string, unknown>)
          : {};

      // Une action du dashboard publie, envoie ou supprime sur un vrai serveur :
      // elle mérite une trace même quand tout se passe bien. Sans ligne de
      // succès, « qui a republié ce panneau, et quand ? » reste sans réponse.
      const actionCtx = contextFor(ctx, module.name);
      const startedAt = Date.now();
      let result: ModuleActionResult;
      try {
        result = await action.run({ ctx: actionCtx, guildId, actorId, input });
      } catch (error) {
        actionCtx.logger.error(
          { err: error, action: action.id, guildId, actorId, ms: Date.now() - startedAt },
          'Action du dashboard en échec',
        );
        // Le détail technique reste dans les logs : jamais renvoyé au dashboard.
        return send(res, 500, { ok: false, error: 'action_failed' });
      }
      actionCtx.logger[result.ok ? 'info' : 'warn'](
        { action: action.id, guildId, actorId, ok: result.ok, ms: Date.now() - startedAt },
        result.ok ? 'Action du dashboard exécutée' : 'Action du dashboard refusée',
      );

      // L'action peut demander à persister un résultat (ex. messageId publié).
      if (result.ok && result.configPatch) {
        const state = await ctx.config.getModuleState(guildId, module.name, module.configSchema);
        const base = (state.config ?? {}) as Record<string, unknown>;
        const patched = { ...base, ...result.configPatch };
        await ctx.config.setConfig(guildId, module.name, patched);
        await module.onConfigSaved?.(actionCtx, guildId, patched, base).catch((error: unknown) => {
          actionCtx.logger.error({ err: error, guildId }, 'Échec de onConfigSaved');
        });
      }
      return send(res, result.ok ? 200 : 400, {
        ok: result.ok,
        message: result.message ?? null,
        module: await serializeModule(ctx, guildId, module),
      });
    }

    // --- Sauvegarde du serveur (module « Sauvegarde ») ----------------------
    // GET    /api/guilds/:id/backup                -> réglages + fichiers déposés
    // POST   /api/guilds/:id/backup                -> règle la planification / lance
    // GET    /api/guilds/:id/backup/files/:name    -> télécharge un fichier
    // DELETE /api/guilds/:id/backup/files/:name    -> supprime un fichier
    // POST   /api/guilds/:id/backup/restore        -> restaure un fichier déposé
    // POST   /api/guilds/:id/backup/upload         -> restaure un fichier téléversé
    //
    // Une sauvegarde contient les données des membres : chaque route — lecture
    // comprise — exige un acteur autorisé à gérer CE serveur, jamais le seul token.
    if (parts[1] === 'guilds' && parts[3] === 'backup' && parts[2]) {
      const guildId = parts[2];
      const actorId = getActorId(req);
      if (!actorId || !(await actorCanManageGuild(ctx, guildId, actorId))) {
        return send(res, 403, { error: 'forbidden' });
      }

      // GET /backup -> état complet du panneau
      if (req.method === 'GET' && !parts[4]) {
        return send(res, 200, await backupState(ctx, guildId));
      }

      // GET|DELETE /backup/files/:name
      if (parts[4] === 'files' && parts[5]) {
        const name = decodeURIComponent(parts[5]);
        if (!isSafeBackupName(name)) return send(res, 400, { error: 'invalid_name' });

        if (req.method === 'GET') {
          const file = await readBackupFile(guildId, name);
          if (!file) return send(res, 404, { error: 'unknown_file' });
          return sendRaw(res, 200, file, {
            'content-type': 'application/gzip',
            'content-disposition': `attachment; filename="${name}"`,
          });
        }
        if (req.method === 'DELETE') {
          const removed = await deleteBackupFile(guildId, name);
          return send(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'unknown_file' });
        }
      }

      // POST /backup/restore  { file, recreate?, data? }
      if (req.method === 'POST' && parts[4] === 'restore') {
        if (!rateLimit(`backup-restore:${guildId}`, 5, 60_000)) {
          return send(res, 429, { error: 'rate_limited' });
        }
        const body = (await readJson(req)) as {
          file?: unknown;
          recreate?: unknown;
          data?: unknown;
        };
        const name = typeof body.file === 'string' ? body.file : '';
        if (!isSafeBackupName(name)) return send(res, 400, { error: 'invalid_name' });
        const file = await readBackupFile(guildId, name);
        if (!file) return send(res, 404, { error: 'unknown_file' });
        return restoreFrom(res, ctx, guildId, file, {
          recreate: body.recreate !== false,
          data: body.data !== false,
        });
      }

      // POST /backup/upload?recreate=1&data=1 -> corps = le fichier lui-même
      //
      // Le fichier transite en brut plutôt qu'en JSON : une sauvegarde complète
      // dépasse vite les quelques centaines de kilooctets qu'on accepte ailleurs,
      // et l'encapsuler en JSON la ferait grossir d'un tiers pour rien.
      if (req.method === 'POST' && parts[4] === 'upload') {
        if (!rateLimit(`backup-restore:${guildId}`, 5, 60_000)) {
          return send(res, 429, { error: 'rate_limited' });
        }
        let file: Buffer;
        try {
          file = await readBody(req, env.BACKUP_MAX_MB * 1024 * 1024);
        } catch {
          return send(res, 413, { error: 'too_large' });
        }
        return restoreFrom(res, ctx, guildId, file, {
          recreate: url.searchParams.get('recreate') !== '0',
          data: url.searchParams.get('data') !== '0',
        });
      }

      // POST /backup  { auto?, cron?, keep?, includeData?, channelId?, run? }
      if (req.method === 'POST' && !parts[4]) {
        if (!rateLimit(`backup:${guildId}`, 20, 60_000)) {
          return send(res, 429, { error: 'rate_limited' });
        }
        const body = (await readJson(req)) as Record<string, unknown>;
        const patch: Partial<ConfigbackupConfig> = {};

        if (typeof body.auto === 'boolean') patch.auto = body.auto;
        if (typeof body.includeData === 'boolean') patch.includeData = body.includeData;
        if (typeof body.cron === 'string') {
          // Le planificateur ignore en silence une expression qu'il ne comprend
          // pas : la refuser ici est le seul moyen d'éviter une sauvegarde
          // « automatique » que personne ne verrait jamais tourner.
          if (!isValidCron(body.cron)) return send(res, 400, { error: 'invalid_cron' });
          patch.cron = body.cron;
        }
        if (typeof body.keep === 'number' && Number.isFinite(body.keep)) {
          patch.keep = Math.min(60, Math.max(1, Math.trunc(body.keep)));
        }
        if (body.channelId === null || typeof body.channelId === 'string') {
          const channelId = body.channelId === '' ? null : (body.channelId as string | null);
          if (channelId !== null && !isSnowflake(channelId)) {
            return send(res, 400, { error: 'invalid_channel' });
          }
          patch.channelId = channelId;
        }

        if (Object.keys(patch).length > 0) {
          await updateBackupConfig(ctx, guildId, patch);
          // Réaligne (ou retire) le travail planifié de ce serveur.
          await syncGuildBackupJob(ctx, guildId);
        }

        let run: Awaited<ReturnType<typeof runBackup>> | null = null;
        if (body.run === true) {
          if (!rateLimit(`backup-run:${guildId}`, 3, 60_000)) {
            return send(res, 429, { error: 'rate_limited' });
          }
          run = await runBackup(ctx, guildId);
          log.info({ guildId, actorId, ok: run.ok }, 'Sauvegarde du serveur (demande web)');
        }

        return send(res, 200, { ...(await backupState(ctx, guildId)), run });
      }
    }

    // --- Catalogue d'objets (module « Objets ») -----------------------------
    // GET  /api/guilds/:id/items            -> catalogue + effectsUI (token seul)
    // POST /api/guilds/:id/items            -> crée un objet          (actor requis)
    // POST /api/guilds/:id/items/:itemId    -> met à jour un objet    (actor requis)
    // DELETE /api/guilds/:id/items/:itemId  -> supprime un objet      (actor requis)
    // GET /api/tasks  -> tâches planifiées réellement enregistrées
    //   Ce que le planificateur exécute vraiment, et non ce que la config
    //   laisse supposer : une expression cron invalide est ignorée en silence,
    //   la tâche correspondante n'apparaît alors simplement pas ici.
    //
    //   Réservé au propriétaire du bot, comme les logs : la liste couvre TOUS
    //   les serveurs à la fois, et un nom de tâche dit ce qui tourne sur
    //   l'instance. Rien là-dedans ne regarde l'administrateur d'un serveur.
    if (parts[1] === 'tasks' && parts.length === 2 && req.method === 'GET') {
      const actorId = getActorId(req);
      if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });
      const registry = getRegistry();
      const declared = (registry?.modules ?? []).flatMap((module) =>
        (module.tasks ?? []).map((task) => ({
          name: task.name,
          cron: task.cron,
          module: module.name,
        })),
      );
      const running = ctx.scheduler.names();
      return send(res, 200, {
        tasks: running.map((name) => ({
          name,
          cron: declared.find((task) => task.name === name)?.cron ?? null,
          module: declared.find((task) => task.name === name)?.module ?? null,
        })),
      });
    }

    // GET /api/metrics?from=<ms>&to=<ms>  -> l'état de santé de l'instance
    //   (propriétaire). Jauges de l'instant ET historique : une valeur seule ne
    //   dit pas si elle monte, et c'est la pente qu'on cherche quand on se
    //   demande si le bot tient la charge.
    //
    //   L'historique vient de la base (`METRICS_RETENTION_DAYS`), donc il
    //   traverse les redémarrages ; la réponse dit toujours ce qui est
    //   réellement gardé, pour ne pas promettre un passé qu'on n'a pas.
    //
    //   Réservé au propriétaire, comme les logs et les tâches : ces chiffres
    //   couvrent TOUS les serveurs à la fois et décrivent la machine hôte. Rien
    //   là-dedans ne regarde l'administrateur d'un serveur.
    if (parts[1] === 'metrics' && parts.length === 2 && req.method === 'GET') {
      const actorId = getActorId(req);
      if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });
      const loaded = getRegistry();
      const modules = loaded?.modules ?? [];
      return send(
        res,
        200,
        await metricsSnapshot({
          client: ctx.client,
          db: ctx.db,
          // Période demandée, en millisecondes : le panneau la calcule dans le
          // fuseau de l'administrateur (« hier », « le mois »), le bot se
          // contente de la borner.
          window: parseWindow(url.searchParams.get('from'), url.searchParams.get('to')),
          // Ce que le planificateur exécute VRAIMENT : une expression cron
          // invalide étant ignorée en silence, compter les tâches déclarées
          // annoncerait un travail qui ne tourne pas.
          tasks: ctx.scheduler.names().length,
          modules: {
            total: modules.length,
            public: modules.filter((module) => !module.internal).length,
            commands: loaded?.commands.size ?? 0,
          },
        }),
      );
    }

    // GET /api/logs?limit=&levels=&date=&search=&level=  (propriétaire)
    //   Réservé au propriétaire du bot : les logs d'une instance multi-serveurs
    //   parlent de tous les serveurs à la fois, et une ligne d'erreur peut
    //   contenir n'importe quoi.
    //
    //   Deux sources derrière la même route, parce que c'est la même question
    //   posée à deux distances :
    //     - sans `date` : le tampon mémoire, « ce qui vient de se passer » ;
    //     - avec `date` : l'archive du jour demandé, qui survit aux redémarrages.
    //   La réponse dit toujours LAQUELLE a répondu (`source`) et ce que
    //   l'archive contient réellement (`archive`) : le dashboard ne doit jamais
    //   laisser croire à un historique qui n'existe pas.
    //
    //   `levels` (ex. `warn,error`) coche des niveaux ; `level` reste accepté
    //   comme seuil cumulatif pour les appelants antérieurs au multi-choix.
    if (parts[1] === 'logs' && parts.length === 2 && req.method === 'GET') {
      const actorId = getActorId(req);
      if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });

      const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
      const minLevel = Number.parseInt(url.searchParams.get('level') ?? '', 10);
      const levels = parseLevelNames(url.searchParams.get('levels'));
      const search = url.searchParams.get('search')?.slice(0, 200) ?? '';
      const date = url.searchParams.get('date') ?? '';
      const archive = archiveInfo();

      if (date) {
        if (!isDayKey(date)) return send(res, 400, { error: 'invalid_date' });
        return send(res, 200, {
          source: 'archive',
          date,
          capacity: LOG_BUFFER_CAPACITY,
          archive,
          logs: await readArchive({
            day: date,
            ...(levels ? { levels } : {}),
            ...(search ? { search } : {}),
            ...(Number.isFinite(limit) ? { limit } : {}),
          }),
        });
      }

      return send(res, 200, {
        source: 'buffer',
        capacity: LOG_BUFFER_CAPACITY,
        buffered: bufferSize(),
        oldest: bufferOldest(),
        archive,
        logs: recentLogs({
          ...(Number.isFinite(limit) ? { limit } : {}),
          ...(levels ? { levels } : Number.isFinite(minLevel) ? { minLevel } : {}),
          ...(search ? { search } : {}),
        }),
      });
    }

    // Plafond GLOBAL de souhaits par membre.
    // GET  /api/gacha/wishlist-limit          -> { max } (token seul)
    // POST /api/gacha/wishlist-limit { max }  -> fixe le plafond (propriétaire)
    //   La liste de souhaits est globale au membre : son plafond l'est aussi.
    //   Un plafond par serveur ne contraindrait que le geste d'ajouter — on
    //   atteindrait la limite ici, on irait ajouter ailleurs, et tout resterait
    //   actif partout.
    // Statuts de profil du bot (« messages de profil »), GLOBAUX à l'instance.
    // GET  /api/presence           -> liste en vigueur + valeurs par défaut
    // POST /api/presence { lines } -> remplace la liste (propriétaire)
    //   Le bot n'affiche qu'un statut à la fois, tiré au démarrage : enregistrer
    //   une liste en applique donc un tout de suite, sans quoi on ne verrait
    //   l'effet de sa modification qu'au prochain redémarrage.
    if (parts[1] === 'presence' && parts.length === 2) {
      // Réglage d'instance : réservé au propriétaire du bot (comme /maj), en
      // lecture comme en écriture. Le token seul dit « le site parle » ; il ne
      // dit pas QUI parle, et un panneau d'instance n'a pas à répondre à
      // l'administrateur d'un serveur.
      const actorId = getActorId(req);
      if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });

      if (req.method === 'GET') {
        return send(res, 200, {
          lines: await getPresenceLines(ctx.db),
          defaults: [...DEFAULT_PRESENCE_LINES],
          current: currentPresence(ctx.client),
          maxLines: MAX_PRESENCE_LINES,
          maxLength: MAX_PRESENCE_LENGTH,
        });
      }

      if (req.method === 'POST') {
        if (!rateLimit('presence', 20, 60_000)) return send(res, 429, { error: 'rate_limited' });
        const body = (await readJson(req)) as { lines?: unknown };
        if (!Array.isArray(body.lines)) return send(res, 400, { error: 'invalid_lines' });
        const lines = await setPresenceLines(body.lines, ctx.db);
        // Applique tout de suite un statut de la nouvelle liste.
        const current = ctx.client.isReady()
          ? await applyBootPresence(ctx.client, ctx.logger).catch(() => currentPresence(ctx.client))
          : currentPresence(ctx.client);
        return send(res, 200, {
          lines,
          defaults: [...DEFAULT_PRESENCE_LINES],
          current,
          maxLines: MAX_PRESENCE_LINES,
          maxLength: MAX_PRESENCE_LENGTH,
        });
      }
    }

    // Redémarrage périodique du bot, GLOBAL à l'instance.
    // GET  /api/restart                        -> cadence + dernier redémarrage
    // POST /api/restart { auto, cron, now }    -> règle ou redémarre (propriétaire)
    //   Le bot ne se relance pas lui-même : il s'arrête proprement et le
    //   superviseur (docker `restart: unless-stopped`, systemd, pm2) le remonte.
    if (parts[1] === 'restart' && parts.length === 2) {
      // Arrêter le bot coupe TOUS les serveurs à la fois : réservé au
      // propriétaire (comme /maj), en lecture comme en écriture.
      const actorId = getActorId(req);
      if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });

      if (req.method === 'GET') return send(res, 200, await getRestartSettings(ctx));

      if (req.method === 'POST') {
        if (!rateLimit('restart', 10, 60_000)) return send(res, 429, { error: 'rate_limited' });
        const body = (await readJson(req)) as { auto?: unknown; cron?: unknown; now?: unknown };

        if (typeof body.cron === 'string') {
          // Le Scheduler ignore SILENCIEUSEMENT une expression invalide : sans
          // ce contrôle, on croirait avoir programmé un redémarrage qui ne
          // tomberait jamais.
          if (!isValidCron(body.cron)) return send(res, 400, { error: 'invalid_cron' });
          await writeRestartSetting(ctx.db, RESTART_CRON_KEY, body.cron);
        }
        if (typeof body.auto === 'boolean') {
          await writeRestartSetting(ctx.db, RESTART_AUTO_KEY, String(body.auto));
        }
        await applyRestartSchedule(ctx);

        const settings = await getRestartSettings(ctx);
        if (body.now === true) {
          // On répond AVANT de couper : sinon le dashboard ne verrait qu'une
          // connexion fermée, indistinguable d'une panne.
          send(res, 202, { ...settings, restarting: true });
          void restartNow(ctx, `demande du propriétaire ${actorId}`);
          return;
        }
        return send(res, 200, settings);
      }
    }

    // GET  /api/deploy  -> statut + branches du dépôt
    // POST /api/deploy { branch, mode }  -> déclenche /maj
    // POST /api/deploy/branches    -> redemande la liste à l'updater hôte
    if (parts[1] === 'deploy' && (parts.length === 2 || parts[2] === 'branches')) {
      if (!deployEnabled()) return send(res, 404, { error: 'deploy_disabled' });

      // Rafraîchissement de la liste : réservé au propriétaire, comme le
      // déploiement — c'est une commande envoyée à l'updater hôte, pas une
      // simple lecture.
      if (req.method === 'POST' && parts[2] === 'branches') {
        const actorId = getActorId(req);
        if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });
        // L'updater est sollicité à chaque appel : on borne plus court que le
        // reste, une liste de branches ne changeant pas toutes les secondes.
        if (!rateLimit('deploy-branches', 10, 60_000)) {
          return send(res, 429, { error: 'rate_limited' });
        }
        const refreshed = await refreshBranches(actorId);
        // 200 même sans réponse : le dashboard doit distinguer « pas d'updater
        // à l'écoute » d'un échec de la demande elle-même.
        return send(res, 200, {
          ok: refreshed.ok,
          branches: refreshed.branches,
          fetchedAt: refreshed.fetchedAt,
        });
      }
      if (parts.length !== 2) return send(res, 404, { error: 'not_found' });

      if (req.method === 'GET') {
        return send(res, 200, {
          branches: await listDeployBranches(),
          // Dire QUAND la liste a été récupérée : sinon on ne sait pas si on
          // regarde le dépôt d'aujourd'hui ou le repli du `.env`.
          fetchedAt: await branchesFetchedAt(),
          status: await readStatus(),
          result: await readResult(),
          // Le journal de la mise à jour EN COURS. Le résultat n'arrive qu'à la
          // fin : sans lui, le dashboard n'aurait qu'une phrase de phase à
          // afficher pendant une minute ou deux. `null` = rien en cours.
          runningLog: await readRunningLog(),
        });
      }
      if (req.method === 'POST') {
        // Déploiement hôte (rebuild/restart) : réservé au propriétaire du bot,
        // vérifié ICI et pas seulement via le bouton caché du dashboard.
        const actorId = getActorId(req);
        if (!actorId || !isOwner(actorId)) return send(res, 403, { error: 'forbidden' });
        if (!rateLimit('deploy', 3, 60_000)) return send(res, 429, { error: 'rate_limited' });
        const body = (await readJson(req)) as { branch?: unknown; mode?: unknown };
        const branch = typeof body.branch === 'string' ? body.branch.trim() : undefined;
        // Mode de reconstruction (voir `DeployMode`) : tout ce qui n'est pas
        // `cache` retombe sur le comportement historique, complet.
        const mode = toDeployMode(body.mode);
        // Une branche fraîchement poussée n'est dans aucune liste : on accepte
        // la saisie libre, et on ne valide que ce qui protège vraiment — le
        // nom lui-même, qu'un tiret initial transformerait en option git.
        // L'updater refait cette validation avant de toucher au dépôt.
        if (branch && !isValidBranchName(branch)) {
          return send(res, 400, { error: 'invalid_branch' });
        }
        const requestedAt = await requestDeploy(actorId, undefined, branch, mode);
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
