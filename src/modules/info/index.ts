import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { userinfo } from './commands/userinfo.js';
import { serverinfo } from './commands/serverinfo.js';
import { avatar } from './commands/avatar.js';
import { roleinfo } from './commands/roleinfo.js';
import { emoji } from './commands/emoji.js';
import { MODULE_NAME, infoConfigSchema, infoDefaultConfig } from './config.js';
import { onUserUpdate, onGuildMemberUpdate, warmMemberCache } from './watch.js';

/**
 * Module « Commandes d'informations » : des commandes utilitaires en lecture
 * seule (`/infos-membre`, `/infos-serveur`, `/avatar`, `/infos-role`, `/emoji`) et un
 * **journal des profils** optionnel qui note les changements d'identité des
 * membres (nom, nom affiché, photo de profil, pseudo serveur) dans un salon.
 * Se configure depuis le dashboard web.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.info.label',
  descriptionKey: 'modules.info.description',
  category: 'operations',
  emoji: '\u{2139}\u{FE0F}',
  configSchema: infoConfigSchema,
  defaultConfig: infoDefaultConfig,
  configUI: () => [
    {
      label: t('modules.info.ui.g0.label'),
      description: t('modules.info.ui.g0.description'),
      fields: [
        {
          key: 'watchEnabled',
          label: t('modules.info.ui.g0.champs.watchEnabled.label'),
          type: 'boolean',
          help: t('modules.info.ui.g0.champs.watchEnabled.help'),
        },
        {
          key: 'watchChannelId',
          label: t('modules.info.ui.g0.champs.watchChannelId.label'),
          type: 'channel',
          help: t('modules.info.ui.g0.champs.watchChannelId.help'),
        },
        {
          key: 'watchUsername',
          label: t('modules.info.ui.g0.champs.watchUsername.label'),
          type: 'boolean',
          help: t('modules.info.ui.g0.champs.watchUsername.help'),
        },
        {
          key: 'watchGlobalName',
          label: t('modules.info.ui.g0.champs.watchGlobalName.label'),
          type: 'boolean',
          help: t('modules.info.ui.g0.champs.watchGlobalName.help'),
        },
        {
          key: 'watchAvatar',
          label: t('modules.info.ui.g0.champs.watchAvatar.label'),
          type: 'boolean',
          help: t('modules.info.ui.g0.champs.watchAvatar.help'),
        },
        {
          key: 'watchNickname',
          label: t('modules.info.ui.g0.champs.watchNickname.label'),
          type: 'boolean',
          help: t('modules.info.ui.g0.champs.watchNickname.help'),
        },
        {
          key: 'watchRoleIds',
          label: t('modules.info.ui.g0.champs.watchRoleIds.label'),
          type: 'roles',
          help: t('modules.info.ui.g0.champs.watchRoleIds.help'),
        },
      ],
    },
  ],
  commands: [userinfo, serverinfo, avatar, roleinfo, emoji],
  events: [onUserUpdate, onGuildMemberUpdate],
  // Précharge le cache des membres pour capter dès le 1er changement de profil.
  onLoad: warmMemberCache,
});
