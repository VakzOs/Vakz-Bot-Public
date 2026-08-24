import { defineModule } from '../../core/module.js';
import { MODULE_NAME, itemsConfigSchema, itemsDefaultConfig } from './config.js';
import { itemsCommands } from './commands.js';
import { itemsPanel } from './panel.js';

/**
 * Module « Objets & inventaires » : catalogue d'objets par serveur, achat avec
 * la monnaie du serveur, utilisation (rôle-récompense optionnel), échange entre
 * membres et gestion administrative. Catalogue géré via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.items.label',
  descriptionKey: 'modules.items.description',
  configSchema: itemsConfigSchema,
  defaultConfig: itemsDefaultConfig,
  configUI: [
    {
      description: 'La création des objets se fait sur Discord via /config.',
      fields: [
        {
          key: 'tradingEnabled',
          label: 'Autoriser l’échange d’objets entre membres',
          type: 'boolean',
        },
      ],
    },
    {
      key: 'drops',
      label: '🎁 Butin dans les mini-jeux',
      description:
        'Fait tomber des objets « droppable » à la fin des mini-jeux (PFC, morpion, bataille navale), avec un pourcentage par rareté. On tire de la plus rare à la plus commune.',
      fields: [
        { key: 'enabled', label: 'Activer les drops', type: 'boolean' },
        {
          key: 'on',
          label: 'Quand tirer un drop',
          type: 'select',
          options: [
            { value: 'win', label: 'Victoire seulement' },
            { value: 'winDraw', label: 'Victoire et égalité' },
            { value: 'any', label: 'Chaque partie (peu importe l’issue)' },
          ],
        },
        { key: 'common', label: '% drop — Commun (0-100)', type: 'number' },
        { key: 'rare', label: '% drop — Rare (0-100)', type: 'number' },
        { key: 'epic', label: '% drop — Épique (0-100)', type: 'number' },
        { key: 'legendary', label: '% drop — Légendaire (0-100)', type: 'number' },
      ],
    },
  ],
  configPanel: itemsPanel,
  commands: itemsCommands,
});
