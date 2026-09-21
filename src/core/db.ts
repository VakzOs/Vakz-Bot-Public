import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { Prisma, PrismaClient } from '@prisma/client';
import { env, isProduction } from './env.js';
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

/**
 * Depuis Prisma 7, le client ne sait plus se connecter tout seul : le schéma ne
 * porte plus d'`url`, et le constructeur EXIGE un adaptateur — il refuse de
 * démarrer sans, au lancement et non à la compilation.
 *
 * `better-sqlite3` est un module natif, mais il publie ses binaires
 * précompilés : `npm ci` en télécharge un pour l'arm64 du VPS, rien ne se
 * compile dans l'image (vérifié pour Node 24, ABI v137).
 */
const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
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
  await warnAboutMissingTables();
}

/**
 * Dit au démarrage ce qu'une migration non appliquée coûtera plus tard.
 *
 * Le conteneur lance `prisma migrate deploy` avant le bot : en théorie la base
 * est toujours à jour. En pratique, une image reconstruite sans la migration,
 * une base restaurée d'ailleurs ou un `db push` passé à la main suffisent à
 * faire diverger les deux — et le bot démarre très bien. Il tombe ensuite, des
 * heures plus tard, sur un « the table X does not exist » au fond d'un module,
 * là où personne ne regarde : le module concerné se referme, souvent en
 * silence, et c'est l'utilisateur qui découvre la panne.
 *
 * On compare donc, une fois, ce que le client attend (`Prisma.dmmf`, la liste
 * des modèles compilés dans l'image) à ce que la base contient vraiment. Une
 * ligne `fatal` nomme les tables manquantes et le remède. On ne refuse PAS de
 * démarrer : quarante-cinq modules n'ont pas à tomber parce qu'un seul a perdu
 * sa table.
 *
 * La lecture de `sqlite_master` est propre à SQLite, comme les PRAGMA
 * ci-dessus : sur un autre SGBD la requête échoue et la vérification se tait.
 */
async function warnAboutMissingTables(): Promise<void> {
  try {
    const expected = Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name);
    const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const present = new Set(rows.map((row) => row.name));
    const missing = expected.filter((name) => !present.has(name)).sort();
    if (missing.length === 0) return;
    log.fatal(
      { tables: missing },
      'Tables absentes de la base : des migrations ne sont pas appliquées. ' +
        'Les modules concernés échoueront, souvent sans le dire. ' +
        'Reconstruire le conteneur, ou `npx prisma migrate deploy`.',
    );
  } catch (error) {
    // Base d'un autre type, ou lecture refusée : la vérification est un
    // confort, jamais une condition de démarrage.
    log.debug({ err: error }, 'Vérification des tables impossible');
  }
}
