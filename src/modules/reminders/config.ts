import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

export const MODULE_NAME = 'reminders';

export const remindersConfigSchema = z.object({
  allowDm: z.boolean().default(true),
  maxDelayDays: z.number().int().min(1).max(365).default(365),
  creationMode: z.enum(['once', 'weekly']).default('once'),
  weeklyDay: z.number().int().min(1).max(7).default(1),
  targetKind: z.enum(['user', 'role']).default('user'),
  targetId: z.string().nullable().default(null),
  targetChannelId: z.string().nullable().default(null),
  deliverInDm: z.boolean().default(false),
});

export type RemindersConfig = z.infer<typeof remindersConfigSchema>;

export const remindersDefaultConfig: RemindersConfig = {
  allowDm: true,
  maxDelayDays: 365,
  creationMode: 'once',
  weeklyDay: 1,
  targetKind: 'user',
  targetId: null,
  targetChannelId: null,
  deliverInDm: false,
};

export async function getRemindersConfig(
  ctx: BotContext,
  guildId: string,
): Promise<RemindersConfig> {
  const state = await ctx.config.getModuleState<RemindersConfig>(
    guildId,
    MODULE_NAME,
    remindersConfigSchema,
  );
  return state.config;
}

export async function updateRemindersConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<RemindersConfig>,
): Promise<RemindersConfig> {
  const current = await getRemindersConfig(ctx, guildId);
  const updated = remindersConfigSchema.parse({ ...current, ...patch });
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
