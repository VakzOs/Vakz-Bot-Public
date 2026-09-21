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
