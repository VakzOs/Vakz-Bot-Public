import { defineModule } from '../../core/module.js';
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
  configUI: [
    {
      fields: [
        { key: 'channelId', label: 'Salon des signalements', type: 'channel' },
        { key: 'staffRoleId', label: 'Rôle staff notifié', type: 'role' },
      ],
    },
  ],
  componentHandler: reportsComponent,
  commands: [report],
});
