import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'autoroles';

/**
 * Configuration : rôles attribués automatiquement à l'arrivée d'un membre
 * (liste pour les humains, liste séparée optionnelle pour les bots).
 */
export const autorolesConfigSchema = z.object({
  roleIds: z.array(z.string()).max(10).default([]),
  botRoleIds: z.array(z.string()).max(10).default([]),
  /** Rôles attribués tant qu'un membre est connecté à un salon vocal. */
  voiceRoleIds: z.array(z.string()).max(10).default([]),
});

export type AutorolesConfig = z.infer<typeof autorolesConfigSchema>;

export const autorolesDefaultConfig: AutorolesConfig = {
  roleIds: [],
  botRoleIds: [],
  voiceRoleIds: [],
};

export async function getAutorolesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<AutorolesConfig> {
  const state = await ctx.config.getModuleState<AutorolesConfig>(
    guildId,
    MODULE_NAME,
    autorolesConfigSchema,
  );
  return state.config;
}

export async function updateAutorolesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<AutorolesConfig>,
): Promise<AutorolesConfig> {
  const current = await getAutorolesConfig(ctx, guildId);
  const updated: AutorolesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
