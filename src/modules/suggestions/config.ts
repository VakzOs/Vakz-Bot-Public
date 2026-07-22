import { z } from 'zod';
import type { GuildMember } from 'discord.js';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'suggestions';

const roleLimitSchema = z.object({
  roleId: z.string(),
  /** Nombre de suggestions en attente autorisées (0 = illimité). */
  limit: z.number().int().min(0).max(100),
});

/**
 * Configuration du module « Suggestions » : salons autorisés, rôle staff,
 * fil auto, limites par membre/rôle, récompenses à l'approbation et couleur
 * d'embed dynamique selon l'orientation des votes.
 */
export const suggestionsConfigSchema = z.object({
  channelIds: z.array(z.string()).max(25).default([]),
  staffRoleId: z.string().nullable().default(null),
  createThread: z.boolean().default(false),
  /** Limite de suggestions en attente par membre (0 = illimité). */
  maxPending: z.number().int().min(0).max(100).default(0),
  /** Limites spécifiques par rôle (priment sur la limite par défaut). */
  roleLimits: z.array(roleLimitSchema).max(25).default([]),
  /** Pièces offertes à l'auteur quand sa suggestion est approuvée. */
  rewardCoins: z.number().int().min(0).max(1_000_000).default(0),
  /** Objet offert à l'auteur à l'approbation (`null` = aucun). */
  rewardItemId: z.string().nullable().default(null),
  /** Couleur d'embed selon l'orientation des votes (suggestions en attente). */
  dynamicColor: z.boolean().default(true),
});

export type RoleLimit = z.infer<typeof roleLimitSchema>;
export type SuggestionsConfig = z.infer<typeof suggestionsConfigSchema>;

export const suggestionsDefaultConfig: SuggestionsConfig = {
  channelIds: [],
  staffRoleId: null,
  createThread: false,
  maxPending: 0,
  roleLimits: [],
  rewardCoins: 0,
  rewardItemId: null,
  dynamicColor: true,
};

/**
 * Limite de suggestions en attente applicable à un membre : la plus permissive
 * de ses limites de rôle (0 = illimité gagne), sinon la limite par défaut.
 * Renvoie 0 pour « illimité ».
 */
export function memberLimit(config: SuggestionsConfig, member: GuildMember): number {
  const applicable = config.roleLimits
    .filter((entry) => member.roles.cache.has(entry.roleId))
    .map((entry) => entry.limit);
  if (applicable.length === 0) return config.maxPending;
  if (applicable.includes(0)) return 0;
  return Math.max(...applicable);
}

export async function getSuggestionsConfig(
  ctx: BotContext,
  guildId: string,
): Promise<SuggestionsConfig> {
  const state = await ctx.config.getModuleState<SuggestionsConfig>(
    guildId,
    MODULE_NAME,
    suggestionsConfigSchema,
  );
  return state.config;
}

export async function updateSuggestionsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<SuggestionsConfig>,
): Promise<SuggestionsConfig> {
  const current = await getSuggestionsConfig(ctx, guildId);
  const updated: SuggestionsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
