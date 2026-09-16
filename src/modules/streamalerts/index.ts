import { defineModule } from '../../core/module.js';
import { streamalertsActions } from './actions.js';
import { MODULE_NAME, streamalertsConfigSchema, streamalertsDefaultConfig } from './config.js';
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
  category: 'operations',
  emoji: '\u{1F4E1}',
  configSchema: streamalertsConfigSchema,
  defaultConfig: streamalertsDefaultConfig,
  configUI: [
    {
      label: '📡 Abonnements',
      description: 'Pour Dealabs, l’identifiant sert de mot-clé de filtre.',
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
  actions: streamalertsActions,
  tasks: [streamalertsTask],
  async onLoad(ctx) {
    await primeAll(ctx);
  },
});
