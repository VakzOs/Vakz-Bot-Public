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
  /**
   * Les champs structurés de la ligne, mis à plat (`task=deliver remis=3 ms=8`).
   *
   * Un log pino porte son sens dans ses champs, pas dans son message : `'Tâche
   * terminée'` et `'Commande exécutée'` sont les mêmes mots pour tous les
   * modules et tous les passages. Sans eux, le hublot affichait quarante fois
   * la même phrase sans jamais dire de quelle tâche, de quel serveur ni de
   * quelle commande il parlait — et la recherche ne pouvait pas trouver un nom
   * de tâche qu'elle n'avait pas.
   */
  details?: string;
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
 * Champs que le record porte déjà en propre, ou qui n'apprennent rien à un
 * lecteur du dashboard : ils ne repassent pas dans `details`.
 */
const PLAIN_FIELDS = new Set(['time', 'level', 'msg', 'err', 'scope', 'pid', 'hostname', 'v']);

/**
 * Longueur maximale de `details`.
 *
 * Le tampon garde cinq cents lignes en mémoire et l'archive les grave un mois :
 * un champ resté sans bornes (un tableau d'identifiants, un corps de réponse
 * HTTP…) les ferait grossir sans rien apprendre de plus. Deux cents caractères
 * tiennent les champs qu'on écrit vraiment.
 */
const DETAILS_MAX = 200;

/**
 * Une valeur de champ, rendue courte et lisible.
 *
 * Les espaces d'une chaîne sont ramenés à un seul : un champ multiligne (une
 * sortie de commande, un corps de réponse) casserait sinon la mise en page
 * d'une liste où chaque ligne de log tient sur une ligne.
 */
function detailValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Met à plat les champs structurés d'une ligne pino.
 *
 * On écrit `clé=valeur` plutôt que du JSON : c'est ce que le lecteur veut lire
 * d'un coup d'œil dans une liste, et ça se cherche au mot.
 */
function flattenDetails(raw: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  let length = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (PLAIN_FIELDS.has(key)) continue;
    const rendered = detailValue(value);
    if (rendered === null || rendered === '') continue;
    const part = `${key}=${rendered}`;
    // On s'arrête au premier champ qui déborde plutôt que de couper au milieu
    // d'une valeur : une ligne tronquée en `guildId=1234` mentirait.
    if (length + part.length + (parts.length > 0 ? 1 : 0) > DETAILS_MAX) break;
    length += part.length + (parts.length > 0 ? 1 : 0);
    parts.push(part);
  }
  return parts.length > 0 ? redact(parts.join(' ')) : undefined;
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

  // Une ligne relue depuis l'archive porte déjà son `details` tout fait : on le
  // reprend tel quel plutôt que de le remettre à plat une seconde fois, sinon
  // il reviendrait sous la forme `details=task=deliver remis=3`.
  const details = typeof raw.details === 'string' ? redact(raw.details) : flattenDetails(raw);

  return {
    time: typeof raw.time === 'number' ? raw.time : Date.now(),
    level: typeof raw.level === 'number' ? raw.level : 30,
    ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
    msg,
    ...(errMessage ? { err: errMessage } : {}),
    ...(details ? { details } : {}),
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
  /** Filtre plein texte, insensible à la casse, sur le module, le message, l'erreur et les champs. */
  search?: string;
}

/** Vrai si la ligne contient le texte cherché (module, message, erreur ou champs). */
export function matchesSearch(record: LogRecord, needle: string): boolean {
  return `${record.scope ?? ''} ${record.msg} ${record.err ?? ''} ${record.details ?? ''}`
    .toLowerCase()
    .includes(needle);
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
