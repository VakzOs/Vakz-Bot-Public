import { defineModule } from '../../core/module.js';
import { MODULE_NAME, freegamesConfigSchema, freegamesDefaultConfig } from './config.js';
import { freegamesCommands } from './commands.js';
import { freegamesPanel } from './panel.js';
import { freegamesTask } from './task.js';

/**
 * Module « Jeux gratuits » : surveille les jeux qui deviennent gratuits à garder
 * sur Steam, Epic Games et GOG (plateformes sélectionnables par serveur) et les
 * annonce dans un salon configuré, avec mention de rôle optionnelle.
 * `/jeuxgratuits` liste les offres du moment, toutes plateformes confondues.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.freegames.label',
  descriptionKey: 'modules.freegames.description',
  configSchema: freegamesConfigSchema,
  defaultConfig: freegamesDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'channelId', label: 'Salon des annonces', type: 'channel' },
        { key: 'roleId', label: 'Rôle à mentionner', type: 'role' },
        {
          key: 'platforms',
          label: 'Plateformes suivies',
          type: 'multiselect',
          options: [
            { value: 'steam', label: 'Steam' },
            { value: 'epic', label: 'Epic Games' },
            { value: 'gog', label: 'GOG' },
          ],
        },
      ],
    },
  ],
  configPanel: freegamesPanel,
  commands: freegamesCommands,
  tasks: [freegamesTask],
});
