import type { ScheduledTask } from '../../core/module.js';
import { pollFreeGames } from './service.js';

/**
 * Contrôle périodique des jeux gratuits (Steam, Epic, GOG) toutes les 30 minutes.
 * Chaque nouveau jeu offert est annoncé une seule fois par serveur, selon les
 * plateformes activées dans sa configuration.
 */
export const freegamesTask: ScheduledTask = {
  name: 'poll',
  cron: '*/30 * * * *',
  execute: pollFreeGames,
};
