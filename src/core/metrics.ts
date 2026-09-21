/**
 * Métriques d'instance : de quoi répondre à « est-ce que le bot va bien ? »
 * sans ouvrir un SSH sur le VPS.
 *
 * Deux natures de chiffres cohabitent ici, et les confondre rendrait le
 * dashboard illisible :
 *
 * - les **jauges**, lues à l'instant où on les demande (mémoire, latence de la
 *   passerelle, nombre de serveurs) ; elles se **moyennent** quand on regroupe
 *   plusieurs mesures ;
 * - les **compteurs**, qui disent ce qui s'est produit *pendant* un intervalle
 *   (commandes, erreurs, requêtes) ; eux s'**additionnent**.
 *
 * L'historique est écrit en base (`metrics-store.ts`) pour **survivre au
 * redémarrage** : un tampon mémoire répond à « qu'est-ce qui se passe ? », mais
 * jamais à « est-ce que la mémoire montait déjà avant le plantage d'hier
 * soir ? » — et c'est après coup qu'on se pose la question, une fois le process
 * reparti de zéro. `METRICS_RETENTION_DAYS=0` désactive cette écriture ; on
 * retombe alors sur le tampon mémoire d'une heure, et la réponse de l'API le
 * dit pour que le panneau ne promette pas un passé qu'il n'a pas.
 *
 * Ce module est importé par `logger.ts` : il ne doit donc **jamais** importer le
 * logger ni la base (`db.ts` crée son logger à l'initialisation — le cycle
 * tomberait sur une variable non encore initialisée). Tout ce qu'il ne peut pas
 * connaître seul — base, logger, registre des modules, planificateur — lui est
 * passé en argument par l'appelant, qui les a déjà sous la main.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import type { Client } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { env } from './env.js';
import { LOG_LEVEL_NAMES, levelBucket, type LogLevelName } from './log-buffer.js';
import {
  bumpCommands,
  compactSamples,
  COMPACT_AFTER_MS,
  insertSample,
  purgeSamples,
  readCommands,
  readSamples,
  storeInfo,
  type CommandDelta,
  type SampleRow,
  type StoredCommand,
} from './metrics-store.js';

/**
 * Pas d'échantillonnage.
 *
 * Quinze secondes : assez fin pour qu'un pic de mémoire ou une rafale de
 * commandes laisse une trace, assez large pour qu'une journée d'historique tienne
 * en quelques mégaoctets.
 */
export const SAMPLE_INTERVAL_MS = 15_000;

/**
 * Taille du tampon mémoire : 240 × 15 s = une heure.
 *
 * Il reste le filet quand la persistance est coupée (`METRICS_RETENTION_DAYS=0`)
 * ou que la base refuse d'écrire : mieux vaut une heure de courbes qu'un
 * panneau vide.
 */
export const MEMORY_CAPACITY = 240;

/** Fenêtre observée, par défaut la dernière heure. */
export const DEFAULT_WINDOW_MS = 3_600_000;

/** Fenêtre la plus courte qu'on accepte de tracer (quatre mesures). */
const MIN_WINDOW_MS = 60_000;

/**
 * Fenêtre la plus large qu'on accepte de lire.
 *
 * La rétention se règle par `METRICS_RETENTION_DAYS` et peut aller à un an ;
 * cette borne-ci protège la lecture, pas le stockage. Trois mois d'un coup, ce
 * sont déjà des dizaines de milliers de lignes pour mille pixels.
 */
const MAX_WINDOW_MS = 92 * 86_400_000;

/** Une période demandée : deux instants, en millisecondes. */
export interface MetricsWindowRequest {
  from: number;
  to: number;
}

/**
 * Lit la période demandée dans l'URL (`from`/`to`, en millisecondes).
 *
 * Le dashboard propose aussi bien des fenêtres glissantes (« les cinq dernières
 * minutes ») que des périodes fixes (« hier », « le mois »). Plutôt que d'ajouter
 * un mot-clé par cas — et de refaire un calendrier côté bot, dans un fuseau qui
 * n'est pas celui de l'administrateur —, l'API prend deux bornes et le panneau
 * calcule les siennes dans le fuseau du navigateur.
 *
 * Tout est borné : une demande absurde rend une fenêtre valide, jamais une
 * erreur ni une lecture sans fin.
 */
