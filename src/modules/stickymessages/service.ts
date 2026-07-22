import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { Colors } from '../../lib/embeds.js';
import { type StickyMessage, findSticky, getStickymessagesConfig, upsertSticky } from './config.js';

/** Délai d'apaisement : on regroupe les rafales de messages en un seul repost. */
const REPOST_DELAY_MS = 3_000;

/** Timers de repost en cours, un par salon (coalescing des rafales). */
const pending = new Map<string, NodeJS.Timeout>();

/** Construit le message à (re)poster pour un sticky. */
export function buildStickyMessage(sticky: StickyMessage): MessageCreateOptions {
  if (sticky.embed) {
    return {
      embeds: [new EmbedBuilder().setColor(Colors.info).setDescription(sticky.content)],
      allowedMentions: { parse: [] },
    };
  }
  return { content: sticky.content, allowedMentions: { parse: [] } };
}

/**
 * (Re)poste le sticky d'un salon : supprime l'ancien message du bot puis en
 * envoie un nouveau, et mémorise son id. Tolérant aux erreurs (salon supprimé,
 * message déjà effacé, permissions manquantes).
 */
export async function repostSticky(
  ctx: BotContext,
  guildId: string,
  channelId: string,
): Promise<void> {
  const config = await getStickymessagesConfig(ctx, guildId);
  const sticky = findSticky(config, channelId);
  if (!sticky || !sticky.content) return;

  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased() || !('send' in channel)) return;

  if (sticky.lastMessageId) {
    await channel.messages.delete(sticky.lastMessageId).catch(() => undefined);
  }

  const sent = await channel.send(buildStickyMessage(sticky)).catch((error: unknown) => {
    ctx.logger.warn({ err: error, guildId, channelId }, 'Repost du sticky échoué');
    return null;
  });
  if (!sent) return;

  await upsertSticky(ctx, guildId, channelId, { lastMessageId: sent.id });
}

/**
 * Planifie un repost différé pour un salon (debounce). Un nouveau message
 * réarme le minuteur : le sticky ne remonte qu'une fois la discussion apaisée.
 */
export function scheduleRepost(ctx: BotContext, guildId: string, channelId: string): void {
  const existing = pending.get(channelId);
  if (existing) clearTimeout(existing);
  pending.set(
    channelId,
    setTimeout(() => {
      pending.delete(channelId);
      void repostSticky(ctx, guildId, channelId);
    }, REPOST_DELAY_MS),
  );
}

/** Annule un repost en attente (ex. sticky supprimé). */
export function cancelRepost(channelId: string): void {
  const existing = pending.get(channelId);
  if (existing) {
    clearTimeout(existing);
    pending.delete(channelId);
  }
}
