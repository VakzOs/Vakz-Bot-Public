import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../../core/env.js';
import type { ScheduledTask } from '../../core/module.js';
import {
  autoUpdateBranch,
  autoUpdateEnabled,
  hasPendingRequest,
  requestAutoUpdate,
} from './service.js';

/**
 * Etalement aleatoire (en minutes) applique apres l heure de declenchement :
 * avec le cron par defaut (2 h du matin), la mise a jour tombe entre 2 h et 3 h.
 * Toutes les instances auto-hebergees ne tirent donc pas GitHub - ni ne
 * reconstruisent leur image - a la meme seconde.
 */
const JITTER_MINUTES = 59;

/**
 * Tache nocturne `FORCE_UPDATE` : ecrit une demande de mise a jour (comme
 * `/maj`, mais sans intervention) que l updater hote execute. Enregistree
 * uniquement si `FORCE_UPDATE` est actif (voir `index.ts`).
 */
export const autoUpdateTask: ScheduledTask = {
  name: 'auto-update',
  cron: env.FORCE_UPDATE_CRON,
  async execute(ctx) {
    // Double garde : la tache n est pas enregistree quand FORCE_UPDATE est
    // faux, mais on ne veut surtout pas mettre a jour une instance qui a
    // explicitement refuse les mises a jour automatiques.
    if (!autoUpdateEnabled()) return;

    const branch = autoUpdateBranch();
    const jitterMs = Math.floor(Math.random() * JITTER_MINUTES * 60_000);
    ctx.logger.info(
      { branch, delayMinutes: Math.round(jitterMs / 60_000) },
      'Mise a jour automatique planifiee (FORCE_UPDATE)',
    );
    await delay(jitterMs);

    // Une demande deja en attente = l updater hote n a rien pris depuis la
    // derniere fois (pas installe, arrete...). Inutile de la reecrire.
    if (await hasPendingRequest()) {
      ctx.logger.warn(
        'Une demande de mise a jour attend deja : updater hote absent ou occupe, nuit ignoree',
      );
      return;
    }

    try {
      await requestAutoUpdate(branch);
      ctx.logger.warn({ branch }, 'Mise a jour automatique demandee (FORCE_UPDATE)');
    } catch (error) {
      ctx.logger.error({ err: error }, 'Echec de la demande de mise a jour automatique');
    }
  },
};
