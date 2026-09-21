import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, wordreactionsConfigSchema, wordreactionsDefaultConfig } from './config.js';
import { onMessage } from './events.js';

/**
 * Module « Réactions de mots » : ajoute automatiquement des emojis en réaction
 * aux messages contenant certains mots-clés. Chaque règle définit un déclencheur
 * (contient / mot entier / exact / commence / finit par), un ou plusieurs emojis
 * (unicode ou personnalisés du serveur) et éventuellement un salon. Toutes les
 * règles correspondantes s'appliquent. Configuration via le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.wordreactions.label',
  descriptionKey: 'modules.wordreactions.description',
  category: 'engagement',
  emoji: '\u{1F4AC}',
  configSchema: wordreactionsConfigSchema,
  defaultConfig: wordreactionsDefaultConfig,
  configUI: () => [
    {
      label: t('modules.wordreactions.ui.g0.label'),
      fields: [
        {
          key: 'rules',
          label: t('modules.wordreactions.ui.g0.champs.rules.label'),
          type: 'list',
          help: t('modules.wordreactions.ui.g0.champs.rules.help'),
          idKey: 'id',
          addLabel: t('modules.wordreactions.ui.g0.champs.rules.addLabel'),
          item: [
            {
              key: 'trigger',
              label: t('modules.wordreactions.ui.g0.champs.rules.item.trigger.label'),
              type: 'text',
            },
            {
              key: 'match',
              label: t('modules.wordreactions.ui.g0.champs.rules.item.match.label'),
              type: 'select',
              options: [
                {
                  value: 'contains',
                  label: t(
                    'modules.wordreactions.ui.g0.champs.rules.item.match.opt.contains.label',
                  ),
                },
                {
                  value: 'word',
                  label: t('modules.wordreactions.ui.g0.champs.rules.item.match.opt.word.label'),
                },
                {
                  value: 'exact',
                  label: t('modules.wordreactions.ui.g0.champs.rules.item.match.opt.exact.label'),
                },
                {
                  value: 'startsWith',
                  label: t(
                    'modules.wordreactions.ui.g0.champs.rules.item.match.opt.startsWith.label',
                  ),
                },
                {
                  value: 'endsWith',
                  label: t(
                    'modules.wordreactions.ui.g0.champs.rules.item.match.opt.endsWith.label',
                  ),
                },
              ],
            },
            {
              key: 'emojis',
              label: t('modules.wordreactions.ui.g0.champs.rules.item.emojis.label'),
              type: 'tags',
              placeholder: t('modules.wordreactions.ui.g0.champs.rules.item.emojis.placeholder'),
            },
            {
              key: 'channelId',
              label: t('modules.wordreactions.ui.g0.champs.rules.item.channelId.label'),
              type: 'channel',
            },
          ],
        },
      ],
    },
  ],
  events: [onMessage],
});
