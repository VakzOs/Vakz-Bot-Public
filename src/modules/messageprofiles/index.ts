import { defineModule } from '../../core/module.js';
import {
  MODULE_NAME,
  messageprofilesConfigSchema,
  messageprofilesDefaultConfig,
} from './config.js';
import { messageprofilesCommands } from './commands.js';
import { messageprofilesPanel } from './panel.js';

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
  configSchema: messageprofilesConfigSchema,
  defaultConfig: messageprofilesDefaultConfig,
  configUI: [
    {
      label: '🗨️ Profils de messages',
      description: 'Personas (nom + avatar) utilisables avec la commande /dire.',
      fields: [
        {
          key: 'profiles',
          label: 'Profils',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un profil',
          item: [
            { key: 'name', label: 'Nom', type: 'text' },
            {
              key: 'avatarUrl',
              label: 'URL de l’avatar',
              type: 'text',
              placeholder: 'https://…',
            },
          ],
        },
      ],
    },
  ],
  configPanel: messageprofilesPanel,
  commands: messageprofilesCommands,
});
