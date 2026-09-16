import {
  Events,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import { defineEvent } from '../../core/module.js';
import type { BotContext } from '../../core/module.js';
import { MODULE_NAME, getStarboardConfig } from './config.js';
import { emojiMatches, syncStarboard } from './service.js';

async function handleReaction(
  ctx: BotContext,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  if (user.bot) return;
  try {
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (!message.guild) return;
    if (!(await ctx.config.isEnabled(message.guild.id, MODULE_NAME))) return;

    const config = await getStarboardConfig(ctx, message.guild.id);
    // Pas de salon configuré, ou réaction dans le starboard lui-même : on ignore.
    if (!config.channelId || message.channelId === config.channelId) return;
    if (!emojiMatches(config.emoji, reaction.emoji.name, reaction.emoji.id)) return;
    if (config.ignoreBots && message.author?.bot) return;

    // On recompte depuis le message (robuste à l'ajout comme au retrait).
    const matching = message.reactions.cache.find((rc) =>
      emojiMatches(config.emoji, rc.emoji.name, rc.emoji.id),
    );
    await syncStarboard(ctx, message, matching?.count ?? 0, config);
  } catch (error) {
    ctx.logger.warn({ err: error }, 'Starboard : échec du traitement de réaction');
  }
}

/** Ajout d'une étoile sur un message. */
export const onReactionAdd = defineEvent({
  name: Events.MessageReactionAdd,
  execute: (ctx, reaction, user) => handleReaction(ctx, reaction, user),
});

/** Retrait d'une étoile sur un message. */
export const onReactionRemove = defineEvent({
  name: Events.MessageReactionRemove,
  execute: (ctx, reaction, user) => handleReaction(ctx, reaction, user),
});
