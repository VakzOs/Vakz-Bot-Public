import { defineModule } from '../../core/module.js';
import { MODULE_NAME, streamalertsConfigSchema, streamalertsDefaultConfig } from './config.js';
import { streamalertsPanel } from './panel.js';
import { streamalertsTask } from './task.js';
import { primeAll } from './service.js';

/**
 * Module « Alertes stream & flux » : suit des sources et annonce dans un salon
 * les lives Twitch (API Helix), les nouvelles vidéos YouTube (flux RSS), les
 * posts Reddit (r/…/new.rss), les articles d'un flux RSS/Atom arbitraire et les
 * deals Dealabs (flux « hot », filtrable par mot-clé). Contrôle toutes les
 * 2 minutes. Twitch requiert `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` dans
 * `.env` ; les autres sources fonctionnent sans clé. `onLoad` amorce l'état au
 * démarrage pour ne jamais re-notifier l'existant.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.streamalerts.label',
  descriptionKey: 'modules.streamalerts.description',
  configSchema: streamalertsConfigSchema,
  defaultConfig: streamalertsDefaultConfig,
  configUI: [
    {
      label: '📡 Abonnements',
      description: 'Les filtres par mots-clés restent éditables sur Discord via /config.',
      fields: [
        {
          key: 'subscriptions',
          label: 'Abonnements',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un abonnement',
          item: [
            {
              key: 'platform',
              label: 'Plateforme',
              type: 'select',
              options: [
                { value: 'twitch', label: 'Twitch' },
                { value: 'youtube', label: 'YouTube' },
                { value: 'reddit', label: 'Reddit' },
                { value: 'rss', label: 'Flux RSS' },
                { value: 'dealabs', label: 'Dealabs' },
              ],
            },
            {
              key: 'identifier',
              label: 'Identifiant / URL',
              type: 'text',
              help: 'Nom de chaîne, sous-reddit, URL du flux…',
            },
            { key: 'displayName', label: 'Nom affiché', type: 'text' },
            { key: 'channelId', label: 'Salon des annonces', type: 'channel' },
            { key: 'roleId', label: 'Rôle à mentionner', type: 'role' },
            { key: 'message', label: 'Message personnalisé', type: 'textarea' },
          ],
        },
      ],
    },
  ],
  configPanel: streamalertsPanel,
  tasks: [streamalertsTask],
  async onLoad(ctx) {
    await primeAll(ctx);
  },
});
