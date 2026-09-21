import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { report } from './commands.js';
import { reportsComponent } from './component.js';
import { MODULE_NAME, reportsConfigSchema, reportsDefaultConfig } from './config.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.reports.label',
  descriptionKey: 'modules.reports.description',
  category: 'security',
  emoji: '\u{1F6A9}',
  configSchema: reportsConfigSchema,
  defaultConfig: reportsDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'channelId',
          label: t('modules.reports.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.reports.ui.g0.champs.channelId.help'),
        },
        {
          key: 'staffRoleId',
          label: t('modules.reports.ui.g0.champs.staffRoleId.label'),
          type: 'role',
          help: t('modules.reports.ui.g0.champs.staffRoleId.help'),
        },
      ],
    },
  ],
  componentHandler: reportsComponent,
  commands: [report],
});
