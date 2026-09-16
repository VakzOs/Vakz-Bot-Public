import type { ScheduledTask } from '../../core/module.js';
import { cleanupOrphans } from './service.js';

/**
 * Filet de sécurité : nettoie périodiquement les salons temporaires vides ou
 * disparus, au cas où un événement vocal aurait été manqué (redémarrage, etc.).
 */
export const tempvoiceCleanupTask: ScheduledTask = {
  name: 'cleanup-orphans',
  cron: '*/10 * * * *',
  execute: cleanupOrphans,
};
