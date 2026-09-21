import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import {
  MODULE_NAME,
  messageprofilesConfigSchema,
  messageprofilesDefaultConfig,
} from './config.js';
import { messageprofilesCommands } from './commands.js';

/**
 * Module « Profils de messages » : définit des identités (pseudo + avatar) sous
 * lesquelles le staff peut faire parler le bot via `/dire`, en utilisant un
 * webhook du salon. Réservé aux membres avec la permission « Gérer les messages ».
 * Le bot a besoin de « Gérer les webhooks » dans le salon ciblé.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.messageprofiles.label',
  descriptionKey: 'modules.messageprofiles.description',
  category: 'engagement',
  emoji: '\u{1F5E8}\u{FE0F}',
  configSchema: messageprofilesConfigSchema,
  defaultConfig: messageprofilesDefaultConfig,
  configUI: () => [
    {
      label: t('modules.messageprofiles.ui.g0.label'),
      description: t('modules.messageprofiles.ui.g0.description'),
      fields: [
        {
          key: 'profiles',
          label: t('modules.messageprofiles.ui.g0.champs.profiles.label'),
          type: 'list',
          help: t('modules.messageprofiles.ui.g0.champs.profiles.help'),
          idKey: 'id',
          addLabel: t('modules.messageprofiles.ui.g0.champs.profiles.addLabel'),
          item: [
            {
              key: 'name',
              label: t('modules.messageprofiles.ui.g0.champs.profiles.item.name.label'),
              type: 'text',
            },
            {
              key: 'avatarUrl',
              label: t('modules.messageprofiles.ui.g0.champs.profiles.item.avatarUrl.label'),
              type: 'text',
              placeholder: t(
                'modules.messageprofiles.ui.g0.champs.profiles.item.avatarUrl.placeholder',
              ),
            },
          ],
        },
      ],
    },
  ],
  commands: messageprofilesCommands,
});
