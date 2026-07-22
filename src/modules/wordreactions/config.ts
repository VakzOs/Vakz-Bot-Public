import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'wordreactions';

/** Nombre maximal de règles par serveur. */
export const MAX_RULES = 30;
/** Nombre maximal d'emojis par règle. */
export const MAX_EMOJIS = 3;

/** Manières de comparer le message au déclencheur. */
export const MATCH_TYPES = ['contains', 'word', 'exact', 'startsWith', 'endsWith'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

/**
 * Une réaction de mot : quand un message correspond au `trigger` (selon
 * `match`), le bot ajoute automatiquement les `emojis` en réaction.
 * Facultativement limitée à un salon.
 */
export const wordReactionSchema = z.object({
  id: z.string(),
  trigger: z.string().min(1).max(100),
  match: z.enum(MATCH_TYPES).default('word'),
  emojis: z.array(z.string().min(1).max(64)).min(1).max(MAX_EMOJIS),
  channelId: z.string().nullable().default(null),
});

export type WordReaction = z.infer<typeof wordReactionSchema>;

export const wordreactionsConfigSchema = z.object({
  rules: z.array(wordReactionSchema).max(MAX_RULES).default([]),
});

export type WordreactionsConfig = z.infer<typeof wordreactionsConfigSchema>;

export const wordreactionsDefaultConfig: WordreactionsConfig = { rules: [] };

export async function getWordreactionsConfig(
  ctx: BotContext,
  guildId: string,
): Promise<WordreactionsConfig> {
  const state = await ctx.config.getModuleState<WordreactionsConfig>(
    guildId,
    MODULE_NAME,
    wordreactionsConfigSchema,
  );
  return state.config;
}

export async function updateWordreactionsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<WordreactionsConfig>,
): Promise<WordreactionsConfig> {
  const current = await getWordreactionsConfig(ctx, guildId);
  const updated: WordreactionsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
