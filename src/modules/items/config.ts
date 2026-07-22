import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'items';

/** Nombre maximum d'objets dans le catalogue d'un serveur. */
export const MAX_ITEMS = 50;

/** Raretés reconnues, de la plus commune à la plus rare. */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export const itemsConfigSchema = z.object({
  /** Autoriser les échanges d'objets entre membres (`/donner-objet`). */
  tradingEnabled: z.boolean().default(true),
});

export type ItemsConfig = z.infer<typeof itemsConfigSchema>;

export const itemsDefaultConfig: ItemsConfig = {
  tradingEnabled: true,
};

export async function getItemsConfig(ctx: BotContext, guildId: string): Promise<ItemsConfig> {
  const state = await ctx.config.getModuleState<ItemsConfig>(
    guildId,
    MODULE_NAME,
    itemsConfigSchema,
  );
  return state.config;
}

export async function updateItemsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<ItemsConfig>,
): Promise<ItemsConfig> {
  const current = await getItemsConfig(ctx, guildId);
  const updated: ItemsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
