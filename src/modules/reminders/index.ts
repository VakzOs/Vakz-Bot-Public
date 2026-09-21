import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { remindersActions } from './actions.js';
import { MODULE_NAME, remindersConfigSchema, remindersDefaultConfig } from './config.js';
import { reminderTask } from './task.js';

/**
 * Module « Rappels » : les admins créent des rappels depuis le dashboard, puis une
 * tâche minute les envoie en salon ou en MP.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.reminders.label',
  descriptionKey: 'modules.reminders.description',
  category: 'operations',
  emoji: '\u{23F0}',
  configSchema: remindersConfigSchema,
  defaultConfig: remindersDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'allowDm',
          label: t('modules.reminders.ui.g0.champs.allowDm.label'),
          type: 'boolean',
          help: t('modules.reminders.ui.g0.champs.allowDm.help'),
        },
        {
          key: 'maxDelayDays',
          label: t('modules.reminders.ui.g0.champs.maxDelayDays.label'),
          type: 'number',
          help: t('modules.reminders.ui.g0.champs.maxDelayDays.help'),
        },
      ],
    },
  ],
  actions: remindersActions,
  tasks: [reminderTask],
});
