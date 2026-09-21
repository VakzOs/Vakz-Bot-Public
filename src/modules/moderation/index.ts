import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, moderationConfigSchema, moderationDefaultConfig } from './config.js';
import { moderationCommands } from './commands.js';

/**
 * Module « Modération » : commandes warn / kick / ban / unban / timeout /
 * untimeout et historique des sanctions, avec salon de logs et MP optionnels.
 * Les sanctions sont enregistrées en base (table Sanction).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.moderation.label',
  descriptionKey: 'modules.moderation.description',
  category: 'security',
  emoji: '\u{1F528}',
  configSchema: moderationConfigSchema,
  defaultConfig: moderationDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'logChannelId',
          label: t('modules.moderation.ui.g0.champs.logChannelId.label'),
          type: 'channel',
          help: t('modules.moderation.ui.g0.champs.logChannelId.help'),
        },
        {
          key: 'dmOnSanction',
          label: t('modules.moderation.ui.g0.champs.dmOnSanction.label'),
          type: 'boolean',
          help: t('modules.moderation.ui.g0.champs.dmOnSanction.help'),
        },
      ],
    },
  ],
  commands: moderationCommands,
});
