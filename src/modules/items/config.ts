import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'items';

/** Raretés reconnues, de la plus commune à la plus rare. */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Raretés de la plus rare à la plus commune (ordre de tirage des drops). */
export const RARITIES_BY_RARITY: readonly Rarity[] = ['legendary', 'epic', 'rare', 'common'];

/** Quand un mini-jeu peut faire tomber un objet. */
export const DROP_TRIGGERS = ['win', 'winDraw', 'any'] as const;
export type DropTrigger = (typeof DROP_TRIGGERS)[number];

/**
 * Config des drops. Les pourcentages par rareté (0-100 %) sont définis
 * manuellement par serveur, à plat (une clé par rareté) pour être aussi
 * éditables depuis le dashboard web. À chaque partie éligible, on tire de la
 * plus rare à la plus commune : la première rareté dont le tirage réussit fait
 * tomber un objet aléatoire de cette rareté (parmi les objets `droppable`).
 * 0 = cette rareté ne tombe jamais.
 */
const dropsSchema = z.object({
  /** Activer les drops d'objets dans les mini-jeux. */
  enabled: z.boolean().default(false),
  /** Issues de partie qui déclenchent un tirage (défaut : victoire seulement). */
  on: z.enum(DROP_TRIGGERS).default('win'),
  common: z.number().int().min(0).max(100).default(20),
  rare: z.number().int().min(0).max(100).default(8),
  epic: z.number().int().min(0).max(100).default(3),
  legendary: z.number().int().min(0).max(100).default(1),
});

export type DropsConfig = z.infer<typeof dropsSchema>;

export const itemsConfigSchema = z.object({
  /** Autoriser les échanges d'objets entre membres (`/donner-objet`). */
  tradingEnabled: z.boolean().default(true),
  /** Butin d'objets dans les mini-jeux. */
  drops: dropsSchema.default({}),
});

export type ItemsConfig = z.infer<typeof itemsConfigSchema>;

export const itemsDefaultConfig: ItemsConfig = {
  tradingEnabled: true,
  drops: { enabled: false, on: 'win', common: 20, rare: 8, epic: 3, legendary: 1 },
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
