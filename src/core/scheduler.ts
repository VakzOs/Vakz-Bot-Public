import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { safeRun } from './errors.js';

const log = createLogger('scheduler');

/**
 * Wrapper minimal autour de node-cron : enregistre des tâches planifiées,
 * chaque exécution étant protégée par le handler d'erreurs (jamais de crash).
 */
export class Scheduler {
  private readonly jobs = new Map<string, CronJob>();

  /** Enregistre et démarre une tâche. Les noms en double sont ignorés. */
  register(name: string, expression: string, handler: () => Promise<void>): void {
    if (this.jobs.has(name)) {
      log.warn({ name }, 'Tâche déjà enregistrée, ignorée');
      return;
    }
    if (!cron.validate(expression)) {
      log.error({ name, expression }, 'Expression cron invalide, tâche ignorée');
      return;
    }

    const job = cron.schedule(
      expression,
      () => {
        void safeRun(handler, { kind: 'scheduled-task', name });
      },
      { timezone: env.TZ },
    );

    this.jobs.set(name, job);
    log.debug({ name, expression, timezone: env.TZ }, 'Tâche planifiée enregistrée');
  }

  /**
   * Arrête une tâche par son nom.
   *
   * `destroy()` et non `stop()` : depuis node-cron 4, la bibliothèque tient son
   * PROPRE registre global des tâches, et `stop()` se contente de mettre en
   * pause — l'entrée y reste, avec sa closure et son minuteur. Or les travaux
   * de sauvegarde sont retirés puis réenregistrés à chaque écriture de config
   * (`configbackup/schedule.ts`), donc plusieurs fois par serveur et par
   * semaine : la fuite est lente, silencieuse, et ne se voit que des mois plus
   * tard. Seul `destroy()` retire réellement l'entrée (mesuré : 50 cycles en
   * `stop()` laissent 50 tâches mortes, en `destroy()` zéro).
   */
  stop(name: string): void {
    void this.jobs.get(name)?.destroy();
    this.jobs.delete(name);
  }

  /** Arrête toutes les tâches (arrêt propre du bot). */
  stopAll(): void {
    for (const job of this.jobs.values()) {
      void job.destroy();
    }
    this.jobs.clear();
  }

  get size(): number {
    return this.jobs.size;
  }

  /**
   * Noms des tâches actuellement enregistrées.
   *
   * Sert au dashboard : savoir ce qui tourne réellement, plutôt que de déduire
   * d'une configuration ce qui *devrait* tourner — une expression cron invalide
   * étant ignorée, les deux peuvent différer.
   */
  names(): string[] {
    return [...this.jobs.keys()].sort();
  }
}

/** Instance partagée du scheduler. */
export const scheduler = new Scheduler();
