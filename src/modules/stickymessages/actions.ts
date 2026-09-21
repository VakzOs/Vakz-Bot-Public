import type { ConfigField, ModuleAction } from '../../core/module.js';
import { getStickymessagesConfig } from './config.js';
import { repostSticky } from './service.js';

/** Repositionne tout de suite un message épinglé en bas de son salon. */
const repost: ModuleAction = {
  id: 'repost',
  label: 'Republier un message',
  help: 'Supprime l’ancien message collant et le republie en bas du salon.',
  style: 'secondary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { stickies } = await getStickymessagesConfig(ctx, guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    return [
      {
        key: 'channelId',
        label: 'Salon',
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
      return { ok: false, message: 'Choisis un salon disposant d’un message collant.' };
    }
    await repostSticky(ctx, guildId, channelId);
    return { ok: true, message: 'Message collant republié.' };
  },
};

export const stickymessagesActions: ModuleAction[] = [repost];
