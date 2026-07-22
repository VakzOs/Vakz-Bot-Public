import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'serverstats';

/** Types de compteur disponibles. `role` compte les membres d'un rôle précis. */
export const counterTypeSchema = z.enum([
  'members',
  'humans',
  'bots',
  'boosts',
  'roles',
  'channels',
  'role',
]);
export type CounterType = z.infer<typeof counterTypeSchema>;

export const COUNTER_TYPES: CounterType[] = [
  'members',
  'humans',
  'bots',
  'boosts',
  'roles',
  'channels',
  'role',
];

/**
 * Un compteur : un salon vocal dont le nom est régénéré depuis `template`
 * (le `{count}` est remplacé par la valeur). `roleId` n'est utilisé que par le
 * type `role`.
 */
export const counterSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  type: counterTypeSchema.default('members'),
  roleId: z.string().nullable().default(null),
  template: z.string().min(1).max(100).default('{count}'),
});

export type ServerCounter = z.infer<typeof counterSchema>;

export const serverstatsConfigSchema = z.object({
  counters: z.array(counterSchema).max(20).default([]),
});

export type ServerstatsConfig = z.infer<typeof serverstatsConfigSchema>;

export const serverstatsDefaultConfig: ServerstatsConfig = { counters: [] };

export async function getServerstatsConfig(
  ctx: BotContext,
  guildId: string,
): Promise<ServerstatsConfig> {
  const state = await ctx.config.getModuleState<ServerstatsConfig>(
    guildId,
    MODULE_NAME,
    serverstatsConfigSchema,
  );
  return state.config;
}

export async function updateServerstatsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<ServerstatsConfig>,
): Promise<ServerstatsConfig> {
  const current = await getServerstatsConfig(ctx, guildId);
  const updated: ServerstatsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
