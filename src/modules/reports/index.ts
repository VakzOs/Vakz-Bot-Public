import { defineModule } from '../../core/module.js';
import { report } from './commands.js';
import { reportsComponent } from './component.js';
import { MODULE_NAME, reportsConfigSchema, reportsDefaultConfig } from './config.js';
import { reportsPanel } from './panel.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.reports.label',
  descriptionKey: 'modules.reports.description',
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
  configPanel: reportsPanel,
  componentHandler: reportsComponent,
  commands: [report],
});
