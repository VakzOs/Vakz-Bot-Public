import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { interserverActions } from './actions.js';
import { MODULE_NAME, interserverConfigSchema, interserverDefaultConfig } from './config.js';
import { onInterserverMessage } from './events.js';

/**
 * Module « Interserveurs » : relie des salons de serveurs différents via un
 * même « code de réseau ». Un message posté dans un salon lié est relayé (par
 * webhook, pseudo + avatar conservés) vers tous les autres salons du réseau.
 * Configuration via le dashboard ; les liens et webhooks sont stockés en base.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.interserver.label',
  descriptionKey: 'modules.interserver.description',
  category: 'community',
  emoji: '\u{1F310}',
  configSchema: interserverConfigSchema,
  defaultConfig: interserverDefaultConfig,
  configUI: () => [
    {
      description: t('modules.interserver.ui.g0.description'),
      fields: [
        {
          key: 'tagServer',
          label: t('modules.interserver.ui.g0.champs.tagServer.label'),
          type: 'boolean',
          help: t('modules.interserver.ui.g0.champs.tagServer.help'),
        },
      ],
    },
  ],
  actions: interserverActions,
  events: [onInterserverMessage],
});
