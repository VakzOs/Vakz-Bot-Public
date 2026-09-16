import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'wordreactions';

/** Nombre maximal de règles par serveur. */
export const MAX_RULES = 30;
/** Emoji personnalisé (`<:nom:id>` ou `<a:nom:id>`). */
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;
/** Emoji unicode. */
const UNICODE_EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Un emoji utilisable en réaction. Vérifié ici : le dashboard laisse saisir du
 * texte libre, et un emoji invalide serait silencieusement ignoré à l'exécution.
 */
export function isReactionEmoji(value: string): boolean {
  return CUSTOM_EMOJI.test(value) || UNICODE_EMOJI.test(value);
}

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
  emojis: z
    .array(z.string().min(1).max(64).refine(isReactionEmoji, { message: 'Emoji invalide' }))
    .min(1)
    .max(MAX_EMOJIS),
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
