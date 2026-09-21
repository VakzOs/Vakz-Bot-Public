import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, birthdaysConfigSchema, birthdaysDefaultConfig } from './config.js';
import { anniversaire } from './commands.js';
import { birthdayTask } from './task.js';

/**
 * Module « Anniversaires » : les membres enregistrent leur date via
 * `/anniversaire`, et une tâche horaire annonce les anniversaires du jour
 * (message + rôle éphémère) à l'heure configurée par serveur.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.birthdays.label',
  descriptionKey: 'modules.birthdays.description',
  category: 'community',
  emoji: '\u{1F382}',
  configSchema: birthdaysConfigSchema,
  defaultConfig: birthdaysDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'channelId',
          label: t('modules.birthdays.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.birthdays.ui.g0.champs.channelId.help'),
        },
        {
          key: 'roleId',
          label: t('modules.birthdays.ui.g0.champs.roleId.label'),
          type: 'role',
          help: t('modules.birthdays.ui.g0.champs.roleId.help'),
        },
        {
          key: 'message',
          label: t('modules.birthdays.ui.g0.champs.message.label'),
          type: 'textarea',
          help: t('modules.birthdays.ui.g0.champs.message.help'),
        },
        {
          key: 'announceHour',
          label: t('modules.birthdays.ui.g0.champs.announceHour.label'),
          type: 'number',
          help: t('modules.birthdays.ui.g0.champs.announceHour.help'),
        },
        {
          key: 'announceMinute',
          label: t('modules.birthdays.ui.g0.champs.announceMinute.label'),
          type: 'number',
          help: t('modules.birthdays.ui.g0.champs.announceMinute.help'),
        },
      ],
    },
  ],
  commands: [anniversaire],
  tasks: [birthdayTask],
});
