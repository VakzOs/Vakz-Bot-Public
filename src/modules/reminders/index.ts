import { defineModule } from '../../core/module.js';
import { MODULE_NAME, remindersConfigSchema, remindersDefaultConfig } from './config.js';
import { remindersPanel } from './panel.js';
import { reminderTask } from './task.js';

/**
 * Module « Rappels » : les admins créent des rappels depuis `/config`, puis une
 * tâche minute les envoie en salon ou en MP.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.reminders.label',
  descriptionKey: 'modules.reminders.description',
  configSchema: remindersConfigSchema,
  defaultConfig: remindersDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'allowDm', label: 'Autoriser les rappels en message privé', type: 'boolean' },
        { key: 'maxDelayDays', label: 'Délai maximum d’un rappel (jours)', type: 'number' },
      ],
    },
  ],
  configPanel: remindersPanel,
  tasks: [reminderTask],
});
