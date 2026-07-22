import { defineModule } from '../../core/module.js';
import { MODULE_NAME, interserverConfigSchema, interserverDefaultConfig } from './config.js';
import { interserverPanel } from './panel.js';
import { onInterserverMessage } from './events.js';

/**
 * Module « Interserveurs » : relie des salons de serveurs différents via un
 * même « code de réseau ». Un message posté dans un salon lié est relayé (par
 * webhook, pseudo + avatar conservés) vers tous les autres salons du réseau.
 * Configuration via `/config` ; les liens et webhooks sont stockés en base.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.interserver.label',
  descriptionKey: 'modules.interserver.description',
  configSchema: interserverConfigSchema,
  defaultConfig: interserverDefaultConfig,
  configUI: [
    {
      description: 'La liaison des salons entre serveurs se fait sur Discord via /config.',
      fields: [
        {
          key: 'tagServer',
          label: 'Afficher le nom du serveur d’origine sur les messages relayés',
          type: 'boolean',
        },
      ],
    },
  ],
  configPanel: interserverPanel,
  events: [onInterserverMessage],
});
