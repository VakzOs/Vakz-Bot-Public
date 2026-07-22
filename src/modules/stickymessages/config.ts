import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'stickymessages';

/** Un message épinglé « collant » attaché à un salon. */
const stickySchema = z.object({
  channelId: z.string(),
  content: z.string().min(1).max(2000),
  /** Poster en embed plutôt qu'en texte brut. */
  embed: z.boolean().default(false),
  /** Id du dernier message posté par le bot (pour le supprimer avant repost). */
  lastMessageId: z.string().nullable().default(null),
});

export type StickyMessage = z.infer<typeof stickySchema>;

export const stickymessagesConfigSchema = z.object({
  stickies: z.array(stickySchema).max(50).default([]),
});

export type StickymessagesConfig = z.infer<typeof stickymessagesConfigSchema>;

export const stickymessagesDefaultConfig: StickymessagesConfig = { stickies: [] };

export async function getStickymessagesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<StickymessagesConfig> {
  const state = await ctx.config.getModuleState<StickymessagesConfig>(
    guildId,
    MODULE_NAME,
    stickymessagesConfigSchema,
  );
  return state.config;
}

async function setStickies(
  ctx: BotContext,
  guildId: string,
  stickies: StickyMessage[],
): Promise<void> {
  await ctx.config.setConfig(guildId, MODULE_NAME, { stickies });
}

/** Sticky d'un salon donné, ou `undefined`. */
export function findSticky(
  config: StickymessagesConfig,
  channelId: string,
): StickyMessage | undefined {
  return config.stickies.find((sticky) => sticky.channelId === channelId);
}

/** Crée ou met à jour le sticky d'un salon et le persiste. */
export async function upsertSticky(
  ctx: BotContext,
  guildId: string,
  channelId: string,
  patch: Partial<Omit<StickyMessage, 'channelId'>>,
): Promise<StickyMessage> {
  const config = await getStickymessagesConfig(ctx, guildId);
  const existing = findSticky(config, channelId);
  const updated: StickyMessage = {
    channelId,
    content: patch.content ?? existing?.content ?? '',
    embed: patch.embed ?? existing?.embed ?? false,
    lastMessageId:
      patch.lastMessageId !== undefined ? patch.lastMessageId : (existing?.lastMessageId ?? null),
  };
  const stickies = [...config.stickies.filter((sticky) => sticky.channelId !== channelId), updated];
  await setStickies(ctx, guildId, stickies);
  return updated;
}

/** Supprime le sticky d'un salon. Renvoie l'id du dernier message posté, s'il existe. */
export async function removeSticky(
  ctx: BotContext,
  guildId: string,
  channelId: string,
): Promise<string | null> {
  const config = await getStickymessagesConfig(ctx, guildId);
  const existing = findSticky(config, channelId);
  await setStickies(
    ctx,
    guildId,
    config.stickies.filter((sticky) => sticky.channelId !== channelId),
  );
  return existing?.lastMessageId ?? null;
}