export function parseWindow(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
): MetricsWindowRequest {
  const now = Date.now();
  const parse = (raw: string | null | undefined): number | null => {
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  // Une minute d'avance tolérée : l'horloge du navigateur n'est pas celle du
  // VPS, et « jusqu'à maintenant » ne doit pas se transformer en fenêtre vide.
  const to = Math.min(parse(rawTo) ?? now, now + 60_000);
  const requested = parse(rawFrom) ?? to - DEFAULT_WINDOW_MS;
  const from = Math.max(Math.min(requested, to - MIN_WINDOW_MS), to - MAX_WINDOW_MS);
  return { from, to };
}

/**
 * Nombre de points rendus au maximum.
 *
 * Sept jours font 40 000 mesures : les envoyer toutes ne tracerait pas une
 * courbe plus juste, seulement une réponse de plusieurs mégaoctets pour un
 * graphique large de mille pixels. Au-delà, on regroupe.
 */
const MAX_POINTS = 240;

/** Un point rendu par l'API. Tout y est déjà agrégé sur son intervalle. */
export interface MetricsSample {
  /** Fin de l'intervalle, en millisecondes. */
  t: number;
  /** Mémoire résidente du process, en octets. */
  rss: number;
  /** Tas V8 utilisé, en octets. */
  heap: number;
  /** Part de CPU, en % d'un cœur (100 = un cœur plein). */
  cpu: number;
  /** Retard de la boucle d'évènements, en millisecondes. */
  lag: number;
  /** Latence de la passerelle Discord. `null` si aucune mesure sur l'intervalle. */
  ping: number | null;
  guilds: number;
  members: number;
  /** Slash commands exécutées pendant l'intervalle. */
  commands: number;
  /** Interactions reçues, toutes natures confondues. */
  interactions: number;
  /** Lignes de log `error`/`fatal` émises pendant l'intervalle. */
  errors: number;
  /** Lignes de log `warn` émises pendant l'intervalle. */
  warnings: number;
  /** Requêtes envoyées à l'API Discord pendant l'intervalle. */
  rest: number;
  /** Fois où Discord a imposé une limite de débit. */
  rateLimits: number;
}

/** Ce qu'on sait d'une commande, cumulé sur toute la vie de l'instance. */
export interface CommandMetric {
  name: string;
  module: string | null;
  count: number;
  /** Exécutions terminées par une erreur (l'utilisateur a vu le message générique). */
  errors: number;
  /** Durée moyenne d'exécution, en millisecondes. */
  avgMs: number;
  /** Dernière exécution, en millisecondes. `null` si jamais appelée. */
  lastAt: number | null;
}

/** Les compteurs d'une fenêtre : ce qui s'est produit pendant qu'on regardait. */
export interface MetricsTotals {
  commands: number;
  commandErrors: number;
  interactions: number;
  components: number;
  modals: number;
  autocomplete: number;
  restRequests: number;
  rateLimits: number;
  /** Lignes de log émises sur la fenêtre, par niveau. */
  logs: Record<LogLevelName, number>;
}

/** La photographie complète rendue par l'API. */
export interface MetricsSnapshot {
  /** Horodatage de la lecture : le dashboard s'en sert comme origine de ses axes. */
  now: number;
  /** Démarrage du process courant, en millisecondes. */
  startedAt: number;
  sampleIntervalMs: number;
  /** La fenêtre effectivement rendue. */
  window: {
    from: number;
    to: number;
    /** Durée couverte par un point rendu : `sampleIntervalMs` ou un multiple. */
    bucketMs: number;
    /** Nombre de mesures brutes agrégées. */
    samples: number;
    /**
     * Vrai quand la fenêtre dépassait ce qu'une réponse peut porter : le début
     * de la période manque, et le panneau doit le dire plutôt que de laisser
     * croire à un bot qui n'aurait pas tourné.
     */
    truncated: boolean;
  };
  /** Ce que la base garde réellement — le panneau ne promet jamais plus. */
  persistence: {
    /** Faux quand `METRICS_RETENTION_DAYS=0` : historique mémoire seul. */
    enabled: boolean;
    retentionDays: number;
    /** Échantillons stockés, toutes fenêtres confondues. */
    stored: number;
    /** Plus ancienne mesure disponible, en millisecondes. */
    oldest: number | null;
  };
  process: {
    uptimeSeconds: number;
    pid: number;
    node: string;
    platform: string;
    arch: string;
    /** Version déclarée dans `package.json`, quand elle est lisible. */
    version: string | null;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    /**
     * Plafond du tas fixé par V8 (`--max-old-space-size`).
     *
     * C'est la seule référence qui fasse d'un pourcentage de tas une alerte :
     * `heapTotal` n'est que la réserve du moment, que V8 agrandit à la demande,
     * et s'en servir comme dénominateur afficherait 95 % sur un bot parfaitement
     * sain.
     */
    heapLimit: number;
    external: number;
    arrayBuffers: number;
    /** Part de CPU du dernier intervalle, en % d'un cœur. */
    cpuPercent: number;
    /** Retard moyen de la boucle d'évènements sur le dernier intervalle (ms). */
    eventLoopLagMs: number;
    /** Pire retard observé sur le dernier intervalle (ms). */
    eventLoopLagMaxMs: number;
  };
  system: {
    totalMem: number;
    freeMem: number;
    cpus: number;
    loadAvg: number[];
  };
  discord: {
    ready: boolean;
    /** Latence de la passerelle (ms), `null` avant le premier heartbeat. */
    ping: number | null;
    /** Durée de la connexion actuelle, en secondes. `null` si jamais connecté. */
    uptimeSeconds: number | null;
    guilds: number;
    members: number;
    channels: number;
    /** Statut de la connexion WebSocket (0 = prêt). */
    status: number;
  };
  /** Compteurs de la fenêtre demandée (et non « depuis le démarrage »). */
  totals: MetricsTotals;
  /** Commandes les plus appelées, cumul de toute la vie de l'instance. */
  commands: CommandMetric[];
  /** Tâches réellement enregistrées par le planificateur. */
  tasks: number;
  modules: {
    total: number;
    /** Modules configurables (non `internal`). */
    public: number;
    /** Slash commands enregistrées. */
    commands: number;
  };
  db: {
    /** Taille du fichier SQLite, en octets. `null` si illisible (autre SGBD, chemin inconnu). */
    bytes: number | null;
    /** Taille du journal WAL, en octets. `null` s'il n'existe pas. */
    walBytes: number | null;
  };
  /** L'historique, du plus ancien au plus récent. */
  history: MetricsSample[];
}

/** Une mesure brute, telle qu'elle est écrite en base et gardée en mémoire. */
type RawSample = Omit<SampleRow, 'at'> & { at: number };

const startedAt = Date.now();

/**
 * Compteurs de l'intervalle en cours, remis à zéro à chaque échantillon.
 *
 * Une courbe de débit se construit avec des deltas : dériver des cumuls côté
 * dashboard donnerait les mêmes courbes, mais fausses dès qu'un point manque.
 */
const pending = {
  commands: 0,
  commandFails: 0,
  interactions: 0,
  components: 0,
  modals: 0,
  autocomplete: 0,
  rest: 0,
  rateLimits: 0,
};

const pendingLogs: Record<LogLevelName, number> = {
  trace: 0,
  debug: 0,
  info: 0,
  warn: 0,
  error: 0,
  fatal: 0,
};

/**
 * Ce que les commandes ont fait depuis le dernier versement en base.
 *
 * Quand la persistance est coupée, rien ne le vide : la carte devient alors le
 * cumul depuis le démarrage, ce qui est tout ce qu'on peut offrir sans base.
 */
const pendingCommands = new Map<string, CommandDelta>();

const memory: RawSample[] = [];

let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();
let lastCpuPercent = 0;
let lastLagMs = 0;
let lastLagMaxMs = 0;
let lastMaintenanceAt = 0;

let loopDelay: IntervalHistogram | null = null;
let timer: NodeJS.Timeout | null = null;
let clientRef: Client | null = null;
let dbRef: PrismaClient | null = null;
let logRef: Logger | null = null;

/** La persistance est-elle armée ? (base disponible ET rétention non nulle) */
function persisting(): boolean {
  return dbRef !== null && env.METRICS_RETENTION_DAYS > 0;
}

/**
 * Range une ligne de log dans les compteurs.
 *
 * Appelé par le logger pour **chaque** ligne, y compris celles que `LOG_LEVEL`
 * n'affiche pas : c'est le même flux qui alimente le tampon du dashboard, et une
 * erreur reste une erreur même quand personne ne la lit.
 */
export function recordLog(level: number): void {
  pendingLogs[levelBucket(level)] += 1;
}

/** Nature d'interaction comptée séparément : ce ne sont pas les mêmes coûts. */
export type InteractionKind = 'command' | 'component' | 'modal' | 'autocomplete';

/** Compte une interaction reçue, avant même de savoir si elle aboutira. */
export function recordInteraction(kind: InteractionKind): void {
  pending.interactions += 1;
  if (kind === 'component') pending.components += 1;
  else if (kind === 'modal') pending.modals += 1;
  else if (kind === 'autocomplete') pending.autocomplete += 1;
}

/**
 * Compte une slash command **terminée**, avec sa durée et son issue.
 *
 * On mesure à la fin plutôt qu'au départ : une commande qui part sans revenir
 * est précisément ce qu'on cherche, et elle ne se voit que dans l'écart entre
 * les interactions reçues et les commandes achevées.
 */
export function recordCommand(
  name: string,
  module: string | null,
  durationMs: number,
  ok: boolean,
): void {
  pending.commands += 1;
  if (!ok) pending.commandFails += 1;

  const delta = pendingCommands.get(name) ?? {
    module,
    count: 0,
    errors: 0,
    totalMs: 0,
    lastAt: new Date(),
  };
  delta.count += 1;
  if (!ok) delta.errors += 1;
  delta.totalMs += Math.max(0, durationMs);
  delta.lastAt = new Date();
  if (module) delta.module = module;
  pendingCommands.set(name, delta);
}

/** Somme des membres des serveurs connus (0 si le client n'est pas prêt). */
function memberCount(client: Client | null): number {
  if (!client) return 0;
  let total = 0;
  for (const guild of client.guilds.cache.values()) total += guild.memberCount;
  return total;
}

/** Latence de la passerelle, ou `null` tant qu'aucun heartbeat n'est revenu. */
function gatewayPing(client: Client | null): number | null {
  const ping = client?.ws.ping;
  return typeof ping === 'number' && ping >= 0 ? Math.round(ping) : null;
}

/** Résolution de l'histogramme de la boucle d'évènements, en millisecondes. */
const LOOP_RESOLUTION_MS = 10;

/** Retard réel (au-delà de la résolution), en millisecondes, jamais négatif. */
function excessLag(nanoseconds: number): number {
  if (!Number.isFinite(nanoseconds)) return 0;
  const ms = nanoseconds / 1e6 - LOOP_RESOLUTION_MS;
  return Math.max(0, Math.round(ms * 100) / 100);
}

/** Prend un échantillon et referme l'intervalle en cours. */
function sample(): void {
  const now = Date.now();
  const memoryUsage = process.memoryUsage();

  // % d'un cœur : le temps CPU consommé rapporté au temps écoulé. Une valeur
  // au-dessus de 100 est normale sur plusieurs cœurs — elle dit « plus d'un
  // cœur ».
  const cpu = process.cpuUsage(lastCpu);
  const elapsedMs = Math.max(1, now - lastCpuAt);
  lastCpuPercent = Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100);
  lastCpu = process.cpuUsage();
  lastCpuAt = now;

  if (loopDelay) {
    // L'histogramme mesure l'intervalle réel entre deux réveils : à vide il vaut
    // déjà la résolution. On la retranche pour que la courbe parte de zéro —
    // sans quoi un bot parfaitement calme afficherait dix millisecondes de
    // retard permanent, et on ne saurait plus lire les vraies.
    lastLagMs = excessLag(loopDelay.mean);
    lastLagMaxMs = excessLag(loopDelay.max);
    loopDelay.reset();
  }

  const row: RawSample = {
    at: now,
    // Mesure fraîche : elle ne fond rien d'autre qu'elle-même. La compaction
    // fera grossir ce poids quand elle passera, au-delà de 24 heures.
    span: 1,
    rss: memoryUsage.rss,
    heap: memoryUsage.heapUsed,
    cpu: lastCpuPercent,
    lag: lastLagMs,
    ping: gatewayPing(clientRef),
    guilds: clientRef?.guilds.cache.size ?? 0,
    members: memberCount(clientRef),
    commands: pending.commands,
    commandFails: pending.commandFails,
    interactions: pending.interactions,
    components: pending.components,
    modals: pending.modals,
    autocomplete: pending.autocomplete,
    rest: pending.rest,
    rateLimits: pending.rateLimits,
    logTrace: pendingLogs.trace,
    logDebug: pendingLogs.debug,
    logInfo: pendingLogs.info,
    logWarn: pendingLogs.warn,
    logError: pendingLogs.error,
    logFatal: pendingLogs.fatal,
  };

  // Le tampon mémoire est alimenté dans tous les cas : il sert de filet quand la
  // base refuse d'écrire, et couvre l'heure en cours sans aucune lecture.
  memory.push(row);
  if (memory.length > MEMORY_CAPACITY) {
    memory.splice(0, memory.length - MEMORY_CAPACITY);
  }

  for (const key of Object.keys(pending) as (keyof typeof pending)[]) pending[key] = 0;
  for (const level of LOG_LEVEL_NAMES) pendingLogs[level] = 0;

  if (persisting()) void flush(row);
}

