import { defineModule } from '../../core/module.js';
import { MODULE_NAME, patchnotesConfigSchema, patchnotesDefaultConfig } from './config.js';
import { patchnotesPanel } from './panel.js';
import { patchnotesTask } from './task.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.patchnotes.label',
  descriptionKey: 'modules.patchnotes.description',
  configSchema: patchnotesConfigSchema,
  defaultConfig: patchnotesDefaultConfig,
  configPanel: patchnotesPanel,
  tasks: [patchnotesTask],
});
