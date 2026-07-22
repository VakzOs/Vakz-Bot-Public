import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

export const MODULE_NAME = 'reports';

export const reportsConfigSchema = z.object({
  channelId: z.string().nullable().default(null),
  staffRoleId: z.string().nullable().default(null),
});

export type ReportsConfig = z.infer<typeof reportsConfigSchema>;

export const reportsDefaultConfig: ReportsConfig = {
  channelId: null,
  staffRoleId: null,
};

export async function getReportsConfig(ctx: BotContext, guildId: string): Promise<ReportsConfig> {
  const state = await ctx.config.getModuleState<ReportsConfig>(
    guildId,
    MODULE_NAME,
    reportsConfigSchema,
  );
  return state.config;
}

export async function updateReportsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<ReportsConfig>,
): Promise<ReportsConfig> {
  const current = await getReportsConfig(ctx, guildId);
  const updated: ReportsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
