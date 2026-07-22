import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getWordreactionsConfig } from './config.js';
import { reactToMessage } from './service.js';

/**
 * À chaque message, ajoute les réactions des règles correspondantes. Ignore les
 * bots, les messages système et les serveurs où le module est désactivé.
 */
export const onMessage = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    if (!(await ctx.config.isEnabled(message.guildId, MODULE_NAME))) return;

    const config = await getWordreactionsConfig(ctx, message.guildId);
    if (config.rules.length === 0) return;

    await reactToMessage(ctx, message, config.rules);
  },
});
