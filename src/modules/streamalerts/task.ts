import type { ScheduledTask } from '../../core/module.js';
import { pollAll } from './service.js';

/**
 * Contrôle périodique des chaînes suivies (Twitch en live / nouvelles vidéos
 * YouTube). Toutes les 2 minutes : la latence restante vient surtout du flux RSS
 * YouTube (renseigner `YOUTUBE_API_KEY` le rend nettement plus réactif).
 */
export const streamalertsTask: ScheduledTask = {
  name: 'poll',
  cron: '*/2 * * * *',
  execute: pollAll,
};
