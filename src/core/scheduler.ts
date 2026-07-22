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

  /** Arrête une tâche par son nom. */
  stop(name: string): void {
    this.jobs.get(name)?.stop();
    this.jobs.delete(name);
  }

  /** Arrête toutes les tâches (arrêt propre du bot). */
  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  get size(): number {
    return this.jobs.size;
  }
}

/** Instance partagée du scheduler. */
export const scheduler = new Scheduler();
