import type { Client } from 'discord.js';
import { env } from './env.js';
import { logger } from './logger.js';

const log = logger.child({ scope: 'uptime' });

let timer: NodeJS.Timeout | null = null;
let clientRef: Client | null = null;

/**
 * Envoie un heartbeat au moniteur « Push » d'Uptime Kuma. Silencieux si
 * `UPTIME_PUSH_URL` n'est pas défini. Ne rejette jamais (fire-and-forget).
 */
async function sendPush(status: 'up' | 'down', msg: string, ping?: number): Promise<void> {
  const base = env.UPTIME_PUSH_URL;
  if (!base) return;
  const url = new URL(base);
  url.searchParams.set('status', status);
  url.searchParams.set('msg', msg);
  if (typeof ping === 'number' && Number.isFinite(ping) && ping >= 0) {
    url.searchParams.set('ping', String(Math.round(ping)));
  }
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    log.debug({ err: error }, 'Échec du heartbeat Uptime Kuma');
  }
}

/** Démarre l'envoi périodique du heartbeat (statut « up » + latence Discord). */
export function startUptimePush(client: Client): void {
  if (!env.UPTIME_PUSH_URL) {
    log.info('UPTIME_PUSH_URL absent : heartbeat Uptime Kuma désactivé.');
    return;
  }
  clientRef = client;
  const intervalMs = env.UPTIME_PUSH_INTERVAL * 1000;

  const beat = (): void => {
    const ping = client.ws.ping; // ms, -1 avant la 1re heartbeat WS
    void sendPush('up', 'OK', ping >= 0 ? ping : undefined);
  };

  beat(); // premier push immédiat
  timer = setInterval(beat, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  log.info({ intervalSeconds: env.UPTIME_PUSH_INTERVAL }, 'Heartbeat Uptime Kuma démarré');
}

/**
 * Signale une fenêtre de maintenance (ex. avant un `/maj`). Envoie un dernier
 * heartbeat « up » portant un message de maintenance, de sorte qu'Uptime Kuma
 * affiche « maintenance » plutôt qu'une panne pendant la reconstruction — à
 * condition que la tolérance (retries) du moniteur couvre la durée du redémarrage.
 */
export async function notifyUptimeMaintenance(
  msg = '🛠️ Maintenance : mise à jour en cours',
): Promise<void> {
  const ping = clientRef?.ws.ping;
  await sendPush('up', msg, ping !== undefined && ping >= 0 ? ping : undefined);
}

/** Arrête le heartbeat périodique. */
export function stopUptimePush(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
