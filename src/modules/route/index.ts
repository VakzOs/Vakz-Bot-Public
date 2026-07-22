import { defineModule } from '../../core/module.js';
import { MODULE_NAME, routeConfigSchema, routeDefaultConfig } from './config.js';
import { routeCommands } from './commands.js';
import { routePanel } from './panel.js';

/**
 * Module « Route de l'Infini » : une aventure solo façon DraftBot. `/route
 * avancer` déclenche un événement aléatoire (trésor, monstre, tempête…) qui
 * modifie les points de vie, l'énergie, la distance et les pièces du voyageur.
 * Les pièces alimentent l'économie et les objets trouvés l'inventaire.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.route.label',
  descriptionKey: 'modules.route.description',
  configSchema: routeConfigSchema,
  defaultConfig: routeDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'cooldownMinutes', label: 'Cooldown (minutes)', type: 'number' },
        { key: 'giveCoins', label: 'Donner des pièces', type: 'boolean' },
        { key: 'giveItems', label: 'Donner des objets', type: 'boolean' },
      ],
    },
  ],
  configPanel: routePanel,
  commands: routeCommands,
});
