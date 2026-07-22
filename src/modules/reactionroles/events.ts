import {
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  PermissionFlagsBits,
  type User,
} from 'discord.js';
import { type BotContext, defineEvent } from '../../core/module.js';
import { MODULE_NAME, getReactionRolesConfig } from './config.js';
import { roleForReaction } from './menu.js';

/**
 * Attribue (ajout de réaction) ou retire (retrait de réaction) le rôle associé
 * à l'emoji, sur le message de menu configuré. La présence de la réaction = le
 * membre possède le rôle (comportement « rôles-réactions » classique).
 */
async function handleReaction(
  ctx: BotContext,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  add: boolean,
): Promise<void> {
  if (user.bot) return;
  try {
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const guild = message.guild;
    if (!guild) return;
    if (!(await ctx.config.isEnabled(guild.id, MODULE_NAME))) return;

    const config = await getReactionRolesConfig(ctx, guild.id);
    if (!config.messageId || message.id !== config.messageId) return;

    const roleId = roleForReaction(config, { id: reaction.emoji.id, name: reaction.emoji.name });
    if (!roleId) return;

    const role =
      guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    const me = guild.members.me;
    if (
      !role ||
      !me ||
      !me.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.position >= me.roles.highest.position
    ) {
      return;
    }

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (add) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, 'Rôle-réaction');
      }
    } else if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Rôle-réaction');
    }
  } catch (error) {
    ctx.logger.warn({ err: error }, 'Rôles-réactions : échec du traitement de réaction');
  }
}

/** Un membre réagit → on lui attribue le rôle. */
export const onReactionAdd = defineEvent({
  name: Events.MessageReactionAdd,
  execute: (ctx, reaction, user) => handleReaction(ctx, reaction, user, true),
});

/** Un membre retire sa réaction → on lui retire le rôle. */
export const onReactionRemove = defineEvent({
  name: Events.MessageReactionRemove,
  execute: (ctx, reaction, user) => handleReaction(ctx, reaction, user, false),
});
