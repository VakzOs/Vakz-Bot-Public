import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BotContext } from '../../core/module.js';
import { PATCH_SOURCES, getPatchSource } from './catalog.js';

export const MODULE_NAME = 'patchnotes';
export const DEFAULT_SOURCE_ID = 'league-of-legends';

export const patchSubscriptionSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  channelId: z.string(),
  roleId: z.string().nullable().default(null),
});

export type PatchSubscription = z.infer<typeof patchSubscriptionSchema>;

export const patchnotesConfigSchema = z.object({
  subscriptions: z.array(patchSubscriptionSchema).max(50).default([]),
  selectedSourceId: z.string().default(DEFAULT_SOURCE_ID),
  page: z.number().int().min(0).default(0),
  searchQuery: z.string().max(100).default(''),
  displayMode: z.enum(['catalog', 'active']).default('catalog'),
});

export type PatchnotesConfig = z.infer<typeof patchnotesConfigSchema>;

export const patchnotesDefaultConfig: PatchnotesConfig = {
  subscriptions: [],
  selectedSourceId: DEFAULT_SOURCE_ID,
  page: 0,
  searchQuery: '',
  displayMode: 'catalog',
};

export async function getPatchnotesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<PatchnotesConfig> {
  const state = await ctx.config.getModuleState<PatchnotesConfig>(
    guildId,
    MODULE_NAME,
    patchnotesConfigSchema,
  );
  const selectedSourceId = getPatchSource(state.config.selectedSourceId)
    ? state.config.selectedSourceId
    : DEFAULT_SOURCE_ID;
  const subscriptions = state.config.subscriptions.filter((sub) => getPatchSource(sub.sourceId));
  return {
    ...state.config,
    selectedSourceId,
    subscriptions,
    searchQuery: state.config.searchQuery.trim(),
    displayMode: state.config.displayMode,
  };
}

export async function updatePatchnotesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<PatchnotesConfig>,
): Promise<PatchnotesConfig> {
  const current = await getPatchnotesConfig(ctx, guildId);
  const updated: PatchnotesConfig = {
    ...current,
    ...patch,
    page: Math.max(0, patch.page ?? current.page),
    searchQuery: (patch.searchQuery ?? current.searchQuery).trim().slice(0, 100),
    subscriptions: (patch.subscriptions ?? current.subscriptions).slice(0, 50),
    displayMode: patch.displayMode ?? current.displayMode,
  };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}

export function upsertSubscription(
  config: PatchnotesConfig,
  sourceId: string,
  patch: Partial<Pick<PatchSubscription, 'channelId' | 'roleId'>>,
): PatchSubscription[] {
  const current = config.subscriptions.find((sub) => sub.sourceId === sourceId);
  if (current) {
    return config.subscriptions.map((sub) =>
      sub.sourceId === sourceId ? { ...sub, ...patch } : sub,
    );
  }
  if (!getPatchSource(sourceId) || !patch.channelId) return config.subscriptions;
  return [
    ...config.subscriptions,
    {
      id: randomUUID().slice(0, 8),
      sourceId,
      channelId: patch.channelId,
      roleId: patch.roleId ?? null,
    },
  ];
}

export function sourcePageCount(pageSize: number, total = PATCH_SOURCES.length): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
