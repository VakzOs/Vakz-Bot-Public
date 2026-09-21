/**
 * Archive des logs sur disque : un fichier JSONL par jour.
 *
 * Le tampon circulaire (`log-buffer.ts`) est un hublot sur l'instant — quelques
 * centaines de lignes, perdues au redémarrage. Il répond à « qu'est-ce qui vient
 * de se passer ? », jamais à « que s'est-il passé mardi ? ». L'archive comble ce
 * trou sans devenir une usine : des fichiers texte, un par jour, purgés au-delà
 * d'une rétention configurable.
 *
 * **Le format, une ligne = un JSON** (`LogRecord`), se lit avec `cat`, `grep` et
 * `jq` sur le VPS aussi bien que par l'API. Le dossier vit dans le volume
 * persistant (`./data` monté sur `/app/data`) : l'archive survit donc aux
 * redémarrages et aux reconstructions d'image.
 *
 * **Une archive en défaut ne doit jamais faire tomber le bot** : toute erreur
 * d'écriture désarme l'archivage pour la session et laisse les logs continuer
 * leur route vers stdout et le tampon.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { env } from './env.js';
import {
  levelBucket,
  parseLogRecord,
  LOG_LEVEL_VALUES,
  type LogLevelName,
  type LogRecord,
} from './log-buffer.js';

/** Nom du fichier d'un jour donné. Le `.jsonl` dit le format : un JSON par ligne. */
function fileNameFor(day: string): string {
  return `${day}.jsonl`;
}

/** `YYYY-MM-DD` d'un horodatage, dans le fuseau du bot (`TZ`). */
export function dayKey(time: number = Date.now()): string {
  // `sv-SE` rend précisément `YYYY-MM-DD`, et `timeZone` cale la coupure de
  // journée sur le fuseau du bot : un log de 23 h 50 à Paris appartient au jour
  // parisien, pas à celui d'UTC.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: env.TZ }).format(new Date(time));
}

/** Vrai si la chaîne a bien la forme `YYYY-MM-DD` et désigne une date réelle. */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const directory = env.LOG_ARCHIVE_DIR;
const retentionDays = env.LOG_RETENTION_DAYS;
/**
 * Plancher d'archivage. Il s'ajoute à `LOG_LEVEL` : le tampon et stdout voient
 * tout ce que le logger laisse passer, l'archive seulement ce qui mérite d'être
 * gravé un mois durant.
 */
const archiveFloor = LOG_LEVEL_VALUES[env.LOG_ARCHIVE_LEVEL];

/** Archivage désarmé : soit par configuration, soit après une erreur d'écriture. */
let disabled = retentionDays <= 0;
/** Flux du jour en cours. `null` tant qu'aucune ligne n'a été écrite aujourd'hui. */
let stream: WriteStream | null = null;
/** Jour couvert par `stream`, pour détecter le passage à minuit. */
let streamDay = '';

/** Désarme l'archivage pour la session. On ne relance pas : on ne veut pas boucler. */
function disable(reason: unknown): void {
  disabled = true;
  stream = null;
  // Pas de `logger` ici : il dépend de ce module. stderr suffit, et la ligne
  // part quand même dans les logs du conteneur.
  process.stderr.write(`[log-archive] archivage désactivé : ${String(reason)}\n`);
}

/**
 * Supprime les fichiers au-delà de la rétention.
 *
 * On compare des noms de fichiers, pas des dates de modification : le nom EST la
 * date couverte, et il ne bouge pas si le fichier est recopié ou restauré.
 */
export function purgeArchive(now: number = Date.now()): void {
  if (disabled || !existsSync(directory)) return;
  const cutoff = dayKey(now - retentionDays * 86_400_000);
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.jsonl')) continue;
    const day = name.slice(0, -'.jsonl'.length);
    if (!isDayKey(day) || day >= cutoff) continue;
    try {
      unlinkSync(join(directory, name));
    } catch {
      // Un fichier qu'on n'arrive pas à supprimer n'est pas une raison d'arrêter
      // la purge des autres.
    }
  }
}

/** Prépare le dossier et purge les fichiers périmés. Appelé une fois au démarrage. */
export function startArchive(): void {
  if (disabled) return;
  try {
    mkdirSync(directory, { recursive: true });
    purgeArchive();
  } catch (error) {
    disable(error);
  }
}

