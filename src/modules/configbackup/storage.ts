import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { env } from '../../core/env.js';

/**
 * Dépôt local des sauvegardes : un sous-dossier par serveur, un fichier par
 * exécution. Les fichiers sont compressés (gzip) — une sauvegarde complète est
 * du JSON très répétitif, qui perd environ 90 % de son poids, et une rétention
 * de plusieurs semaines tient alors dans quelques mégaoctets.
 */

/** Extension des fichiers de sauvegarde (compressés). */
export const BACKUP_EXT = '.json.gz';

/**
 * Noms de fichiers acceptés. Le dashboard passe ce nom en clair dans l'URL de
 * téléchargement : sans ce garde-fou, un `../../` y ferait lire n'importe quel
 * fichier du serveur.
 */
const SAFE_NAME = /^[A-Za-z0-9_-]+\.json\.gz$/;

/** Une sauvegarde présente sur le disque. */
export interface StoredBackup {
  name: string;
  /** Taille du fichier compressé, en octets. */
  size: number;
  /** Date d'écriture (ISO). */
  createdAt: string;
}

/** Dossier des sauvegardes d'un serveur. */
function guildDir(guildId: string): string {
  return join(resolve(env.BACKUP_DIR), guildId);
}

/** Le nom est-il un nom de fichier de sauvegarde légitime ? */
export function isSafeBackupName(name: string): boolean {
  return SAFE_NAME.test(name);
}

/** Horodatage compact et triable, base du nom de fichier. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Compresse un objet de sauvegarde en fichier prêt à écrire ou à envoyer. */
export function encodeBackup(backup: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(backup, null, 2), 'utf8'), { level: 9 });
}

/**
 * Lit le contenu d'un fichier de sauvegarde, compressé ou non.
 *
 * On accepte les deux formes : le fichier téléchargé depuis le dashboard est
 * compressé, mais un admin peut tout aussi bien réimporter un `.json` produit
 * par `/sauvegarde exporter` (ou édité à la main).
 */
export function decodeBackupFile(buffer: Buffer): string {
  // En-tête gzip (0x1f 0x8b) : le seul moyen fiable de distinguer les deux.
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return gunzipSync(buffer, { maxOutputLength: env.BACKUP_MAX_MB * 1024 * 1024 }).toString(
      'utf8',
    );
  }
  return buffer.toString('utf8');
}

/**
 * Écrit une sauvegarde déjà encodée sur le disque et renvoie son entrée.
 *
 * Le contenu est encodé par l'appelant (`encodeBackup`) parce qu'il en a besoin
 * de son côté — pour le joindre à un message Discord, par exemple : le
 * compresser deux fois serait payer deux fois le prix du plus gros travail.
 */
export async function writeBackup(guildId: string, payload: Buffer): Promise<StoredBackup> {
  const dir = guildDir(guildId);
  await mkdir(dir, { recursive: true });
  const name = `sauvegarde-${stamp(new Date())}${BACKUP_EXT}`;
  await writeFile(join(dir, name), payload);
  return { name, size: payload.length, createdAt: new Date().toISOString() };
}

/** Sauvegardes d'un serveur, de la plus récente à la plus ancienne. */
export async function listBackups(guildId: string): Promise<StoredBackup[]> {
  const dir = guildDir(guildId);
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: StoredBackup[] = [];
  for (const name of names) {
    if (!isSafeBackupName(name)) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    entries.push({ name, size: info.size, createdAt: info.mtime.toISOString() });
  }
  return entries.sort((a, b) => b.name.localeCompare(a.name));
}

/** Contenu brut (compressé) d'une sauvegarde ; `null` si le fichier n'existe pas. */
export async function readBackupFile(guildId: string, name: string): Promise<Buffer | null> {
  if (!isSafeBackupName(name)) return null;
  return readFile(join(guildDir(guildId), name)).catch(() => null);
}

/** Supprime une sauvegarde. */
export async function deleteBackupFile(guildId: string, name: string): Promise<boolean> {
  if (!isSafeBackupName(name)) return false;
  return rm(join(guildDir(guildId), name))
    .then(() => true)
    .catch(() => false);
}

/**
 * Ne conserve que les `keep` sauvegardes les plus récentes. Sans cela, une
 * sauvegarde quotidienne remplirait le disque du VPS en quelques mois.
 */
export async function pruneBackups(guildId: string, keep: number): Promise<number> {
  const entries = await listBackups(guildId);
  const excess = entries.slice(Math.max(0, keep));
  for (const entry of excess) await deleteBackupFile(guildId, entry.name);
  return excess.length;
}

/** Poids total des sauvegardes d'un serveur (octets). */
export async function backupsSize(guildId: string): Promise<number> {
  const entries = await listBackups(guildId);
  return entries.reduce((total, entry) => total + entry.size, 0);
}