/**
 * Verse en base l'échantillon et les commandes de l'intervalle.
 *
 * Aucune erreur ne remonte : une mesure perdue laisse un trou dans une courbe,
 * elle ne doit jamais faire tomber le bot. On le consigne tout de même — un
 * historique qui ne s'écrit plus doit se voir dans les logs, pas seulement dans
 * un graphique qui s'arrête.
 */
async function flush(row: RawSample): Promise<void> {
  const db = dbRef;
  if (!db) return;

  // Les deltas sont retirés de la carte AVANT l'écriture : un versement qui
  // échoue perd un intervalle, alors qu'une carte non vidée compterait deux fois
  // les mêmes appels au versement suivant.
  const deltas = new Map(pendingCommands);
  pendingCommands.clear();

  try {
    const { at, ...rest } = row;
    await insertSample(db, { at: new Date(at), ...rest });
    if (deltas.size > 0) await bumpCommands(db, deltas);

    // Entretien espacé : la rétention se compte en jours, la vérifier toutes les
    // quinze secondes ne ferait que des requêtes pour rien.
    if (Date.now() - lastMaintenanceAt > 6 * 3_600_000) {
      lastMaintenanceAt = Date.now();
      const deleted = await purgeSamples(db, env.METRICS_RETENTION_DAYS);
      // Puis on fond ce qui a plus d'un jour : c'est ce qui rend un mois de
      // rétention tenable, en place comme en temps de lecture.
      const merged = await compactSamples(db, new Date(Date.now() - COMPACT_AFTER_MS));
      if (deleted > 0 || merged > 0) {
        logRef?.debug({ deleted, merged }, 'Monitoring : historique purgé et compacté');
      }
    }
  } catch (error) {
    logRef?.warn({ err: error }, "Monitoring : échantillon non écrit (l'historique aura un trou)");
  }
}

