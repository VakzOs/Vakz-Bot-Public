import type { ConfigField, ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getStickymessagesConfig } from './config.js';
import { repostSticky } from './service.js';

/** Repositionne tout de suite un message épinglé en bas de son salon. */
const repost = (): ModuleAction => ({
  id: 'repost',
  label: t('modules.stickymessages.actions.repost.label'),
  help: t('modules.stickymessages.actions.repost.help'),
  style: 'secondary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { stickies } = await getStickymessagesConfig(ctx, guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    return [
      {
        key: 'channelId',
        label: t('modules.stickymessages.actions.repost.champs.channelId'),
        type: 'select',
        options: stickies.map((sticky) => ({
          value: sticky.channelId,
          label: `#${guild?.channels.cache.get(sticky.channelId)?.name ?? sticky.channelId}`,
        })),
      },
    ];
  },
  async run({ ctx, guildId, input }) {
    const channelId = typeof input.channelId === 'string' ? input.channelId : '';
    const { stickies } = await getStickymessagesConfig(ctx, guildId);
    if (!stickies.some((sticky) => sticky.channelId === channelId)) {
      return { ok: false, message: t('modules.stickymessages.actions.msg.pickChannel') };
    }
    await repostSticky(ctx, guildId, channelId);
    return { ok: true, message: t('modules.stickymessages.actions.repost.msg.done') };
  },
});

export const stickymessagesActions = (): ModuleAction[] => [repost()];
