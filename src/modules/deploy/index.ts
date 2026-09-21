import { defineModule } from '../../core/module.js';
import { deployComponent, maj } from './command.js';
import { applyRestartSchedule } from './restart.js';
import { autoUpdateEnabled, notifyPendingDeployRestart } from './service.js';
import { autoUpdateTask } from './task.js';

/**
 * Module « Mise à jour » : commande `/maj` réservée au propriétaire du bot
 * (`BOT_OWNER_ID`) qui écrit une demande de déploiement dans un dossier
 * partagé ; un updater côté hôte exécute `git pull` puis `docker compose up
 * -d --build`. Interne → toujours chargé, jamais listé dans le dashboard.
 *
 * La même mécanique est déclenchée chaque nuit sans intervention quand
 * `FORCE_UPDATE` est actif (tâche `auto-update`), pour que les instances
 * auto-hébergées suivent automatiquement les mises à jour publiques.
 *
 * Le module porte aussi le **redémarrage périodique** (`restart.ts`) : même
 * famille que `/maj` — on arrête le bot et le superviseur le remonte — mais
 * sans reconstruire quoi que ce soit. Sa cadence vit en base, réglée depuis le
 * dashboard, et est réinstallée à chaque démarrage.
 */
export default defineModule({
  name: 'deploy',
  labelKey: 'modules.deploy.label',
  descriptionKey: 'modules.deploy.description',
  internal: true,
  commands: [maj],
  // Pas de tâche enregistrée (donc pas de cron à valider) si FORCE_UPDATE est faux.
  tasks: autoUpdateEnabled() ? [autoUpdateTask] : [],
  componentHandler: deployComponent,
  onLoad: async (ctx) => {
    void notifyPendingDeployRestart(ctx);
    // La cadence vit en base : on la réinstalle au démarrage, y compris après
    // le redémarrage qu'elle vient elle-même de provoquer.
    await applyRestartSchedule(ctx).catch((error: unknown) => {
      ctx.logger.error({ err: error }, 'Programmation du redémarrage automatique échouée');
    });
  },
});
