import { defineModule } from '../../core/module.js';
import { MODULE_NAME, moderationConfigSchema, moderationDefaultConfig } from './config.js';
import { moderationPanel } from './panel.js';
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
  configSchema: moderationConfigSchema,
  defaultConfig: moderationDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'logChannelId', label: 'Salon des logs de modération', type: 'channel' },
        {
          key: 'dmOnSanction',
          label: 'Prévenir le membre en MP lors d’une sanction',
          type: 'boolean',
        },
      ],
    },
  ],
  configPanel: moderationPanel,
  commands: moderationCommands,
});
