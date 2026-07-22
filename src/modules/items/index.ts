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
  ],
  configPanel: itemsPanel,
  commands: itemsCommands,
});
