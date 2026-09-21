import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { adventActions } from './actions.js';
import { MODULE_NAME, adventConfigSchema, adventDefaultConfig } from './config.js';
import { advent } from './commands.js';
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
  category: 'engagement',
  emoji: '\u{1F384}',
  configSchema: adventConfigSchema,
  defaultConfig: adventDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'announceChannelId',
          label: t('modules.advent.ui.g0.champs.announceChannelId.label'),
          type: 'channel',
          help: t('modules.advent.ui.g0.champs.announceChannelId.help'),
        },
        {
          key: 'defaultCoins',
          label: t('modules.advent.ui.g0.champs.defaultCoins.label'),
          type: 'number',
          help: t('modules.advent.ui.g0.champs.defaultCoins.help'),
        },
        {
          key: 'testMode',
          label: t('modules.advent.ui.g0.champs.testMode.label'),
          type: 'boolean',
          help: t('modules.advent.ui.g0.champs.testMode.help'),
        },
      ],
    },
    {
      label: t('modules.advent.ui.g1.label'),
      description: t('modules.advent.ui.g1.description'),
      fields: [
        {
          key: 'rewards',
          label: t('modules.advent.ui.g1.champs.rewards.label'),
          type: 'list',
          help: t('modules.advent.ui.g1.champs.rewards.help'),
          addLabel: t('modules.advent.ui.g1.champs.rewards.addLabel'),
          item: [
            {
              key: 'day',
              label: t('modules.advent.ui.g1.champs.rewards.item.day.label'),
              type: 'number',
              default: 1,
            },
            {
              key: 'coins',
              label: t('modules.advent.ui.g1.champs.rewards.item.coins.label'),
              type: 'number',
            },
            {
              key: 'items',
              label: t('modules.advent.ui.g1.champs.rewards.item.items.label'),
              type: 'tags',
              help: t('modules.advent.ui.g1.champs.rewards.item.items.help'),
            },
            {
              key: 'itemQty',
              label: t('modules.advent.ui.g1.champs.rewards.item.itemQty.label'),
              type: 'number',
              default: 1,
            },
            {
              key: 'message',
              label: t('modules.advent.ui.g1.champs.rewards.item.message.label'),
              type: 'textarea',
            },
            {
              key: 'link',
              label: t('modules.advent.ui.g1.champs.rewards.item.link.label'),
              type: 'text',
            },
          ],
        },
      ],
    },
  ],
  actions: adventActions,
  commands: [advent],
  tasks: [adventAnnounceTask],
});
