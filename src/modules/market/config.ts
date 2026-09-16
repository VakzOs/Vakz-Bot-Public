import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'market';

export const marketConfigSchema = z.object({
  /** Taxe prélevée au vendeur à chaque vente (0-100 %). */
  taxPercent: z.number().int().min(0).max(100).default(0),
  /** Nombre maximum d'annonces actives par membre. */
  maxListingsPerUser: z.number().int().min(1).max(100).default(10),
  /** Prix unitaire minimum absolu d'une annonce (plancher fixe). */
  minPrice: z.number().int().min(1).max(1_000_000).default(1),
  /**
   * Prix minimum d'une annonce exprimé en % du prix BOUTIQUE de l'objet
   * (0 = pas de plancher lié au prix boutique). Le plancher effectif est le
   * maximum entre `minPrice` et `prix boutique × minPricePercent`.
   */
  minPricePercent: z.number().int().min(0).max(100).default(50),
});

export type MarketConfig = z.infer<typeof marketConfigSchema>;

export const marketDefaultConfig: MarketConfig = {
  taxPercent: 0,
  maxListingsPerUser: 10,
  minPrice: 1,
  minPricePercent: 50,
};

export async function getMarketConfig(ctx: BotContext, guildId: string): Promise<MarketConfig> {
  const state = await ctx.config.getModuleState<MarketConfig>(
    guildId,
    MODULE_NAME,
    marketConfigSchema,
  );
  return state.config;
}
