import type { ScheduledTask } from '../../core/module.js';
import { refreshLeaderboards, runVoiceMoney } from './service.js';

/** Gain de monnaie en vocal, chaque minute. */
export const voiceMoneyTask: ScheduledTask = {
  name: 'voice-money',
  cron: '* * * * *',
  execute: runVoiceMoney,
};

/** Actualisation du classement auto des plus riches, toutes les 10 minutes. */
export const leaderboardTask: ScheduledTask = {
  name: 'leaderboard',
  cron: '*/10 * * * *',
  execute: refreshLeaderboards,
};
