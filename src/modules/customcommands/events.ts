import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getCustomcommandsConfig } from './config.js';
import { findMatch, runCommand } from './service.js';

/**
 * À chaque message, cherche une commande personnalisée correspondante et la
 * déclenche. Ignore les bots, les messages système et les serveurs où le module
 * est désactivé (test le moins coûteux d'abord).
 */
export const onMessage = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    if (!(await ctx.config.isEnabled(message.guildId, MODULE_NAME))) return;

    const config = await getCustomcommandsConfig(ctx, message.guildId);
    if (config.commands.length === 0) return;

    const command = findMatch(message, config.commands);
    if (!command) return;

    await runCommand(ctx, message, command);
  },
});
