import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'advent';

/** Nombre de portes du calendrier (1er au 24 décembre). */
export const LAST_DAY = 24;

/** Récompense associée à un jour précis du calendrier. */
const dayRewardSchema = z.object({
  day: z.number().int().min(1).max(LAST_DAY),
  coins: z.number().int().min(0).max(1_000_000).default(0),
  itemId: z.string().nullable().default(null),
  itemQty: z.number().int().min(1).max(100).default(1),
  message: z.string().max(500).default(''),
});

export const adventConfigSchema = z.object({
  /** Salon où annoncer l'ouverture d'une porte chaque jour (optionnel). */
  announceChannelId: z.string().nullable().default(null),
  /** Mode test : toutes les portes sont ouvrables, hors décembre (pour régler). */
  testMode: z.boolean().default(false),
  /** Pièces offertes par défaut pour un jour sans récompense spécifique. */
  defaultCoins: z.number().int().min(0).max(1_000_000).default(100),
  /** Dernier jour déjà annoncé dans le salon (dédup de l'annonce quotidienne). */
  lastAnnouncedDay: z.number().int().min(0).max(LAST_DAY).default(0),
  rewards: z.array(dayRewardSchema).max(LAST_DAY).default([]),
});

export type DayReward = z.infer<typeof dayRewardSchema>;
export type AdventConfig = z.infer<typeof adventConfigSchema>;

export const adventDefaultConfig: AdventConfig = {
  announceChannelId: null,
  testMode: false,
  defaultCoins: 100,
  lastAnnouncedDay: 0,
  rewards: [],
};

export async function getAdventConfig(ctx: BotContext, guildId: string): Promise<AdventConfig> {
  const state = await ctx.config.getModuleState<AdventConfig>(
    guildId,
    MODULE_NAME,
    adventConfigSchema,
  );
  return state.config;
}

export async function updateAdventConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<AdventConfig>,
): Promise<AdventConfig> {
  const current = await getAdventConfig(ctx, guildId);
  const updated: AdventConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
