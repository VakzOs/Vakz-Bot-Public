import { defineModule } from '../../core/module.js';
import { MODULE_NAME, customcommandsConfigSchema, customcommandsDefaultConfig } from './config.js';
import { customcommandsPanel } from './panel.js';
import { onMessage } from './events.js';

/**
 * Module « Commandes personnalisées » : des auto-réponses déclenchées par le
 * contenu des messages. Un admin définit un déclencheur (contient / exact /
 * commence / finit par), une réponse (texte ou embed avec variables
 * `{user} {username} {server} {channel}`), éventuellement limitée à un salon,
 * avec un délai anti-spam et la suppression du message déclencheur.
 * Configuration via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.customcommands.label',
  descriptionKey: 'modules.customcommands.description',
  configSchema: customcommandsConfigSchema,
  defaultConfig: customcommandsDefaultConfig,
  configUI: [
    {
      label: '⌨️ Commandes personnalisées',
      fields: [
        {
          key: 'commands',
          label: 'Commandes',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter une commande',
          item: [
            { key: 'trigger', label: 'Déclencheur', type: 'text' },
            {
              key: 'match',
              label: 'Correspondance',
              type: 'select',
              options: [
                { value: 'contains', label: 'Contient' },
                { value: 'exact', label: 'Exact' },
                { value: 'startsWith', label: 'Commence par' },
                { value: 'endsWith', label: 'Finit par' },
              ],
            },
            { key: 'response', label: 'Réponse', type: 'textarea' },
            { key: 'asEmbed', label: 'En embed', type: 'boolean' },
            { key: 'channelId', label: 'Salon (optionnel)', type: 'channel' },
            { key: 'deleteTrigger', label: 'Supprimer le message déclencheur', type: 'boolean' },
            { key: 'cooldown', label: 'Cooldown (s)', type: 'number' },
          ],
        },
      ],
    },
  ],
  configPanel: customcommandsPanel,
  events: [onMessage],
});
