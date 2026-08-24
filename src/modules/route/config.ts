import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'route';

/**
 * Barème de drop PROPRE À LA ROUTE (indépendant de celui des mini-jeux) :
 * pourcentage par rareté (0-100 %). Quand un événement « marchand » survient et
 * que `giveItems` est activé, on tire de la plus rare à la plus commune avec ces
 * chances ; seuls les objets marqués « Drop en jeu » (droppable) peuvent tomber.
 * Ces valeurs sont distinctes de celles configurées dans le module Objets.
 */
const routeDropsSchema = z.object({
  common: z.number().int().min(0).max(100).default(70),
  rare: z.number().int().min(0).max(100).default(35),
  epic: z.number().int().min(0).max(100).default(15),
  legendary: z.number().int().min(0).max(100).default(5),
});

export type RouteDrops = z.infer<typeof routeDropsSchema>;

/**
 * Prix des provisions de la Route. `shop` = prix d'ACHAT à la boutique
 * (`/route boutique`, payé avec le solde du module Économie) ; `peddler` =
 * prix de REVENTE au marchand ambulant (événement `peddler`).
 */
const routePricesSchema = z.object({
  potion: z.number().int().min(0).max(100000).default(150),
  tonic: z.number().int().min(0).max(100000).default(120),
  ration: z.number().int().min(0).max(100000).default(80),
});

export type RoutePrices = z.infer<typeof routePricesSchema>;

export const routeConfigSchema = z.object({
  /** Délai entre deux déplacements (minutes). */
  cooldownMinutes: z.number().int().min(0).max(1440).default(15),
  /** Créditer les pièces gagnées sur le solde du module Économie. */
  giveCoins: z.boolean().default(true),
  /** Distribuer des objets trouvés (depuis le catalogue du serveur). */
  giveItems: z.boolean().default(true),
  /** Barème de drop propre à la Route (chances par rareté). */
  drops: routeDropsSchema.default({}),
  /** Régénération passive d'énergie par minute (0 = désactivée). */
  energyRegenRate: z.number().int().min(0).max(10).default(1),
  /** Plafond de la régénération passive (l'énergie remonte jusqu'à cette
   *  valeur, y compris depuis le négatif ; au-delà, seuls les événements et
   *  les provisions font monter l'énergie). */
  energyRegenCap: z.number().int().min(0).max(100).default(15),
  /** Prix d'achat des provisions à la boutique de la Route. */
  shopPrices: routePricesSchema.default({}),
  /** Prix de revente des provisions au marchand ambulant. */
  peddlerPrices: routePricesSchema.default({ potion: 60, tonic: 50, ration: 35 }),
});

export type RouteConfig = z.infer<typeof routeConfigSchema>;

export const routeDefaultConfig: RouteConfig = {
  cooldownMinutes: 15,
  giveCoins: true,
  giveItems: true,
  drops: { common: 70, rare: 35, epic: 15, legendary: 5 },
  energyRegenRate: 1,
  energyRegenCap: 15,
  shopPrices: { potion: 150, tonic: 120, ration: 80 },
  peddlerPrices: { potion: 60, tonic: 50, ration: 35 },
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
