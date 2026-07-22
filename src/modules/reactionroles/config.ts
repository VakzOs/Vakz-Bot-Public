import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'reactionroles';

const roleEntrySchema = z.object({
  roleId: z.string(),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).default(''),
});

/**
 * Configuration du module : un menu de rôles unique par serveur (salon cible,
 * titre, description et jusqu'à 25 boutons rôle).
 */
export const reactionRolesConfigSchema = z.object({
  channelId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  title: z.string().min(1).max(256).default('🎭 Choisis tes rôles'),
  description: z
    .string()
    .min(1)
    .max(2000)
    .default('Clique sur un bouton pour obtenir ou retirer un rôle.'),
  roles: z.array(roleEntrySchema).max(25).default([]),
});

export type RoleEntry = z.infer<typeof roleEntrySchema>;
export type ReactionRolesConfig = z.infer<typeof reactionRolesConfigSchema>;

export const reactionRolesDefaultConfig: ReactionRolesConfig = {
  channelId: null,
  messageId: null,
  title: '🎭 Choisis tes rôles',
  description: 'Clique sur un bouton pour obtenir ou retirer un rôle.',
  roles: [],
};

export async function getReactionRolesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<ReactionRolesConfig> {
  const state = await ctx.config.getModuleState<ReactionRolesConfig>(
    guildId,
    MODULE_NAME,
    reactionRolesConfigSchema,
  );
  return state.config;
}

export async function updateReactionRolesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<ReactionRolesConfig>,
): Promise<ReactionRolesConfig> {
  const current = await getReactionRolesConfig(ctx, guildId);
  const updated: ReactionRolesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
