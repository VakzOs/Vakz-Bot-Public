import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'freegames';

/** Plateformes surveillées pour les jeux gratuits. */
export const platformSchema = z.enum(['steam', 'epic', 'gog']);
export type Platform = z.infer<typeof platformSchema>;
export const ALL_PLATFORMS: readonly Platform[] = ['steam', 'epic', 'gog'];

export const freegamesConfigSchema = z.object({
  /** Salon où annoncer les jeux gratuits (vide = inactif). */
  channelId: z.string().nullable().default(null),
  /** Rôle à mentionner lors d'une annonce (optionnel). */
  roleId: z.string().nullable().default(null),
  /** Plateformes actives (vide = aucune annonce). */
  platforms: z.array(platformSchema).default([...ALL_PLATFORMS]),
});

export type FreegamesConfig = z.infer<typeof freegamesConfigSchema>;

export const freegamesDefaultConfig: FreegamesConfig = {
  channelId: null,
  roleId: null,
  platforms: [...ALL_PLATFORMS],
};

export async function getFreegamesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<FreegamesConfig> {
  const state = await ctx.config.getModuleState<FreegamesConfig>(
    guildId,
    MODULE_NAME,
    freegamesConfigSchema,
  );
  return state.config;
}

export async function updateFreegamesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<FreegamesConfig>,
): Promise<FreegamesConfig> {
  const current = await getFreegamesConfig(ctx, guildId);
  const updated: FreegamesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
