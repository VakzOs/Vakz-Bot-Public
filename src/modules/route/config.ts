import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'route';

export const routeConfigSchema = z.object({
  /** Délai entre deux déplacements (minutes). */
  cooldownMinutes: z.number().int().min(0).max(1440).default(15),
  /** Créditer les pièces gagnées sur le solde du module Économie. */
  giveCoins: z.boolean().default(true),
  /** Distribuer des objets trouvés (depuis le catalogue du serveur). */
  giveItems: z.boolean().default(true),
});

export type RouteConfig = z.infer<typeof routeConfigSchema>;

export const routeDefaultConfig: RouteConfig = {
  cooldownMinutes: 15,
  giveCoins: true,
  giveItems: true,
};

export async function getRouteConfig(ctx: BotContext, guildId: string): Promise<RouteConfig> {
  const state = await ctx.config.getModuleState<RouteConfig>(
    guildId,
    MODULE_NAME,
    routeConfigSchema,
  );
  return state.config;
}

export async function updateRouteConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<RouteConfig>,
): Promise<RouteConfig> {
  const current = await getRouteConfig(ctx, guildId);
  const updated: RouteConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
