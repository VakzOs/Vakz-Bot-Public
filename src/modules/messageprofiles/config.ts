import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'messageprofiles';

/** Un profil de message : un pseudo + un avatar sous lesquels le bot peut parler. */
const profileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  /** URL de l'avatar (vide = avatar du bot). */
  avatarUrl: z.string().max(500).default(''),
});

export type MessageProfile = z.infer<typeof profileSchema>;

export const messageprofilesConfigSchema = z.object({
  profiles: z.array(profileSchema).max(20).default([]),
});

export type MessageprofilesConfig = z.infer<typeof messageprofilesConfigSchema>;

export const messageprofilesDefaultConfig: MessageprofilesConfig = { profiles: [] };

export async function getMessageprofilesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<MessageprofilesConfig> {
  const state = await ctx.config.getModuleState<MessageprofilesConfig>(
    guildId,
    MODULE_NAME,
    messageprofilesConfigSchema,
  );
  return state.config;
}

export function findProfile(config: MessageprofilesConfig, id: string): MessageProfile | undefined {
  return config.profiles.find((profile) => profile.id === id);
}

export async function updateMessageprofilesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<MessageprofilesConfig>,
): Promise<MessageprofilesConfig> {
  const current = await getMessageprofilesConfig(ctx, guildId);
  const updated: MessageprofilesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