/** Ce que l'appelant fournit au démarrage : tout ce que ce module n'importe pas. */
export interface MetricsDeps {
  client: Client;
  db: PrismaClient;
  logger: Logger;
}

/**
 * Démarre la mesure : échantillonnage périodique et écoute du client REST.
 *
 * Le timer est `unref()` : un relevé de métriques n'a aucune raison de retenir
 * le process au moment de l'arrêt.
 */
export function startMetrics(deps: MetricsDeps): void {
  clientRef = deps.client;
  dbRef = deps.db;
  logRef = deps.logger.child({ scope: 'metrics' });

  if (!loopDelay) {
    // Le retard de la boucle d'évènements est LA métrique qui dit « le bot est
    // occupé » quand la mémoire et le CPU semblent calmes : une commande lente
    // ne consomme rien, elle attend — et tout le monde attend derrière.
    loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
    loopDelay.enable();
  }

  deps.client.rest.on('response', () => {
    pending.rest += 1;
  });
  deps.client.rest.on('rateLimited', () => {
    pending.rateLimits += 1;
  });

  if (timer) return;
  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logRef.info(
    {
      intervalSeconds: SAMPLE_INTERVAL_MS / 1000,
      retentionDays: env.METRICS_RETENTION_DAYS,
      persisted: persisting(),
    },
    persisting()
      ? 'Monitoring démarré (historique persistant)'
      : 'Monitoring démarré (historique en mémoire, perdu au redémarrage)',
  );
}

