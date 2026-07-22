import { defineModule } from '../../core/module.js';
import { MODULE_NAME, stickymessagesConfigSchema, stickymessagesDefaultConfig } from './config.js';
import { stickymessagesPanel } from './panel.js';
import { onMessage } from './events.js';

/**
 * Module « Messages épinglés » (sticky) : un message reste toujours en bas d'un
 * salon. À chaque nouveau message, le bot supprime son ancien sticky et le
 * re-poste (avec un léger délai d'apaisement pour regrouper les rafales).
 * Configuration par salon via `/config` (texte ou embed).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.stickymessages.label',
  descriptionKey: 'modules.stickymessages.description',
  configSchema: stickymessagesConfigSchema,
  defaultConfig: stickymessagesDefaultConfig,
  configUI: [
    {
      label: '📌 Messages épinglés',
      description: 'Un message re-posté automatiquement en bas du salon à chaque discussion.',
      fields: [
        {
          key: 'stickies',
          label: 'Messages',
          type: 'list',
          addLabel: 'Ajouter un message',
          item: [
            { key: 'channelId', label: 'Salon', type: 'channel' },
            { key: 'content', label: 'Contenu', type: 'textarea' },
            { key: 'embed', label: 'En embed', type: 'boolean' },
          ],
        },
      ],
    },
  ],
  configPanel: stickymessagesPanel,
  events: [onMessage],
});
