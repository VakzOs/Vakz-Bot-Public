import type { ScheduledTask } from '../../core/module.js';
import { refreshLeaderboards, runVoiceXp } from './service.js';

/** Gain d'XP vocal, chaque minute. */
export const voiceXpTask: ScheduledTask = {
  name: 'voice-xp',
  cron: '* * * * *',
  execute: runVoiceXp,
};

/** Actualisation du classement auto, toutes les 10 minutes. */
export const leaderboardTask: ScheduledTask = {
  name: 'leaderboard',
  cron: '*/10 * * * *',
  execute: refreshLeaderboards,
};
