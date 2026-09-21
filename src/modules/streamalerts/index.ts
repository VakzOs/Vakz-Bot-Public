import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
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
  configUI: () => [
    {
      label: t('modules.streamalerts.ui.g0.label'),
      description: t('modules.streamalerts.ui.g0.description'),
      fields: [
        {
          key: 'subscriptions',
          label: t('modules.streamalerts.ui.g0.champs.subscriptions.label'),
          type: 'list',
          help: t('modules.streamalerts.ui.g0.champs.subscriptions.help'),
          idKey: 'id',
          addLabel: t('modules.streamalerts.ui.g0.champs.subscriptions.addLabel'),
          item: [
            {
              key: 'platform',
              label: t('modules.streamalerts.ui.g0.champs.subscriptions.item.platform.label'),
              type: 'select',
              help: t('modules.streamalerts.ui.g0.champs.subscriptions.item.platform.help'),
              options: [
                {
                  value: 'twitch',
                  label: t(
                    'modules.streamalerts.ui.g0.champs.subscriptions.item.platform.opt.twitch.label',
                  ),
                },
                {
                  value: 'youtube',
                  label: t(
                    'modules.streamalerts.ui.g0.champs.subscriptions.item.platform.opt.youtube.label',
                  ),
                },
                {
                  value: 'reddit',
                  label: t(
                    'modules.streamalerts.ui.g0.champs.subscriptions.item.platform.opt.reddit.label',
                  ),
                },
                {
                  value: 'rss',
                  label: t(
                    'modules.streamalerts.ui.g0.champs.subscriptions.item.platform.opt.rss.label',
                  ),
                },
                {
                  value: 'dealabs',
                  label: t(
                    'modules.streamalerts.ui.g0.champs.subscriptions.item.platform.opt.dealabs.label',
                  ),
                },
              ],
            },
            {
              key: 'identifier',
              label: t('modules.streamalerts.ui.g0.champs.subscriptions.item.identifier.label'),
              type: 'text',
              help: t('modules.streamalerts.ui.g0.champs.subscriptions.item.identifier.help'),
            },
            {
              key: 'displayName',
              label: t('modules.streamalerts.ui.g0.champs.subscriptions.item.displayName.label'),
              type: 'text',
              help: t('modules.streamalerts.ui.g0.champs.subscriptions.item.displayName.help'),
            },
            {
              key: 'channelId',
              label: t('modules.streamalerts.ui.g0.champs.subscriptions.item.channelId.label'),
              type: 'channel',
              help: t('modules.streamalerts.ui.g0.champs.subscriptions.item.channelId.help'),
            },
            {
              key: 'roleId',
              label: t('modules.streamalerts.ui.g0.champs.subscriptions.item.roleId.label'),
              type: 'role',
              help: t('modules.streamalerts.ui.g0.champs.subscriptions.item.roleId.help'),
            },
            {
              key: 'message',
              label: t('modules.streamalerts.ui.g0.champs.subscriptions.item.message.label'),
              type: 'textarea',
              help: t('modules.streamalerts.ui.g0.champs.subscriptions.item.message.help'),
            },
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
