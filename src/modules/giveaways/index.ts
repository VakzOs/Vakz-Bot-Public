import { defineModule } from '../../core/module.js';
import { MODULE_NAME, giveawaysConfigSchema, giveawaysDefaultConfig } from './config.js';
import { giveaway } from './commands.js';
import { giveawaysComponent } from './component.js';
import { giveawaysPanel } from './panel.js';
import { giveawayTask } from './task.js';

/**
 * Module « Giveaways » : les admins lancent des tirages au sort via
 * `/giveaway`, les membres participent avec un bouton, et une tâche minute
 * tire les gagnants à l'échéance. Relance complète ou ciblée sur un gagnant.
 * `/config` : salon de logs des gagnants + textes d'annonce personnalisables.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.giveaways.label',
  descriptionKey: 'modules.giveaways.description',
  configSchema: giveawaysConfigSchema,
  defaultConfig: giveawaysDefaultConfig,
  configUI: [
    {
      description: 'Les tirages se créent avec la commande /giveaway.',
      fields: [
        { key: 'logChannelId', label: 'Salon des logs', type: 'channel' },
        {
          key: 'winMessage',
          label: 'Message de gain',
          type: 'textarea',
          help: 'Envoyé au(x) gagnant(s).',
        },
        { key: 'noWinnerMessage', label: 'Message quand aucun gagnant', type: 'textarea' },
      ],
    },
  ],
  configPanel: giveawaysPanel,
  commands: [giveaway],
  componentHandler: giveawaysComponent,
  tasks: [giveawayTask],
});
