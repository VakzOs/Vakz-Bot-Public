import type { ScheduledTask } from '../../core/module.js';
import { runScheduledMessages } from './service.js';

/** Vérifie chaque minute les messages programmés arrivés à échéance. */
export const scheduledmessagesTask: ScheduledTask = {
  name: 'post',
  cron: '* * * * *',
  execute: runScheduledMessages,
};
