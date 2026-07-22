import { defineModule } from '../../core/module.js';
import { MODULE_NAME, adventConfigSchema, adventDefaultConfig } from './config.js';
import { advent } from './commands.js';
import { adventPanel } from './panel.js';
import { adventAnnounceTask } from './task.js';

/**
 * Module « Calendrier de l'Avent » (saisonnier) : du 1er au 24 décembre, chaque
 * membre ouvre une porte par jour via `/avent ouvrir` et gagne des pièces et/ou
 * un objet configurés par jour (repli sur des pièces par défaut). `/avent
 * calendrier` affiche la progression. Annonce quotidienne optionnelle.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.advent.label',
  descriptionKey: 'modules.advent.description',
  configSchema: adventConfigSchema,
  defaultConfig: adventDefaultConfig,
  configUI: [
    {
      description: 'Les récompenses jour par jour restent éditables sur Discord via /config.',
      fields: [
        { key: 'announceChannelId', label: 'Salon des annonces', type: 'channel' },
        { key: 'defaultCoins', label: 'Pièces par défaut par jour', type: 'number' },
        { key: 'testMode', label: 'Mode test (ouvre toutes les cases)', type: 'boolean' },
      ],
    },
  ],
  configPanel: adventPanel,
  commands: [advent],
  tasks: [adventAnnounceTask],
});
