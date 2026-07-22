import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'starboard';

/**
 * Configuration du module « Starboard » : salon où republier les messages
 * populaires, emoji déclencheur, seuil d'étoiles et exclusion des bots.
 */
export const starboardConfigSchema = z.object({
  channelId: z.string().nullable().default(null),
  emoji: z.string().min(1).max(64).default('⭐'),
  threshold: z.number().int().min(1).max(100).default(3),
  ignoreBots: z.boolean().default(true),
});

export type StarboardConfig = z.infer<typeof starboardConfigSchema>;

export const starboardDefaultConfig: StarboardConfig = {
  channelId: null,
  emoji: '⭐',
  threshold: 3,
  ignoreBots: true,
};

export async function getStarboardConfig(
  ctx: BotContext,
  guildId: string,
): Promise<StarboardConfig> {
  const state = await ctx.config.getModuleState<StarboardConfig>(
    guildId,
    MODULE_NAME,
    starboardConfigSchema,
  );
  return state.config;
}

export async function updateStarboardConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<StarboardConfig>,
): Promise<StarboardConfig> {
  const current = await getStarboardConfig(ctx, guildId);
  const updated: StarboardConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
