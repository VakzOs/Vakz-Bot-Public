import { defineModule } from '../../core/module.js';
import { MODULE_NAME, starboardConfigSchema, starboardDefaultConfig } from './config.js';
import { starboardPanel } from './panel.js';
import { onReactionAdd, onReactionRemove } from './events.js';

/**
 * Module « Starboard » : un message qui reçoit assez d'étoiles (⭐ par défaut)
 * est republié dans un salon dédié, avec son auteur, son contenu, son image et
 * un lien vers l'original. Le compteur se met à jour en temps réel ; sous le
 * seuil, la republication est retirée. Configuration via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.starboard.label',
  descriptionKey: 'modules.starboard.description',
  configSchema: starboardConfigSchema,
  defaultConfig: starboardDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'channelId', label: 'Salon du starboard', type: 'channel' },
        { key: 'emoji', label: 'Emoji déclencheur', type: 'text' },
        { key: 'threshold', label: 'Nombre de réactions requis', type: 'number' },
        { key: 'ignoreBots', label: 'Ignorer les messages des bots', type: 'boolean' },
      ],
    },
  ],
  configPanel: starboardPanel,
  events: [onReactionAdd, onReactionRemove],
});
