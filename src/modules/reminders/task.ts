import type { ScheduledTask } from '../../core/module.js';
import { deliverDueReminders } from './service.js';

/** Vérifie chaque minute les rappels arrivés à échéance. */
export const reminderTask: ScheduledTask = {
  name: 'deliver',
  cron: '* * * * *',
  execute: deliverDueReminders,
};
