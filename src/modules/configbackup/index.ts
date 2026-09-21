import { defineModule } from '../../core/module.js';
import { sauvegarde } from './commands.js';
import { configbackupConfigSchema, configbackupDefaultConfig } from './config.js';
import { syncAllBackupJobs, syncGuildBackupJob } from './schedule.js';

/**
 * Module « Sauvegarde » : exporte **tout** ce que le bot détient d'un serveur —
 * la configuration des modules, la structure (salons/rôles) qu'elle référence,
 * et les données des membres (argent, objets et inventaires, voyageurs de la
 * Route de l'Infini, niveaux, sanctions…) — dans un fichier, puis le restaure.
 *
 * La sauvegarde se lance à la main (`/sauvegarde`, bouton du dashboard) ou
 * automatiquement, chaque serveur choisissant sa cadence (expression cron).
 *
 * Marqué `internal` → toujours disponible pour les administrateurs, sans
 * interrupteur à activer, et jamais inclus dans les sauvegardes qu'il produit.
 */
export default defineModule({
  name: 'configbackup',
  labelKey: 'modules.configbackup.label',
  descriptionKey: 'modules.configbackup.description',
  category: 'security',
  emoji: '\u{1F4BE}',
  internal: true,
  commands: [sauvegarde],
  configSchema: configbackupConfigSchema,
  defaultConfig: configbackupDefaultConfig,
  async onLoad(ctx) {
    await syncAllBackupJobs(ctx);
  },
  async onConfigSaved(ctx, guildId) {
    await syncGuildBackupJob(ctx, guildId);
  },
});
