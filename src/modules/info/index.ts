import { defineModule } from '../../core/module.js';
import { userinfo } from './commands/userinfo.js';
import { serverinfo } from './commands/serverinfo.js';
import { avatar } from './commands/avatar.js';
import { roleinfo } from './commands/roleinfo.js';
import { emoji } from './commands/emoji.js';
import { MODULE_NAME, infoConfigSchema, infoDefaultConfig } from './config.js';
import { infoPanel } from './panel.js';
import { onUserUpdate, onGuildMemberUpdate, warmMemberCache } from './watch.js';

/**
 * Module « Commandes d'informations » : des commandes utilitaires en lecture
 * seule (`/userinfo`, `/serverinfo`, `/avatar`, `/roleinfo`, `/emoji`) et un
 * **journal des profils** optionnel qui note les changements d'identité des
 * membres (nom, nom affiché, photo de profil, pseudo serveur) dans un salon.
 * Se configure depuis le dashboard web.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.info.label',
  descriptionKey: 'modules.info.description',
  configSchema: infoConfigSchema,
  defaultConfig: infoDefaultConfig,
  configUI: [
    {
      label: '🪪 Journal des profils',
      description:
        'Note dans un salon les changements d’identité des membres (nom, photo de profil, pseudo serveur). Les commandes /userinfo, /serverinfo… restent toujours disponibles.',
      fields: [
        { key: 'watchEnabled', label: 'Activer le journal des profils', type: 'boolean' },
        { key: 'watchChannelId', label: 'Salon du journal', type: 'channel' },
        { key: 'watchUsername', label: 'Nom d’utilisateur (@handle)', type: 'boolean' },
        { key: 'watchGlobalName', label: 'Nom affiché', type: 'boolean' },
        { key: 'watchAvatar', label: 'Photo de profil', type: 'boolean' },
        { key: 'watchNickname', label: 'Pseudo serveur', type: 'boolean' },
        {
          key: 'watchRoleIds',
          label: 'Limiter à ces rôles (vide = tous les membres)',
          type: 'roles',
        },
      ],
    },
  ],
  configPanel: infoPanel,
  commands: [userinfo, serverinfo, avatar, roleinfo, emoji],
  events: [onUserUpdate, onGuildMemberUpdate],
  // Précharge le cache des membres pour capter dès le 1er changement de profil.
  onLoad: warmMemberCache,
});
