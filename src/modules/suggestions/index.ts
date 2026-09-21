import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, suggestionsConfigSchema, suggestionsDefaultConfig } from './config.js';
import { suggestion, suggestionsList } from './commands.js';
import { suggestionsComponent } from './component.js';

/**
 * Module « Suggestions » : les membres soumettent une suggestion via
 * `/suggestion` ; le bot la poste dans un salon dédié avec un vote 👍/👎 par
 * boutons. Le staff peut approuver / refuser / mettre à l'étude avec une raison.
 * Suggestions et votes sont persistés (tables `Suggestion` / `SuggestionVote`).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.suggestions.label',
  descriptionKey: 'modules.suggestions.description',
  category: 'community',
  emoji: '\u{1F4A1}',
  configSchema: suggestionsConfigSchema,
  defaultConfig: suggestionsDefaultConfig,
  configUI: () => [
    {
      label: t('modules.suggestions.ui.g0.label'),
      description: t('modules.suggestions.ui.g0.description'),
      fields: [
        {
          key: 'channelIds',
          label: t('modules.suggestions.ui.g0.champs.channelIds.label'),
          type: 'channels',
          help: t('modules.suggestions.ui.g0.champs.channelIds.help'),
        },
        {
          key: 'staffRoleId',
          label: t('modules.suggestions.ui.g0.champs.staffRoleId.label'),
          type: 'role',
          help: t('modules.suggestions.ui.g0.champs.staffRoleId.help'),
        },
        {
          key: 'createThread',
          label: t('modules.suggestions.ui.g0.champs.createThread.label'),
          type: 'boolean',
          help: t('modules.suggestions.ui.g0.champs.createThread.help'),
        },
        {
          key: 'maxPending',
          label: t('modules.suggestions.ui.g0.champs.maxPending.label'),
          type: 'number',
          help: t('modules.suggestions.ui.g0.champs.maxPending.help'),
        },
        {
          key: 'rewardCoins',
          label: t('modules.suggestions.ui.g0.champs.rewardCoins.label'),
          type: 'number',
          help: t('modules.suggestions.ui.g0.champs.rewardCoins.help'),
        },
        {
          key: 'rewardItemId',
          label: t('modules.suggestions.ui.g0.champs.rewardItemId.label'),
          type: 'text',
          help: t('modules.suggestions.ui.g0.champs.rewardItemId.help'),
        },
        {
          key: 'dynamicColor',
          label: t('modules.suggestions.ui.g0.champs.dynamicColor.label'),
          type: 'boolean',
          help: t('modules.suggestions.ui.g0.champs.dynamicColor.help'),
        },
        {
          key: 'roleLimits',
          label: t('modules.suggestions.ui.g0.champs.roleLimits.label'),
          type: 'list',
          help: t('modules.suggestions.ui.g0.champs.roleLimits.help'),
          addLabel: t('modules.suggestions.ui.g0.champs.roleLimits.addLabel'),
          item: [
            {
              key: 'roleId',
              label: t('modules.suggestions.ui.g0.champs.roleLimits.item.roleId.label'),
              type: 'role',
            },
            {
              key: 'limit',
              label: t('modules.suggestions.ui.g0.champs.roleLimits.item.limit.label'),
              type: 'number',
            },
          ],
        },
      ],
    },
  ],
  componentHandler: suggestionsComponent,
  commands: [suggestion, suggestionsList],
});
