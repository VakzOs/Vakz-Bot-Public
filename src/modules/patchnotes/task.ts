import type { ScheduledTask } from '../../core/module.js';
import { pollPatchNotes } from './service.js';

export const patchnotesTask: ScheduledTask = {
  name: 'poll',
  cron: '*/20 * * * *',
  execute: pollPatchNotes,
};
