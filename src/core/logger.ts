import { pino, multistream, transport, type DestinationStream, type Logger } from 'pino';
import { env, isProduction } from './env.js';
import { parseLogRecord, pushRecord } from './log-buffer.js';
import { appendRecord, startArchive } from './log-archive.js';
import { recordLog } from './metrics.js';

/**
 * Logger pino partagé dans toute l'application.
 *
 * Deux destinations en parallèle : la sortie habituelle — JSON sur stdout en
 * production, `pino-pretty` en développement — et le hublot du dashboard, qui
 * range chaque ligne dans le tampon mémoire ET dans l'archive du jour. Le
 * hublot est branché en second, et son écriture est protégée : ni un tampon ni
 * une archive en défaut ne peuvent priver le conteneur de ses logs.
 */
const output: DestinationStream = isProduction
  ? process.stdout
  : transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    });

/**
 * Destination qui alimente le dashboard.
 *
 * Elle parse la ligne JSON **une seule fois** puis la distribue au tampon et à
 * l'archive : la normalisation (et surtout le masquage des jetons) vit ainsi à
 * un seul endroit, et un secret échappé ne peut pas être gravé sur disque sous
 * prétexte qu'il aurait pris un autre chemin que le tampon.
 */
const dashboardStream = {
  write(line: string): void {
    try {
      const record = parseLogRecord(line);
      if (!record) return;
      pushRecord(record);
      appendRecord(record);
      // Le compteur du monitoring passe par ici et non par les appels à
      // `logger.error()` : c'est le seul point où TOUTES les lignes défilent,
      // celles des modules comme celles des dépendances.
      recordLog(record.level);
    } catch {
      // Un hublot d'affichage ne doit jamais faire tomber le logger.
    }
  },
};

startArchive();

export const logger: Logger = pino(
  { level: env.LOG_LEVEL },
  // `level: 'trace'` sur chaque destination : c'est le logger lui-même qui
  // filtre selon `LOG_LEVEL`. Sans ça, `multistream` appliquerait en plus son
  // propre seuil (`info`) et un `LOG_LEVEL=debug` ne servirait à rien.
  multistream([
    { stream: output, level: 'trace' },
    { stream: dashboardStream, level: 'trace' },
  ]),
);

/** Crée un logger enfant avec un contexte (ex. nom de module). */
export function createLogger(scope: string): Logger {
  return logger.child({ scope });
}

/** Loggers de module déjà créés — un enfant pino par `scope`, pas un par ligne. */
const scoped = new Map<string, Logger>();

/**
 * Le logger d'un module, mémoïsé.
 *
 * Les gardes du cœur (`safeRun`, `handleInteractionError`) ne reçoivent pas le
 * contexte du module, seulement son **nom**, au milieu d'un objet de champs.
 * Elles écrivaient donc sur le logger racine : la ligne partait sans `scope`,
 * la colonne « module » du dashboard restait vide et la recherche par module ne
 * trouvait pas l'erreur qu'elle cherchait — précisément pour les modules qui ne
 * parlent que par évènements, et qui n'ont donc rien d'autre à montrer.
 */
export function loggerFor(scope: string | undefined): Logger {
  if (!scope) return logger;
  const cached = scoped.get(scope);
  if (cached) return cached;
  const child = createLogger(scope);
  scoped.set(scope, child);
  return child;
}
