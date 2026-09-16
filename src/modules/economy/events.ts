import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getEconomyConfig } from './config.js';
import { earnFromMessage, hasIgnoredRole } from './service.js';

/** Gain de monnaie à chaque message (avec cooldown anti-spam), hors exclusions. */
export const onMessage = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    if (!(await ctx.config.isEnabled(message.guildId, MODULE_NAME))) return;
    const config = await getEconomyConfig(ctx, message.guildId);
    if (config.ignoredChannelIds.includes(message.channelId)) return;
    if (message.member && hasIgnoredRole(message.member, config)) return;
    await earnFromMessage(ctx, message.guildId, message.author.id, config);
  },
});
