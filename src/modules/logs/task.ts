import type { ScheduledTask } from '../../core/module.js';
import { pruneMessageSnapshots } from './message-store.js';

/**
 * Purge horaire des snapshots de messages périmés. Évite que la table
 * `LogMessageSnapshot` ne grossisse sans limite sur un serveur actif.
 */
export const snapshotPruneTask: ScheduledTask = {
  name: 'prune-message-snapshots',
  cron: '0 * * * *',
  execute: pruneMessageSnapshots,
};
