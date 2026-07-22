import type { APIEmbed, Message, PartialMessage } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import {
  buildMessageRollback,
  messageRollbackHasData,
  type MessageAttachmentSnapshot,
  type MessageRollbackPayload,
} from './rollback.js';
import { isLogCategoryEnabled } from './service.js';

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function saveMessageSnapshot(
  ctx: BotContext,
  message: Message | PartialMessage,
): Promise<void> {
  if (!message.guild || !(await isLogCategoryEnabled(ctx, message.guild.id, 'messages'))) return;

  const payload = buildMessageRollback(message);
  if (!messageRollbackHasData(payload)) return;

  await ctx.db.logMessageSnapshot
    .upsert({
      where: { id: message.id },
      create: {
        id: message.id,
        guildId: message.guild.id,
        channelId: payload.channelId,
        authorId: payload.authorId,
        authorName: payload.authorName,
        authorTag: payload.authorTag,
        authorAvatarUrl: payload.authorAvatarUrl,
        content: payload.content,
        embeds: JSON.stringify(payload.embeds ?? []),
        attachments: JSON.stringify(payload.attachments),
      },
      update: {
        guildId: message.guild.id,
        channelId: payload.channelId,
        authorId: payload.authorId,
        authorName: payload.authorName,
        authorTag: payload.authorTag,
        authorAvatarUrl: payload.authorAvatarUrl,
        content: payload.content,
        embeds: JSON.stringify(payload.embeds ?? []),
        attachments: JSON.stringify(payload.attachments),
      },
    })
    .catch(() => undefined);
}

export async function loadMessageSnapshot(
  ctx: BotContext,
  guildId: string,
  messageId: string,
): Promise<MessageRollbackPayload | null> {
  const record = await ctx.db.logMessageSnapshot.findUnique({ where: { id: messageId } });
  if (!record || record.guildId !== guildId) return null;

  return {
    channelId: record.channelId,
    authorId: record.authorId,
    authorName: record.authorName,
    authorTag: record.authorTag,
    authorAvatarUrl: record.authorAvatarUrl,
    content: record.content,
    embeds: parseJsonArray<APIEmbed>(record.embeds),
    attachments: parseJsonArray<MessageAttachmentSnapshot>(record.attachments),
  };
}

export async function deleteMessageSnapshot(ctx: BotContext, messageId: string): Promise<void> {
  await ctx.db.logMessageSnapshot.delete({ where: { id: messageId } }).catch(() => undefined);
}

/**
 * Durée de rétention des snapshots de messages. Un snapshot ne sert qu'à
 * restaurer un message supprimé peu après ; au-delà, il n'a plus d'utilité et
 * ne ferait qu'alourdir la base (et conserver du contenu inutilement).
 */
export const SNAPSHOT_RETENTION_MS = 48 * 60 * 60 * 1000;

/** Purge les snapshots de messages plus vieux que la durée de rétention. */
export async function pruneMessageSnapshots(ctx: BotContext): Promise<void> {
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_MS);
  await ctx.db.logMessageSnapshot
    .deleteMany({ where: { updatedAt: { lt: cutoff } } })
    .catch(() => undefined);
}
