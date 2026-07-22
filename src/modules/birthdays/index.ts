import { defineModule } from '../../core/module.js';
import { MODULE_NAME, birthdaysConfigSchema, birthdaysDefaultConfig } from './config.js';
import { birthdaysPanel } from './panel.js';
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
  configSchema: birthdaysConfigSchema,
  defaultConfig: birthdaysDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'channelId', label: 'Salon des annonces', type: 'channel' },
        { key: 'roleId', label: 'Rôle « anniversaire du jour »', type: 'role' },
        {
          key: 'message',
          label: 'Message',
          type: 'textarea',
          help: 'Variables : {mention}, {username}.',
        },
        { key: 'announceHour', label: 'Heure d’annonce (0-23)', type: 'number' },
        { key: 'announceMinute', label: 'Minute d’annonce (0-59)', type: 'number' },
      ],
    },
  ],
  configPanel: birthdaysPanel,
  commands: [anniversaire],
  tasks: [birthdayTask],
});
