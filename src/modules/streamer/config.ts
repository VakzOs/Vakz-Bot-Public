import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'streamer';

const DEFAULT_DESCRIPTION =
  'Le mode streameur te permet de te concentrer sur ton stream en te rendant sourd ' +
  'aux autres participants tout en diffusant ton audio. Clique sur le bouton ci-dessous ' +
  'pour activer ou désactiver le mode streameur.';

/**
 * Configuration : un panneau « Mode streameur » publié dans un salon, avec un
 * rôle attribué aux membres actifs (sert d'indicateur et de liste affichée).
 */
export const streamerConfigSchema = z.object({
  roleId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  title: z.string().min(1).max(256).default('🎥 Mode streameur'),
  description: z.string().min(1).max(2000).default(DEFAULT_DESCRIPTION),
});

export type StreamerConfig = z.infer<typeof streamerConfigSchema>;

export const streamerDefaultConfig: StreamerConfig = {
  roleId: null,
  channelId: null,
  messageId: null,
  title: '🎥 Mode streameur',
  description: DEFAULT_DESCRIPTION,
};

export async function getStreamerConfig(ctx: BotContext, guildId: string): Promise<StreamerConfig> {
  const state = await ctx.config.getModuleState<StreamerConfig>(
    guildId,
    MODULE_NAME,
    streamerConfigSchema,
  );
  return state.config;
}

export async function updateStreamerConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<StreamerConfig>,
): Promise<StreamerConfig> {
  const current = await getStreamerConfig(ctx, guildId);
  const updated: StreamerConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
