import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, streamerConfigSchema, streamerDefaultConfig } from './config.js';
import { streamerComponent } from './component.js';
import { publishStreamer } from './menu.js';
import type { StreamerConfig } from './config.js';

/**
 * Module « Mode streameur » : un panneau (embed + bouton) publié dans un salon.
 * Cliquer le bouton rend le membre sourd côté serveur (il n'entend plus Discord)
 * tout en gardant son micro actif, et lui donne un rôle « Streaming » qui sert
 * d'indicateur et alimente la liste affichée. Re-cliquer désactive.
 *
 * Nécessite l'intent GuildVoiceStates et les permissions « Rendre sourds les
 * membres » + « Gérer les rôles » (rôle du bot au-dessus du rôle Streaming).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.streamer.label',
  descriptionKey: 'modules.streamer.description',
  publishPanel: (guild, config) => publishStreamer(guild, config as StreamerConfig),
  category: 'community',
  emoji: '\u{1F3A7}',
  configSchema: streamerConfigSchema,
  defaultConfig: streamerDefaultConfig,
  configUI: () => [
    {
      label: t('modules.streamer.ui.g0.label'),
      description: t('modules.streamer.ui.g0.description'),
      fields: [
        {
          key: 'roleId',
          label: t('modules.streamer.ui.g0.champs.roleId.label'),
          type: 'role',
          help: t('modules.streamer.ui.g0.champs.roleId.help'),
        },
        {
          key: 'channelId',
          label: t('modules.streamer.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.streamer.ui.g0.champs.channelId.help'),
        },
        {
          key: 'title',
          label: t('modules.streamer.ui.g0.champs.title.label'),
          type: 'text',
          help: t('modules.streamer.ui.g0.champs.title.help'),
        },
        {
          key: 'description',
          label: t('modules.streamer.ui.g0.champs.description.label'),
          type: 'textarea',
          help: t('modules.streamer.ui.g0.champs.description.help'),
        },
      ],
    },
  ],
  componentHandler: streamerComponent,
});
