import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'customcommands';

/** Nombre maximal de commandes personnalisées par serveur. */
export const MAX_COMMANDS = 50;

/** Manières de comparer le message au déclencheur. */
export const MATCH_TYPES = ['contains', 'exact', 'startsWith', 'endsWith'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

/**
 * Une commande personnalisée / auto-réponse : quand un message correspond au
 * `trigger` (selon `match`), le bot répond avec `response`. Facultativement
 * limitée à un salon, avec un délai anti-spam et la suppression du message
 * déclencheur.
 */
export const customCommandSchema = z.object({
  id: z.string(),
  trigger: z.string().min(1).max(100),
  match: z.enum(MATCH_TYPES).default('contains'),
  response: z.string().min(1).max(2000),
  asEmbed: z.boolean().default(false),
  channelId: z.string().nullable().default(null),
  deleteTrigger: z.boolean().default(false),
  cooldown: z.number().int().min(0).max(3600).default(0),
});

export type CustomCommand = z.infer<typeof customCommandSchema>;

export const customcommandsConfigSchema = z.object({
  commands: z.array(customCommandSchema).max(MAX_COMMANDS).default([]),
});

export type CustomcommandsConfig = z.infer<typeof customcommandsConfigSchema>;

export const customcommandsDefaultConfig: CustomcommandsConfig = { commands: [] };

export async function getCustomcommandsConfig(
  ctx: BotContext,
  guildId: string,
): Promise<CustomcommandsConfig> {
  const state = await ctx.config.getModuleState<CustomcommandsConfig>(
    guildId,
    MODULE_NAME,
    customcommandsConfigSchema,
  );
  return state.config;
}

export async function updateCustomcommandsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<CustomcommandsConfig>,
): Promise<CustomcommandsConfig> {
  const current = await getCustomcommandsConfig(ctx, guildId);
  const updated: CustomcommandsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