/** Arrête l'échantillonnage (arrêt propre du bot). */
export function stopMetrics(): void {
  if (timer) clearInterval(timer);
  timer = null;
  loopDelay?.disable();
  loopDelay = null;
}

/**
 * Verse ce qui n'a pas encore été écrit. Appelé à l'arrêt du bot.
 *
 * Sans lui, les quelques secondes qui précèdent un redémarrage programmé
 * seraient perdues — les dernières avant une coupure, c'est-à-dire souvent les
 * plus intéressantes.
 */
export async function flushMetrics(): Promise<void> {
  if (!persisting()) return;
  const hasPending = pendingCommands.size > 0 || Object.values(pending).some((value) => value > 0);
  if (!hasPending) return;
  sample();
  // `sample()` délègue l'écriture à une promesse non attendue : on laisse un
  // tour de boucle pour qu'elle parte avant que le process ne ferme la base.
  await new Promise((done) => setTimeout(done, 50));
}

/** Chemin du fichier SQLite déduit de `DATABASE_URL`, quand c'en est un. */
function databaseFile(): string | null {
  const url = env.DATABASE_URL;
  if (!url.startsWith('file:')) return null;
  const raw = url.slice('file:'.length).split('?')[0];
  if (!raw) return null;
  // Prisma résout un chemin relatif depuis le dossier du schéma, pas depuis le
  // cwd : le reproduire évite d'annoncer « base introuvable » en développement.
  return isAbsolute(raw) ? raw : resolve(join(process.cwd(), 'prisma'), raw);
}

