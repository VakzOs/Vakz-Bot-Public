import { defineModule } from '../../core/module.js';
import { MODULE_NAME, wordreactionsConfigSchema, wordreactionsDefaultConfig } from './config.js';
import { wordreactionsPanel } from './panel.js';
import { onMessage } from './events.js';

/**
 * Module « Réactions de mots » : ajoute automatiquement des emojis en réaction
 * aux messages contenant certains mots-clés. Chaque règle définit un déclencheur
 * (contient / mot entier / exact / commence / finit par), un ou plusieurs emojis
 * (unicode ou personnalisés du serveur) et éventuellement un salon. Toutes les
 * règles correspondantes s'appliquent. Configuration via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.wordreactions.label',
  descriptionKey: 'modules.wordreactions.description',
  configSchema: wordreactionsConfigSchema,
  defaultConfig: wordreactionsDefaultConfig,
  configUI: [
    {
      label: '💬 Réactions automatiques',
      fields: [
        {
          key: 'rules',
          label: 'Règles',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter une règle',
          item: [
            { key: 'trigger', label: 'Déclencheur', type: 'text' },
            {
              key: 'match',
              label: 'Correspondance',
              type: 'select',
              options: [
                { value: 'contains', label: 'Contient' },
                { value: 'word', label: 'Mot entier' },
                { value: 'exact', label: 'Exact' },
                { value: 'startsWith', label: 'Commence par' },
                { value: 'endsWith', label: 'Finit par' },
              ],
            },
            {
              key: 'emojis',
              label: 'Emojis à ajouter',
              type: 'tags',
              placeholder: 'Un emoji puis Entrée',
            },
            { key: 'channelId', label: 'Salon (optionnel)', type: 'channel' },
          ],
        },
      ],
    },
  ],
  configPanel: wordreactionsPanel,
  events: [onMessage],
});
