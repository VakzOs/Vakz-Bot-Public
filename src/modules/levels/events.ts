import { Events, type User } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getLevelsConfig } from './config.js';
import { applyRewardRoles, awardXp, hasIgnoredRole, xpMultiplierFor } from './service.js';

function formatAnnounce(template: string, user: User, serverName: string, level: number): string {
  return template
    .replaceAll('{mention}', `<@${user.id}>`)
    .replaceAll('{username}', user.username)
    .replaceAll('{server}', serverName)
    .replaceAll('{level}', String(level));
}

/** Gain d'XP à chaque message, et annonce + rôles récompense en cas de level-up. */
export const onMessage = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.inGuild() || message.author.bot || message.system) return;

    const guildId = message.guildId;
    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) return;

    const config = await getLevelsConfig(ctx, guildId);
    if (config.ignoredChannelIds.includes(message.channelId)) return;

    const member =
      message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (member && hasIgnoredRole(member, config)) return;

    const multiplier = member ? xpMultiplierFor(member, config) : 1;
    const result = await awardXp(ctx, guildId, message.author.id, config, { multiplier });
    if (!result || !result.leveledUp) return;

    if (member) {
      await applyRewardRoles(ctx, member, config, result.newLevel);
    }

    if (!config.announce.enabled) return;

    const channel = config.announce.channelId
      ? await message.guild.channels.fetch(config.announce.channelId).catch(() => null)
      : message.channel;

    if (channel?.isTextBased()) {
      await channel
        .send({
          content: formatAnnounce(
            config.announce.message,
            message.author,
            message.guild.name,
            result.newLevel,
          ),
          allowedMentions: { users: [message.author.id] },
        })
        .catch(() => undefined);
    }
  },
});
