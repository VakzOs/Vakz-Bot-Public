import { PrismaClient } from '@prisma/client';
import { isProduction } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('db');

/**
 * Singleton PrismaClient.
 *
 * En développement (rechargement à chaud via `tsx watch`), on réutilise
 * l'instance attachée à `globalThis` pour éviter d'ouvrir une nouvelle
 * connexion à chaque rechargement.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = db;
}

/**
 * Règle les PRAGMA SQLite pour la concurrence, à appeler une fois au démarrage.
 *
 * - `journal_mode=WAL` : lectures et écriture peuvent coexister (persisté dans
 *   le fichier de base, donc actif pour toutes les connexions).
 * - `busy_timeout=5000` : plutôt que d'échouer immédiatement en `SQLITE_BUSY`
 *   quand un écrivain tient le verrou, on patiente jusqu'à 5 s.
 *
 * Best-effort : on n'interrompt pas le démarrage si le PRAGMA échoue (p. ex.
 * un autre SGBD). `PRAGMA journal_mode` renvoie une ligne → `$queryRawUnsafe`.
 */
export async function initDatabase(): Promise<void> {
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
    await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
    log.debug('PRAGMA SQLite appliqués (WAL, busy_timeout=5000)');
  } catch (error) {
    log.warn({ err: error }, 'PRAGMA SQLite (WAL/busy_timeout) non appliqués');
  }
}
