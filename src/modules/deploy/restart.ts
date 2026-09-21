import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import type { BotContext } from '../../core/module.js';
import { notifyUptimeMaintenance } from '../../core/uptime.js';

/**
 * Redémarrage périodique du bot.
 *
 * Le bot ne se relance pas lui-même : il s'arrête proprement (le même chemin
 * que `SIGTERM`, donc scheduler arrêté, client Discord fermé, base
 * déconnectée), et c'est le **superviseur** qui le remonte — `restart:
 * unless-stopped` du `docker-compose.yml`, ou l'unité systemd / pm2 d'une
 * installation sans Docker. Sans superviseur, le bot resterait éteint : le
 * dashboard le dit, et la cadence reste désactivée par défaut.
 *
 * Une cadence en base plutôt qu'en `.env` : elle se règle depuis le dashboard,
 * et elle doit survivre au redémarrage qu'elle provoque.
 */

export const RESTART_AUTO_KEY = 'restart.auto';
export const RESTART_CRON_KEY = 'restart.cron';
export const RESTART_LAST_KEY = 'restart.lastRestartAt';

/** Nom de la tâche planifiée, stable pour pouvoir la ré-enregistrer. */
export const RESTART_TASK = 'auto-restart';

/** Chaque nuit à 5 h : après la mise à jour automatique, avant le réveil. */
export const DEFAULT_RESTART_CRON = '0 5 * * *';

/** Délai laissé à l'API pour répondre avant que le processus s'arrête. */
const GOODBYE_MS = 1_500;

/** Cadences proposées par le dashboard (le champ libre reste maître). */
export const RESTART_CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Toutes les 6 h', cron: '0 */6 * * *' },
  { label: 'Toutes les 12 h', cron: '0 */12 * * *' },
  { label: 'Chaque jour à 5 h', cron: '0 5 * * *' },
  { label: 'Chaque lundi à 5 h', cron: '0 5 * * 1' },
];

/** Instant de démarrage du processus, pour afficher l'uptime côté dashboard. */
const STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

/** Réglages de redémarrage, tels que le dashboard les lit et les écrit. */
export interface RestartSettings {
  auto: boolean;
  cron: string;
  /** Dernier redémarrage déclenché par la cadence ou le bouton (ISO). */
  lastRestartAt: string | null;
  /** Démarrage du processus courant (ISO) : l'uptime se calcule à partir de là. */
  startedAt: string;
  /** La tâche est-elle réellement enregistrée dans le planificateur ? */
  scheduled: boolean;
  presets: { label: string; cron: string }[];
}

export async function getRestartSettings(ctx: BotContext): Promise<RestartSettings> {
  const rows = await ctx.db.appSetting.findMany({
    where: { key: { in: [RESTART_AUTO_KEY, RESTART_CRON_KEY, RESTART_LAST_KEY] } },
  });
  const value = (key: string): string | undefined => rows.find((row) => row.key === key)?.value;

  return {
    auto: value(RESTART_AUTO_KEY) === 'true',
    cron: value(RESTART_CRON_KEY) ?? DEFAULT_RESTART_CRON,
    lastRestartAt: value(RESTART_LAST_KEY) ?? null,
    startedAt: STARTED_AT,
    scheduled: ctx.scheduler.names().includes(RESTART_TASK),
    presets: RESTART_CRON_PRESETS,
  };
}

/** Écrit un réglage de redémarrage (upsert sur `AppSetting`). */
export async function writeRestartSetting(
  db: PrismaClient,
  key: string,
  value: string,
): Promise<void> {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/**
 * (Ré)installe la tâche de redémarrage.
 *
 * Le `Scheduler` ignore silencieusement une expression invalide : on la valide
 * en amont (côté API) pour ne pas laisser croire à une cadence programmée qui
 * ne tournerait jamais.
 */
export async function applyRestartSchedule(ctx: BotContext): Promise<boolean> {
  const settings = await getRestartSettings(ctx);
  ctx.scheduler.stop(RESTART_TASK);
  if (!settings.auto) return true;

  const before = ctx.scheduler.size;
  ctx.scheduler.register(RESTART_TASK, settings.cron, async () => {
    await restartNow(ctx, 'cadence automatique');
  });
  const registered = ctx.scheduler.size > before;
  if (registered) {
    ctx.logger.info({ cron: settings.cron }, 'Redémarrage automatique programmé');
  }
  return registered;
}

/**
 * Arrête le bot proprement pour que le superviseur le remonte.
 *
 * On passe par `SIGTERM` plutôt que par un `process.exit()` maison : c'est le
 * chemin d'arrêt déjà installé par `src/index.ts` (Uptime Kuma prévenu, tâches
 * arrêtées, client Discord fermé, base déconnectée). Un seul chemin d'arrêt,
 * donc un seul à maintenir.
 */
export async function restartNow(ctx: BotContext, reason: string): Promise<void> {
  ctx.logger.warn({ reason }, 'Redémarrage du bot demandé');
  await writeRestartSetting(ctx.db, RESTART_LAST_KEY, new Date().toISOString()).catch(
    () => undefined,
  );
  // Signale la coupure comme volontaire : une maintenance, pas une panne.
  await notifyUptimeMaintenance(`🛠️ Redémarrage programmé (${reason})`).catch(() => undefined);
  await delay(GOODBYE_MS);
  process.kill(process.pid, 'SIGTERM');
}
