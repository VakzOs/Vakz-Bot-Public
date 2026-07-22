import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'giveaways';

const DEFAULT_WIN = '🎉 Félicitations {winners} ! Vous remportez **{prize}** !';
const DEFAULT_NO_WIN = '😢 Personne n’a participé au tirage pour **{prize}**.';

/**
 * Configuration du module « Giveaways » : salon de logs des gagnants (optionnel)
 * et textes d'annonce personnalisables (`{winners}` et `{prize}`).
 */
export const giveawaysConfigSchema = z.object({
  logChannelId: z.string().nullable().default(null),
  winMessage: z.string().min(1).max(1500).default(DEFAULT_WIN),
  noWinnerMessage: z.string().min(1).max(1500).default(DEFAULT_NO_WIN),
});

export type GiveawaysConfig = z.infer<typeof giveawaysConfigSchema>;

export const giveawaysDefaultConfig: GiveawaysConfig = {
  logChannelId: null,
  winMessage: DEFAULT_WIN,
  noWinnerMessage: DEFAULT_NO_WIN,
};

export async function getGiveawaysConfig(
  ctx: BotContext,
  guildId: string,
): Promise<GiveawaysConfig> {
  const state = await ctx.config.getModuleState<GiveawaysConfig>(
    guildId,
    MODULE_NAME,
    giveawaysConfigSchema,
  );
  return state.config;
}

export async function updateGiveawaysConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<GiveawaysConfig>,
): Promise<GiveawaysConfig> {
  const current = await getGiveawaysConfig(ctx, guildId);
  const updated: GiveawaysConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
