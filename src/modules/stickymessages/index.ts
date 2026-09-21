import { defineModule } from '../../core/module.js';
import { stickymessagesActions } from './actions.js';
import {
  MODULE_NAME,
  type StickymessagesConfig,
  stickymessagesConfigSchema,
  stickymessagesDefaultConfig,
} from './config.js';
import { onMessage } from './events.js';
import { cleanupRemovedStickies } from './service.js';

/**
 * Module « Messages épinglés » (sticky) : un message reste toujours en bas d'un
 * salon. À chaque nouveau message, le bot supprime son ancien sticky et le
 * re-poste (avec un léger délai d'apaisement pour regrouper les rafales).
 * Configuration par salon depuis le dashboard (texte ou embed).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.stickymessages.label',
  descriptionKey: 'modules.stickymessages.description',
  category: 'community',
  emoji: '\u{1F4CC}',
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
  actions: stickymessagesActions,
  events: [onMessage],
  async onConfigSaved(ctx, guildId, config, previous) {
    await cleanupRemovedStickies(
      ctx,
      guildId,
      config as StickymessagesConfig,
      previous as StickymessagesConfig,
    );
  },
});
