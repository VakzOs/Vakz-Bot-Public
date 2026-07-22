import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { getAutomodConfig, MODULE_NAME } from './config.js';
import {
  applyViolation,
  findViolation,
  handleHoneypotMessage,
  isAutomodBypassed,
} from './service.js';

export const onMessage = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.inGuild() || message.author.bot || message.system) return;
    if (!(await ctx.config.isEnabled(message.guildId, MODULE_NAME))) return;

    const config = await getAutomodConfig(ctx, message.guildId);
    const handledByHoneypot = await handleHoneypotMessage(ctx, message, config);
    if (handledByHoneypot) return;

    const member =
      message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member || isAutomodBypassed(member, config)) return;

    const violation = findViolation(message, config);
    if (!violation) return;

    await applyViolation(ctx, message, config, violation);
  },
});
