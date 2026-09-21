import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'moderation';

export const moderationConfigSchema = z.object({
  /** Salon où journaliser les sanctions (null = pas de journal). */
  logChannelId: z.string().nullable().default(null),
  /** Envoyer un MP au membre sanctionné. */
  dmOnSanction: z.boolean().default(true),
});

export type ModerationConfig = z.infer<typeof moderationConfigSchema>;

export const moderationDefaultConfig: ModerationConfig = {
  logChannelId: null,
  dmOnSanction: true,
};

export async function getModerationConfig(
  ctx: BotContext,
  guildId: string,
): Promise<ModerationConfig> {
  const state = await ctx.config.getModuleState<ModerationConfig>(
    guildId,
    MODULE_NAME,
    moderationConfigSchema,
  );
  return state.config;
}
