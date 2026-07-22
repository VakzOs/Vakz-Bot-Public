import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'info';

/**
 * Configuration du module « Commandes d'informations ». En plus des commandes
 * en lecture seule (`/userinfo`…), il propose un **journal des profils** optionnelle
 * des changements d'identité des membres (nom, nom affiché, photo de profil,
 * pseudo serveur), journalisés dans un salon.
 */
export const infoConfigSchema = z.object({
  /** Active la surveillance des changements de profil. */
  watchEnabled: z.boolean().default(false),
  /** Salon où sont journalisés les changements. */
  watchChannelId: z.string().nullable().default(null),
  /** Surveiller le nom d'utilisateur (@handle). */
  watchUsername: z.boolean().default(true),
  /** Surveiller le nom affiché (global name). */
  watchGlobalName: z.boolean().default(true),
  /** Surveiller la photo de profil (avatar). */
  watchAvatar: z.boolean().default(true),
  /** Surveiller le pseudo serveur (nickname). */
  watchNickname: z.boolean().default(true),
  /** Restreindre la surveillance à ces rôles (vide = tous les membres). */
  watchRoleIds: z.array(z.string()).default([]),
});

export type InfoConfig = z.infer<typeof infoConfigSchema>;

export const infoDefaultConfig: InfoConfig = {
  watchEnabled: false,
  watchChannelId: null,
  watchUsername: true,
  watchGlobalName: true,
  watchAvatar: true,
  watchNickname: true,
  watchRoleIds: [],
};

/** Lit la configuration du module pour un serveur (avec valeurs par défaut). */
export async function getInfoConfig(ctx: BotContext, guildId: string): Promise<InfoConfig> {
  const state = await ctx.config.getModuleState<InfoConfig>(guildId, MODULE_NAME, infoConfigSchema);
  return state.config;
}

/** Met à jour partiellement la configuration du module et la persiste. */
export async function updateInfoConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<InfoConfig>,
): Promise<InfoConfig> {
  const current = await getInfoConfig(ctx, guildId);
  const updated: InfoConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
