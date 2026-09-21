import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, giveawaysConfigSchema, giveawaysDefaultConfig } from './config.js';
import { giveaway } from './commands.js';
import { giveawaysComponent } from './component.js';
import { giveawayTask } from './task.js';

/**
 * Module « Giveaways » : les admins lancent des tirages au sort via
 * `/giveaway`, les membres participent avec un bouton, et une tâche minute
 * tire les gagnants à l'échéance. Relance complète ou ciblée sur un gagnant.
 * Dashboard : salon de logs des gagnants + textes d'annonce personnalisables.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.giveaways.label',
  descriptionKey: 'modules.giveaways.description',
  category: 'engagement',
  emoji: '\u{1F381}',
  configSchema: giveawaysConfigSchema,
  defaultConfig: giveawaysDefaultConfig,
  configUI: () => [
    {
      description: t('modules.giveaways.ui.g0.description'),
      fields: [
        {
          key: 'logChannelId',
          label: t('modules.giveaways.ui.g0.champs.logChannelId.label'),
          type: 'channel',
          help: t('modules.giveaways.ui.g0.champs.logChannelId.help'),
        },
        {
          key: 'winMessage',
          label: t('modules.giveaways.ui.g0.champs.winMessage.label'),
          type: 'textarea',
          help: t('modules.giveaways.ui.g0.champs.winMessage.help'),
        },
        {
          key: 'noWinnerMessage',
          label: t('modules.giveaways.ui.g0.champs.noWinnerMessage.label'),
          type: 'textarea',
          help: t('modules.giveaways.ui.g0.champs.noWinnerMessage.help'),
        },
      ],
    },
  ],
  commands: [giveaway],
  componentHandler: giveawaysComponent,
  tasks: [giveawayTask],
});
