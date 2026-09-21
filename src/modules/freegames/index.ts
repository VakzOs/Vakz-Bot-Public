import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { freegamesActions } from './actions.js';
import { MODULE_NAME, freegamesConfigSchema, freegamesDefaultConfig } from './config.js';
import { freegamesCommands } from './commands.js';
import { freegamesTask } from './task.js';

/**
 * Module « Jeux gratuits » : surveille les jeux qui deviennent gratuits à garder
 * sur Steam, Epic Games et GOG (plateformes sélectionnables par serveur) et les
 * annonce dans un salon configuré, avec mention de rôle optionnelle.
 * `/jeux-gratuits` liste les offres du moment, toutes plateformes confondues.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.freegames.label',
  descriptionKey: 'modules.freegames.description',
  category: 'operations',
  emoji: '\u{1F579}\u{FE0F}',
  configSchema: freegamesConfigSchema,
  defaultConfig: freegamesDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'channelId',
          label: t('modules.freegames.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.freegames.ui.g0.champs.channelId.help'),
        },
        {
          key: 'roleId',
          label: t('modules.freegames.ui.g0.champs.roleId.label'),
          type: 'role',
          help: t('modules.freegames.ui.g0.champs.roleId.help'),
        },
        {
          key: 'platforms',
          label: t('modules.freegames.ui.g0.champs.platforms.label'),
          type: 'multiselect',
          help: t('modules.freegames.ui.g0.champs.platforms.help'),
          options: [
            {
              value: 'steam',
              label: t('modules.freegames.ui.g0.champs.platforms.opt.steam.label'),
            },
            { value: 'epic', label: t('modules.freegames.ui.g0.champs.platforms.opt.epic.label') },
            { value: 'gog', label: t('modules.freegames.ui.g0.champs.platforms.opt.gog.label') },
          ],
        },
      ],
    },
  ],
  actions: freegamesActions,
  commands: freegamesCommands,
  tasks: [freegamesTask],
});