/** Taille d'un fichier, ou `null` s'il n'existe pas / n'est pas lisible. */
function sizeOf(path: string | null): number | null {
  if (!path) return null;
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/** Version déclarée dans `package.json`, lue une seule fois. */
let cachedVersion: string | null | undefined;
function botVersion(): string | null {
  if (cachedVersion !== undefined) return cachedVersion;
  cachedVersion = null;
  try {
    // `src/core/metrics.ts` et `dist/core/metrics.js` sont à la même profondeur :
    // le même chemin relatif marche en développement comme en production.
    const parsed: unknown = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    const version = (parsed as { version?: unknown } | null)?.version;
    if (typeof version === 'string') cachedVersion = version;
  } catch {
    // Une version illisible n'est pas une panne : le dashboard affichera « — ».
    cachedVersion = null;
  }
  return cachedVersion;
}

/** Additionne les compteurs d'une série de mesures brutes. */
function sumTotals(rows: RawSample[]): MetricsTotals {
  const totals: MetricsTotals = {
    commands: 0,
    commandErrors: 0,
    interactions: 0,
    components: 0,
    modals: 0,
    autocomplete: 0,
    restRequests: 0,
    rateLimits: 0,
    logs: { trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 },
  };
  for (const row of rows) {
    totals.commands += row.commands;
    totals.commandErrors += row.commandFails;
    totals.interactions += row.interactions;
    totals.components += row.components;
    totals.modals += row.modals;
    totals.autocomplete += row.autocomplete;
    totals.restRequests += row.rest;
    totals.rateLimits += row.rateLimits;
    totals.logs.trace += row.logTrace;
    totals.logs.debug += row.logDebug;
    totals.logs.info += row.logInfo;
    totals.logs.warn += row.logWarn;
    totals.logs.error += row.logError;
    totals.logs.fatal += row.logFatal;
  }
  return totals;
}

/**
 * Regroupe les mesures en au plus `MAX_POINTS` points, **découpés sur le temps**.
 *
 * Découper sur le nombre de lignes serait plus court à écrire et faux à lire :
 * les mesures n'ont pas toutes le même pas (15 secondes pour la journée écoulée,
 * cinq minutes au-delà, rien du tout pendant que le bot était arrêté), et une
 * grille comptée en lignes étirerait la dernière heure sur la moitié du
 * graphique. Une grille de temps garde l'axe honnête — et laisse un **trou** là
 * où le bot ne tournait pas, au lieu de relier les deux bords comme si de rien
 * n'était.
 *
 * Les jauges se **moyennent**, pondérées par le nombre de mesures que chaque
 * ligne représente ; les compteurs s'**additionnent**. Moyenner des commandes
 * donnerait une courbe qui s'aplatit quand on élargit la fenêtre, et sommer une
 * latence n'aurait aucun sens. La latence absente est ignorée dans la moyenne
 * plutôt que comptée pour zéro : une mesure manquante n'est pas une latence
 * nulle.
 */
function bucketize(
  rows: RawSample[],
  from: number,
  to: number,
): { history: MetricsSample[]; bucketMs: number } {
  if (rows.length === 0) return { history: [], bucketMs: SAMPLE_INTERVAL_MS };

  // Le pas rendu est un multiple entier du pas d'échantillonnage : « un point =
  // 1 min 15 s » se lit mal, « 1 min 30 s » (six mesures) se lit.
  const span = Math.max(SAMPLE_INTERVAL_MS, to - from);
  const bucketMs =
    Math.max(1, Math.ceil(span / MAX_POINTS / SAMPLE_INTERVAL_MS)) * SAMPLE_INTERVAL_MS;

  const groups = new Map<number, RawSample[]>();
  for (const row of rows) {
    const key = Math.floor((row.at - from) / bucketMs);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const history: MetricsSample[] = [];
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const slice = groups.get(key) ?? [];
    if (slice.length === 0) continue;
    const weight = slice.reduce((total, row) => total + row.span, 0) || slice.length;
    const pings = slice.filter((row) => row.ping !== null);
    const mean = (pick: (row: RawSample) => number): number =>
      slice.reduce((total, row) => total + pick(row) * row.span, 0) / weight;
    const sum = (pick: (row: RawSample) => number): number =>
      slice.reduce((total, row) => total + pick(row), 0);

    history.push({
      t: slice[slice.length - 1]?.at ?? from + (key + 1) * bucketMs,
      rss: Math.round(mean((row) => row.rss)),
      heap: Math.round(mean((row) => row.heap)),
      cpu: Math.round(mean((row) => row.cpu)),
      lag: Math.round(mean((row) => row.lag) * 100) / 100,
      ping:
        pings.length > 0
          ? Math.round(
              pings.reduce((total, row) => total + (row.ping ?? 0) * row.span, 0) /
                pings.reduce((total, row) => total + row.span, 0),
            )
          : null,
      guilds: Math.round(mean((row) => row.guilds)),
      members: Math.round(mean((row) => row.members)),
      commands: sum((row) => row.commands),
      interactions: sum((row) => row.interactions),
      errors: sum((row) => row.logError + row.logFatal),
      warnings: sum((row) => row.logWarn),
      rest: sum((row) => row.rest),
      rateLimits: sum((row) => row.rateLimits),
    });
  }

  return { history, bucketMs };
}

/** Fusionne le cumul lu en base et ce qui n'a pas encore été versé. */
function mergeCommands(
  stored: StoredCommand[],
  deltas: Map<string, CommandDelta>,
): CommandMetric[] {
  const merged = new Map<
    string,
    { module: string | null; count: number; errors: number; totalMs: number; lastAt: number | null }
  >();

  for (const row of stored) {
    merged.set(row.name, {
      module: row.module,
      count: row.count,
      errors: row.errors,
      totalMs: row.totalMs,
      lastAt: row.lastAt ? row.lastAt.getTime() : null,
    });
  }
  for (const [name, delta] of deltas) {
    const current = merged.get(name) ?? {
      module: delta.module,
      count: 0,
      errors: 0,
      totalMs: 0,
      lastAt: null,
    };
    current.count += delta.count;
    current.errors += delta.errors;
    current.totalMs += delta.totalMs;
    current.lastAt = delta.lastAt.getTime();
    if (delta.module) current.module = delta.module;
    merged.set(name, current);
  }

  return [...merged.entries()]
    .map(([name, stat]) => ({
      name,
      module: stat.module,
      count: stat.count,
      errors: stat.errors,
      avgMs: stat.count > 0 ? Math.round(stat.totalMs / stat.count) : 0,
      lastAt: stat.lastAt,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Ce que l'appelant sait et que ce module ignore volontairement. */
export interface MetricsContext {
  client: Client;
  db: PrismaClient;
  /** Nombre de tâches réellement enregistrées par le planificateur. */
  tasks: number;
  modules: { total: number; public: number; commands: number };
  /** Période demandée. Par défaut la dernière heure. */
  window?: MetricsWindowRequest;
}

/**
 * La photographie complète : jauges de l'instant, historique de la fenêtre.
 *
 * La lecture passe par la base quand la persistance est active — c'est elle qui
 * porte le passé d'avant le dernier redémarrage — et retombe sur le tampon
 * mémoire sinon, ou quand la base ne répond pas. `persistence` dit toujours
 * lequel des deux a répondu, pour que le panneau n'annonce pas sept jours
 * d'historique quand il n'en a qu'une heure.
 */
export async function metricsSnapshot(context: MetricsContext): Promise<MetricsSnapshot> {
  const client = context.client;
  const now = Date.now();
  const { from, to } = context.window ?? { from: now - DEFAULT_WINDOW_MS, to: now };
  const memoryRows = memory.filter((row) => row.at >= from && row.at <= to);

  let rows = memoryRows;
  let stored: StoredCommand[] = [];
  let info = { samples: 0, oldest: memoryRows[0]?.at ?? null };
  let enabled = persisting();
  let truncated = false;

  if (enabled) {
    try {
      const [samples, commands, store] = await Promise.all([
        readSamples(context.db, new Date(from), new Date(to)),
        readCommands(context.db),
        storeInfo(context.db),
      ]);
      rows = samples.rows.map(({ at, ...rest }) => ({ at: at.getTime(), ...rest }));
      truncated = samples.truncated;
      stored = commands;
      info = store;
    } catch (error) {
      // Une base muette ne doit pas rendre le panneau muet : on sert l'heure
      // qu'on a en mémoire, et on annonce l'historique comme non persistant
      // plutôt que de promettre une semaine qu'on ne sait pas lire.
      logRef?.warn({ err: error }, 'Monitoring : historique illisible, repli sur la mémoire');
      rows = memoryRows;
      enabled = false;
      info = { samples: memoryRows.length, oldest: memoryRows[0]?.at ?? null };
    }
  }

  const { history, bucketMs } = bucketize(rows, from, to);
  const memoryStats = process.memoryUsage();
  const file = databaseFile();

  return {
    now,
    startedAt,
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    window: { from, to, bucketMs, samples: rows.length, truncated },
    persistence: {
      enabled,
      retentionDays: enabled ? env.METRICS_RETENTION_DAYS : 0,
      stored: info.samples,
      oldest: info.oldest,
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      version: botVersion(),
      rss: memoryStats.rss,
      heapUsed: memoryStats.heapUsed,
      heapTotal: memoryStats.heapTotal,
      heapLimit: getHeapStatistics().heap_size_limit,
      external: memoryStats.external,
      arrayBuffers: memoryStats.arrayBuffers,
      cpuPercent: lastCpuPercent,
      eventLoopLagMs: lastLagMs,
      eventLoopLagMaxMs: lastLagMaxMs,
    },
    system: {
      totalMem: totalmem(),
      freeMem: freemem(),
      cpus: cpus().length,
      loadAvg: loadavg().map((value) => Math.round(value * 100) / 100),
    },
    discord: {
      ready: client.isReady(),
      ping: gatewayPing(client),
      uptimeSeconds: client.uptime === null ? null : Math.round(client.uptime / 1000),
      guilds: client.guilds.cache.size,
      members: memberCount(client),
      channels: client.channels.cache.size,
      status: client.ws.status,
    },
    totals: sumTotals(rows),
    commands: mergeCommands(stored, pendingCommands),
    tasks: context.tasks,
    modules: context.modules,
    db: {
      bytes: sizeOf(file),
      walBytes: sizeOf(file ? `${file}-wal` : null),
    },
    history,
  };
}

/** Les niveaux de log, dans l'ordre, pour l'appelant qui veut les parcourir. */
export const METRIC_LOG_LEVELS = LOG_LEVEL_NAMES;
