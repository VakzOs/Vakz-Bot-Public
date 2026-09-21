/**
 * Tampon circulaire des derniers logs, pour l'onglet Réglages du dashboard.
 *
 * Le bot tourne dans un conteneur : lire ses logs demande un accès SSH au VPS,
 * ce qui est beaucoup pour la question qu'on se pose neuf fois sur dix (« est-ce
 * que l'import a fini ? », « pourquoi cette commande a échoué ? »). Ce tampon
 * garde les dernières lignes en mémoire pour les rendre par l'API.
 *
 * **En mémoire, et c'est délibéré** : le tampon répond à « qu'est-ce qui vient
 * de se passer ? ». Pour « que s'est-il passé mardi ? », c'est l'archive sur
 * disque (`log-archive.ts`) qui prend le relais ; les deux rendent le même
 * `LogRecord`, si bien que le dashboard affiche l'une comme l'autre.
 */

/** Une ligne de log, telle qu'elle est rendue par l'API. */
export interface LogRecord {
  /** Horodatage en millisecondes. */
  time: number;
  /** Niveau pino : 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal. */
  level: number;
  /** Module émetteur (`createLogger('gacha')`), s'il y en a un. */
  scope?: string;
  msg: string;
  /** Message de l'erreur attachée, quand la ligne en porte une. */
  err?: string;
}

/**
 * Les six niveaux pino, nommés.
 *
 * Le dashboard coche des niveaux, il ne règle pas un seuil : « alertes ET
 * erreurs, sans le bruit d'info » est la question qu'on se pose vraiment, et un
 * seuil cumulatif (`level >= 40`) ne sait pas l'exprimer.
 */
export const LOG_LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevelName = (typeof LOG_LEVEL_NAMES)[number];

/** Seuil numérique de chaque niveau nommé. */
export const LOG_LEVEL_VALUES: Record<LogLevelName, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Le niveau nommé auquel appartient une valeur pino.
 *
 * On range par tranche plutôt que par égalité : pino accepte des niveaux
 * personnalisés (35, 45…) et une ligne à 45 doit se comporter comme une alerte,
 * pas disparaître de tous les filtres.
 */
export function levelBucket(level: number): LogLevelName {
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
}

/** Lit une liste de niveaux venue de l'API (`warn,error`). Rend `null` si aucun n'est valide. */
export function parseLevelNames(raw: string | null | undefined): LogLevelName[] | null {
  if (!raw) return null;
  const names = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is LogLevelName => (LOG_LEVEL_NAMES as readonly string[]).includes(part));
  return names.length > 0 ? [...new Set(names)] : null;
}

/**
 * Nombre de lignes gardées en mémoire.
 *
 * Cinq cents lignes tiennent dans quelques dizaines de kilo-octets et couvrent
 * largement « ce qui vient de se passer ». Au-delà, on ne lit plus : on cherche,
 * et chercher se fait sur l'archive, par date.
 */
export const LOG_BUFFER_CAPACITY = 500;

const records: LogRecord[] = [];

/**
 * Masque ce qui ressemble à un jeton Discord.
 *
 * Un tampon de logs exposé par HTTP est précisément l'endroit où un secret
 * échappé referait surface — et l'archive le graverait sur disque pour un mois.
 * Le motif — identifiant en base64, horodatage, signature — est assez
 * caractéristique pour être neutralisé sans risquer d'abîmer un message ordinaire.
 */
function redact(text: string): string {
  return text.replace(/[\w-]{20,}\.[\w-]{6}\.[\w-]{25,}/g, '[jeton masqué]');
}

/**
 * Normalise une ligne JSON émise par pino (ou relue depuis l'archive).
 *
 * Rend `null` pour une ligne illisible ou vide de sens : un fichier tronqué par
 * un arrêt brutal reste ainsi exploitable jusqu'à sa dernière ligne valide.
 */
export function parseLogRecord(line: string): LogRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const raw = parsed as Record<string, unknown>;
  const msg = typeof raw.msg === 'string' ? redact(raw.msg) : '';
  const error = raw.err;
  const errMessage =
    typeof error === 'string'
      ? redact(error)
      : error &&
          typeof error === 'object' &&
          typeof (error as { message?: unknown }).message === 'string'
        ? redact((error as { message: string }).message)
        : undefined;
  if (!msg && !errMessage) return null;

  return {
    time: typeof raw.time === 'number' ? raw.time : Date.now(),
    level: typeof raw.level === 'number' ? raw.level : 30,
    ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
    msg,
    ...(errMessage ? { err: errMessage } : {}),
  };
}

/** Range une ligne déjà normalisée dans le tampon. */
export function pushRecord(record: LogRecord): void {
  records.push(record);
  if (records.length > LOG_BUFFER_CAPACITY) {
    records.splice(0, records.length - LOG_BUFFER_CAPACITY);
  }
}

/** Range une ligne JSON émise par pino. Une ligne illisible est ignorée. */
export function pushLogLine(line: string): void {
  const record = parseLogRecord(line);
  if (record) pushRecord(record);
}

export interface RecentLogsOptions {
  limit?: number;
  /** Seuil cumulatif (`level >= minLevel`). Ignoré si `levels` est fourni. */
  minLevel?: number;
  /** Niveaux nommés retenus. Vide ou absent = tous. */
  levels?: LogLevelName[];
  /** Filtre plein texte, insensible à la casse, sur le module, le message et l'erreur. */
  search?: string;
}

/** Vrai si la ligne contient le texte cherché (module, message ou erreur). */
export function matchesSearch(record: LogRecord, needle: string): boolean {
  return `${record.scope ?? ''} ${record.msg} ${record.err ?? ''}`.toLowerCase().includes(needle);
}

/**
 * Les dernières lignes, de la plus récente à la plus ancienne — c'est l'ordre
 * dans lequel on les lit quand on vient voir ce qui se passe.
 */
export function recentLogs(options: RecentLogsOptions = {}): LogRecord[] {
  const minLevel = options.minLevel ?? 0;
  const levels = options.levels?.length ? new Set(options.levels) : null;
  const needle = options.search?.trim().toLowerCase();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), LOG_BUFFER_CAPACITY);
  const kept: LogRecord[] = [];
  for (let index = records.length - 1; index >= 0 && kept.length < limit; index -= 1) {
    const record = records[index];
    if (!record) continue;
    if (levels ? !levels.has(levelBucket(record.level)) : record.level < minLevel) continue;
    if (needle && !matchesSearch(record, needle)) continue;
    kept.push(record);
  }
  return kept;
}

/** Horodatage de la plus ancienne ligne encore en mémoire, si le tampon n'est pas vide. */
export function bufferOldest(): number | null {
  return records[0]?.time ?? null;
}

/** Nombre de lignes actuellement en mémoire. */
export function bufferSize(): number {
  return records.length;
}
