import { z } from 'zod';
import type { BotContext } from '../../core/module.js';
import { getPatchSource } from './catalog.js';

export const MODULE_NAME = 'patchnotes';

export const patchSubscriptionSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  channelId: z.string(),
  roleId: z.string().nullable().default(null),
});

export type PatchSubscription = z.infer<typeof patchSubscriptionSchema>;

export const patchnotesConfigSchema = z.object({
  subscriptions: z.array(patchSubscriptionSchema).max(50).default([]),
});

export type PatchnotesConfig = z.infer<typeof patchnotesConfigSchema>;

export const patchnotesDefaultConfig: PatchnotesConfig = { subscriptions: [] };

export async function getPatchnotesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<PatchnotesConfig> {
  const state = await ctx.config.getModuleState<PatchnotesConfig>(
    guildId,
    MODULE_NAME,
    patchnotesConfigSchema,
  );
  // Une source retirée du catalogue laisserait un abonnement orphelin.
  return {
    subscriptions: state.config.subscriptions.filter((sub) => getPatchSource(sub.sourceId)),
  };
}
