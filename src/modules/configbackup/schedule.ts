import cron from 'node-cron';
import type { BotContext } from '../../core/module.js';
import { getBackupConfig } from './config.js';
import { runBackup } from './service.js';

/**
 * Planification des sauvegardes automatiques, un travail cron par serveur.
 *
 * Chaque serveur ayant sa propre cadence, on ne peut pas se contenter d'une
 * tâche de module (dont l'expression est figée à la compilation) : on
 * enregistre/retire dynamiquement un travail par serveur, que node-cron évalue
 * dans le fuseau du bot (`TZ`).
 */

const JOB_PREFIX = 'configbackup:guild:';

/** L'expression est-elle comprise par le planificateur ? */
export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * (Ré)aligne le travail planifié d'un serveur sur sa configuration.
 *
 * Toujours appelée après une écriture de config : sans cela, désactiver la
 * sauvegarde automatique dans le dashboard laisserait l'ancienne cadence
 * tourner jusqu'au prochain redémarrage.
 */
export async function syncGuildBackupJob(ctx: BotContext, guildId: string): Promise<boolean> {
  const name = `${JOB_PREFIX}${guildId}`;
  ctx.scheduler.stop(name);

  const config = await getBackupConfig(ctx, guildId);
  if (!config.auto) return false;
  if (!isValidCron(config.cron)) {
    ctx.logger.warn(
      { guildId, cron: config.cron },
      'Expression cron de sauvegarde invalide : automatisation inactive',
    );
    return false;
  }

  ctx.scheduler.register(name, config.cron, async () => {
    await runBackup(ctx, guildId);
  });
  return true;
}

/** Enregistre les travaux de tous les serveurs connus (au démarrage du bot). */
export async function syncAllBackupJobs(ctx: BotContext): Promise<number> {
  let count = 0;
  for (const guildId of ctx.client.guilds.cache.keys()) {
    if (await syncGuildBackupJob(ctx, guildId)) count += 1;
  }
  if (count > 0) ctx.logger.info({ count }, 'Sauvegardes automatiques planifiées');
  return count;
}
