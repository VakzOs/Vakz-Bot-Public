import type { ScheduledTask } from '../../core/module.js';
import { announceDailyOpenings } from './service.js';

/**
 * Annonce quotidienne (9 h) de l'ouverture de la porte du jour, sur les serveurs
 * où le module est actif avec un salon d'annonce. Sans effet hors décembre.
 */
export const adventAnnounceTask: ScheduledTask = {
  name: 'announce',
  cron: '0 9 * * *',
  execute: announceDailyOpenings,
};
