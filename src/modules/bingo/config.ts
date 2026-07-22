import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'bingo';

export const bingoConfigSchema = z.object({
  /** Mode par défaut d'une nouvelle partie : une ligne, ou carton plein. */
  defaultMode: z.enum(['line', 'full']).default('line'),
});

export type BingoConfig = z.infer<typeof bingoConfigSchema>;

export const bingoDefaultConfig: BingoConfig = { defaultMode: 'line' };

export async function getBingoConfig(ctx: BotContext, guildId: string): Promise<BingoConfig> {
  const state = await ctx.config.getModuleState<BingoConfig>(
    guildId,
    MODULE_NAME,
    bingoConfigSchema,
  );
  return state.config;
}
