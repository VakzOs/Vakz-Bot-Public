import type { ScheduledTask } from '../../core/module.js';
import { updateAllGuilds } from './service.js';

/**
 * Rafraîchit les salons-compteurs toutes les 10 minutes. Discord limite les
 * renommages de salon à 2 par 10 min : ce rythme reste dans les clous.
 */
export const serverstatsTask: ScheduledTask = {
  name: 'refresh',
  cron: '*/10 * * * *',
  execute: updateAllGuilds,
};
