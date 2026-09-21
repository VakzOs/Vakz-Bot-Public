import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
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
  configUI: () => [
    {
      label: t('modules.stickymessages.ui.g0.label'),
      description: t('modules.stickymessages.ui.g0.description'),
      fields: [
        {
          key: 'stickies',
          label: t('modules.stickymessages.ui.g0.champs.stickies.label'),
          type: 'list',
          help: t('modules.stickymessages.ui.g0.champs.stickies.help'),
          addLabel: t('modules.stickymessages.ui.g0.champs.stickies.addLabel'),
          item: [
            {
              key: 'channelId',
              label: t('modules.stickymessages.ui.g0.champs.stickies.item.channelId.label'),
              type: 'channel',
            },
            {
              key: 'content',
              label: t('modules.stickymessages.ui.g0.champs.stickies.item.content.label'),
              type: 'textarea',
            },
            {
              key: 'embed',
              label: t('modules.stickymessages.ui.g0.champs.stickies.item.embed.label'),
              type: 'boolean',
            },
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
