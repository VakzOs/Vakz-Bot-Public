import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'interserver';

export const interserverConfigSchema = z.object({
  /** Ajoute « • NomDuServeur » au pseudo affiché dans les messages relayés. */
  tagServer: z.boolean().default(true),
});

export type InterserverConfig = z.infer<typeof interserverConfigSchema>;

export const interserverDefaultConfig: InterserverConfig = {
  tagServer: true,
};

/** Normalise un code de réseau : minuscules, alphanumérique + tirets, 3-32 car. */
export function normalizeNetwork(input: string): string | null {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value.length >= 3 && value.length <= 32 ? value : null;
}

export async function getInterserverConfig(
  ctx: BotContext,
  guildId: string,
): Promise<InterserverConfig> {
  const state = await ctx.config.getModuleState<InterserverConfig>(
    guildId,
    MODULE_NAME,
    interserverConfigSchema,
  );
  return state.config;
}

export async function updateInterserverConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<InterserverConfig>,
): Promise<InterserverConfig> {
  const current = await getInterserverConfig(ctx, guildId);
  const updated: InterserverConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
