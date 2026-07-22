import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'streamalerts';

export const streamPlatformSchema = z.enum(['twitch', 'youtube', 'reddit', 'rss', 'dealabs']);
export type StreamPlatform = z.infer<typeof streamPlatformSchema>;

/** Plateformes de type « flux » : on annonce chaque nouvel élément publié. */
export const FEED_PLATFORMS: readonly StreamPlatform[] = ['youtube', 'reddit', 'rss', 'dealabs'];

/**
 * Un abonnement : une source suivie sur une plateforme, annoncée dans un salon
 * Discord. `message` accepte les variables `{name}`, `{title}`, `{url}`, `{game}`.
 */
export const subscriptionSchema = z.object({
  id: z.string(),
  platform: streamPlatformSchema,
  /**
   * Identifiant suivi selon la plateforme : login Twitch, chaîne YouTube (UC…),
   * nom de subreddit (Reddit), URL du flux (RSS) ou mot-clé de filtre (Dealabs).
   */
  identifier: z.string(),
  /** Libellé affiché (nom de chaîne), mémorisé après le premier contrôle. */
  displayName: z.string().default(''),
  /** Salon Discord où poster l'annonce (vide = abonnement inactif). */
  channelId: z.string().default(''),
  /** Rôle à mentionner (optionnel). */
  roleId: z.string().nullable().default(null),
  /** Texte d'annonce personnalisé (optionnel). */
  message: z.string().max(1000).default(''),
});

export type StreamSubscription = z.infer<typeof subscriptionSchema>;

export const streamalertsConfigSchema = z.object({
  subscriptions: z.array(subscriptionSchema).max(50).default([]),
});

export type StreamalertsConfig = z.infer<typeof streamalertsConfigSchema>;

export const streamalertsDefaultConfig: StreamalertsConfig = { subscriptions: [] };

export async function getStreamalertsConfig(
  ctx: BotContext,
  guildId: string,
): Promise<StreamalertsConfig> {
  const state = await ctx.config.getModuleState<StreamalertsConfig>(
    guildId,
    MODULE_NAME,
    streamalertsConfigSchema,
  );
  return state.config;
}

export async function updateStreamalertsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<StreamalertsConfig>,
): Promise<StreamalertsConfig> {
  const current = await getStreamalertsConfig(ctx, guildId);
  const updated: StreamalertsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
