import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

export const MODULE_NAME = 'logs';

export const logsConfigSchema = z.object({
  logChannelId: z.string().nullable().default(null),
  messages: z.boolean().default(true),
  members: z.boolean().default(true),
  channels: z.boolean().default(true),
  roles: z.boolean().default(true),
  moderation: z.boolean().default(true),
});

export type LogsConfig = z.infer<typeof logsConfigSchema>;
export type LogCategory = keyof Pick<
  LogsConfig,
  'messages' | 'members' | 'channels' | 'roles' | 'moderation'
>;

export const logsDefaultConfig: LogsConfig = {
  logChannelId: null,
  messages: true,
  members: true,
  channels: true,
  roles: true,
  moderation: true,
};

export async function getLogsConfig(ctx: BotContext, guildId: string): Promise<LogsConfig> {
  const state = await ctx.config.getModuleState<LogsConfig>(guildId, MODULE_NAME, logsConfigSchema);
  return state.config;
}

export async function updateLogsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<LogsConfig>,
): Promise<LogsConfig> {
  const current = await getLogsConfig(ctx, guildId);
  const updated: LogsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
