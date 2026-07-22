import { defineModule } from '../../core/module.js';
import { MODULE_NAME, streamerConfigSchema, streamerDefaultConfig } from './config.js';
import { streamerPanel } from './panel.js';
import { streamerComponent } from './component.js';

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
  configSchema: streamerConfigSchema,
  defaultConfig: streamerDefaultConfig,
  configUI: [
    {
      label: '🎥 Mode streameur',
      description: 'Après modification, republie le panneau depuis Discord (/config).',
      fields: [
        { key: 'roleId', label: 'Rôle « en stream »', type: 'role' },
        { key: 'channelId', label: 'Salon du panneau', type: 'channel' },
        { key: 'title', label: 'Titre du panneau', type: 'text' },
        { key: 'description', label: 'Description du panneau', type: 'textarea' },
      ],
    },
  ],
  configPanel: streamerPanel,
  componentHandler: streamerComponent,
});