/** Flux du jour, ouvert à la demande et renouvelé au passage de minuit. */
function streamForToday(): WriteStream | null {
  const today = dayKey();
  if (stream && streamDay === today) return stream;

  // Changement de jour : on ferme proprement le flux de la veille et on en
  // profite pour purger — le bot tourne en continu, il n'y a pas d'autre moment
  // naturel où la rétention se vérifie.
  if (stream) {
    stream.end();
    stream = null;
    purgeArchive();
  }

  try {
    mkdirSync(directory, { recursive: true });
    const next = createWriteStream(join(directory, fileNameFor(today)), { flags: 'a' });
    next.on('error', (error) => {
      disable(error);
    });
    stream = next;
    streamDay = today;
    return next;
  } catch (error) {
    disable(error);
    return null;
  }
}

/** Range une ligne déjà normalisée dans le fichier du jour. */
export function appendRecord(record: LogRecord): void {
  if (disabled || record.level < archiveFloor) return;
  try {
    streamForToday()?.write(`${JSON.stringify(record)}\n`);
  } catch (error) {
    disable(error);
  }
}

/** Les jours effectivement archivés, du plus récent au plus ancien. */
export function archiveDays(): string[] {
  if (disabled || !existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .filter(isDayKey)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Ce que l'API annonce au dashboard : ce qui existe vraiment, pas ce qui est promis. */
export interface ArchiveInfo {
  enabled: boolean;
  /** Nombre de jours gardés. 0 quand l'archivage est désactivé. */
  retentionDays: number;
  /** Niveau plancher de l'archive (`info` par défaut). */
  minLevel: LogLevelName;
  /** Jours disponibles (`YYYY-MM-DD`), du plus récent au plus ancien. */
  days: string[];
  /**
   * Taille totale de l'archive, en octets.
   *
   * On mesure au lieu d'estimer : « combien ça prend » est une question à
   * laquelle seule l'instance peut répondre, son volume de logs dépendant de
   * ses modules actifs et de son trafic.
   */
  bytes: number;
}

/** Taille d'un fichier, ou 0 s'il a disparu entre le listing et la mesure. */
function sizeOf(day: string): number {
  try {
    return statSync(join(directory, fileNameFor(day))).size;
  } catch {
    return 0;
  }
}

export function archiveInfo(): ArchiveInfo {
  const days = archiveDays();
  return {
    enabled: !disabled,
    retentionDays: disabled ? 0 : retentionDays,
    minLevel: env.LOG_ARCHIVE_LEVEL,
    days,
    bytes: days.reduce((total, day) => total + sizeOf(day), 0),
  };
}

export interface ArchiveQuery {
  /** Jour à lire (`YYYY-MM-DD`). */
  day: string;
  /** Niveaux retenus. Vide ou absent = tous. */
  levels?: LogLevelName[];
  /** Filtre plein texte, insensible à la casse, sur le message et l'erreur. */
  search?: string;
  limit?: number;
}

/**
 * Les lignes archivées d'un jour, de la plus récente à la plus ancienne.
 *
 * Le fichier est lu en entier puis filtré : un jour de logs pèse quelques
 * mégaoctets au pire, et un lecteur incrémental coûterait plus de complexité
 * qu'il ne ferait gagner. Une ligne illisible est ignorée — un fichier tronqué
 * par un arrêt brutal reste exploitable jusqu'à sa dernière ligne valide.
 */
export async function readArchive(query: ArchiveQuery): Promise<LogRecord[]> {
  if (disabled || !isDayKey(query.day)) return [];
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
  const levels = query.levels?.length ? new Set(query.levels) : null;
  const needle = query.search?.trim().toLowerCase();

  let content: string;
  try {
    content = await readFile(join(directory, fileNameFor(query.day)), 'utf8');
  } catch {
    // Jour sans fichier : pas d'activité, ou hors rétention. Une liste vide dit
    // la même chose et évite au dashboard un cas d'erreur de plus.
    return [];
  }

  const lines = content.split('\n');
  const kept: LogRecord[] = [];
  for (let index = lines.length - 1; index >= 0 && kept.length < limit; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    const record = parseLogRecord(line);
    if (!record) continue;
    if (levels && !levels.has(levelBucket(record.level))) continue;
    if (needle) {
      const haystack = `${record.msg} ${record.err ?? ''} ${record.scope ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    kept.push(record);
  }
  return kept;
}
