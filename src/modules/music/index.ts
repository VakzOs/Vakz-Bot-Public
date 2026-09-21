import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import {
  MODULE_NAME,
  SEARCH_PLATFORMS,
  musicConfigSchema,
  musicDefaultConfig,
  searchPlatformLabel,
} from './config.js';
import { musicCommands } from './commands.js';
import { initMusicManager } from './manager.js';

/**
 * Module « Musique » : lecture audio dans les salons vocaux via un serveur
 * Lavalink (YouTube, SoundCloud, et Spotify/Deezer avec le plugin LavaSrc).
 * Commandes : /play, /skip, /stop, /pause, /resume, /queue, /nowplaying,
 * /volume, /loop, /shuffle, /seek, /remove, /disconnect.
 *
 * Le module ne s'active que si un serveur Lavalink est configuré côté hôte
 * (variables `LAVALINK_*`) ; sinon les commandes répondent qu'il n'est pas
 * disponible. Le gestionnaire Lavalink est initialisé au chargement (onLoad),
 * une fois le client prêt.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.music.label',
  descriptionKey: 'modules.music.description',
  category: 'fun',
  emoji: '\u{1F3B5}',
  configSchema: musicConfigSchema,
  defaultConfig: musicDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'djRoleId',
          label: t('modules.music.ui.g0.champs.djRoleId.label'),
          type: 'role',
          help: t('modules.music.ui.g0.champs.djRoleId.help'),
        },
        {
          key: 'defaultSearch',
          label: t('modules.music.ui.g0.champs.defaultSearch.label'),
          type: 'select',
          help: t('modules.music.ui.g0.champs.defaultSearch.help'),
          options: SEARCH_PLATFORMS.map((platform) => ({
            value: platform,
            label: searchPlatformLabel(platform),
          })),
        },
        {
          key: 'defaultVolume',
          label: t('modules.music.ui.g0.champs.defaultVolume.label'),
          type: 'number',
          help: t('modules.music.ui.g0.champs.defaultVolume.help'),
        },
        {
          key: 'maxVolume',
          label: t('modules.music.ui.g0.champs.maxVolume.label'),
          type: 'number',
          help: t('modules.music.ui.g0.champs.maxVolume.help'),
        },
        {
          key: 'requireSameChannel',
          label: t('modules.music.ui.g0.champs.requireSameChannel.label'),
          type: 'boolean',
          help: t('modules.music.ui.g0.champs.requireSameChannel.help'),
        },
        {
          key: 'autoLeave',
          label: t('modules.music.ui.g0.champs.autoLeave.label'),
          type: 'boolean',
          help: t('modules.music.ui.g0.champs.autoLeave.help'),
        },
      ],
    },
  ],
  commands: musicCommands,
  async onLoad(ctx) {
    await initMusicManager(ctx);
  },
});
