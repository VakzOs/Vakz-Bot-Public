import { defineModule } from '../../core/module.js';
import { deployComponent, maj } from './command.js';
import { notifyPendingDeployRestart } from './service.js';

/**
 * Module « Mise à jour » : commande `/maj` réservée au propriétaire du bot
 * (`BOT_OWNER_ID`) qui écrit une demande de déploiement dans un dossier
 * partagé ; un updater côté hôte exécute `git pull` puis `docker compose up
 * -d --build`. Interne → toujours chargé, jamais dans `/config`.
 */
export default defineModule({
  name: 'deploy',
  labelKey: 'modules.deploy.label',
  descriptionKey: 'modules.deploy.description',
  internal: true,
  commands: [maj],
  componentHandler: deployComponent,
  onLoad: async (ctx) => {
    void notifyPendingDeployRestart(ctx);
  },
});
