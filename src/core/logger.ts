import { pino, type Logger } from 'pino';
import { env, isProduction } from './env.js';

/**
 * Logger pino partagé dans toute l'application.
 *
 * En développement, on active `pino-pretty` pour des logs lisibles.
 * En production, on émet du JSON structuré (idéal pour l'agrégation de logs).
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/** Crée un logger enfant avec un contexte (ex. nom de module). */
export function createLogger(scope: string): Logger {
  return logger.child({ scope });
}
