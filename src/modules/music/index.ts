import { defineModule } from '../../core/module.js';
import { MODULE_NAME, SEARCH_PLATFORMS, musicConfigSchema, musicDefaultConfig } from './config.js';
import { musicCommands } from './commands.js';
import { musicPanel } from './panel.js';
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
  configSchema: musicConfigSchema,
  defaultConfig: musicDefaultConfig,
  configUI: [
    {
      fields: [
        {
          key: 'djRoleId',
          label: 'Rôle DJ (contrôle réservé — vide = tout le monde)',
          type: 'role',
        },
        {
          key: 'defaultSearch',
          label: 'Plateforme de recherche par défaut',
          type: 'select',
          options: SEARCH_PLATFORMS.map((platform) => ({
            value: platform.value,
            label: platform.label,
          })),
        },
        { key: 'defaultVolume', label: 'Volume par défaut (1-100)', type: 'number' },
        { key: 'maxVolume', label: 'Volume maximum (1-150)', type: 'number' },
        {
          key: 'requireSameChannel',
          label: 'Exiger d’être dans le même salon vocal pour contrôler',
          type: 'boolean',
        },
        { key: 'autoLeave', label: 'Quitter automatiquement en fin de file', type: 'boolean' },
      ],
    },
  ],
  configPanel: musicPanel,
  commands: musicCommands,
  async onLoad(ctx) {
    await initMusicManager(ctx);
  },
});
