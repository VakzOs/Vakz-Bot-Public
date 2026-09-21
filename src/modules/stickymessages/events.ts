import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, findSticky, getStickymessagesConfig } from './config.js';
import { scheduleRepost } from './service.js';

/**
 * À chaque message dans un salon doté d'un sticky, planifie un repost différé
 * pour le faire remonter en bas. Ignore les messages du bot lui-même (le repost
 * du sticky en fait partie) afin d'éviter toute boucle.
 */
export const onMessage = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.inGuild() || message.author.id === ctx.client.user?.id) return;
    if (!(await ctx.config.isEnabled(message.guildId, MODULE_NAME))) return;

    const config = await getStickymessagesConfig(ctx, message.guildId);
    if (!findSticky(config, message.channelId)) return;

    scheduleRepost(ctx, message.guildId, message.channelId);
  },
});
