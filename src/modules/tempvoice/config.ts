import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'tempvoice';

/** Gabarit de nom par défaut d'un salon temporaire. */
export const DEFAULT_NAME_TEMPLATE = '🔊 {user}';

/**
 * Un « hub » (salon générateur) : quand un membre le rejoint, le bot lui crée
 * un salon vocal temporaire personnalisé selon ces réglages, puis l'y déplace.
 */
export const hubSchema = z.object({
  /** Salon vocal générateur (celui que l'on rejoint pour créer). */
  channelId: z.string(),
  /** Catégorie où créer les salons (par défaut : celle du hub). */
  categoryId: z.string().nullable().default(null),
  /** Gabarit du nom : `{user}` = pseudo, `{username}` = nom d'utilisateur. */
  nameTemplate: z.string().min(1).max(100).default(DEFAULT_NAME_TEMPLATE),
  /** Limite de membres (0 = illimité). */
  userLimit: z.number().int().min(0).max(99).default(0),
  /** Bitrate en kbps (null = valeur par défaut Discord). */
  bitrate: z.number().int().min(8).max(384).nullable().default(null),
  /** Créer le salon verrouillé (personne ne peut rejoindre hors invités). */
  lockedByDefault: z.boolean().default(false),
  /**
   * Copier les permissions (overwrites de rôles/membres) du salon générateur
   * sur le salon temporaire. Permet d'hériter des restrictions d'accès du hub
   * (ex. salon réservé à certains rôles). Activé par défaut.
   */
  inheritPermissions: z.boolean().default(true),
});

export type TempVoiceHub = z.infer<typeof hubSchema>;

export const tempvoiceConfigSchema = z.object({
  hubs: z.array(hubSchema).max(25).default([]),
  /** Publier un panneau de contrôle dans le tchat du salon créé. */
  showControlPanel: z.boolean().default(true),
});

export type TempVoiceConfig = z.infer<typeof tempvoiceConfigSchema>;

export const tempvoiceDefaultConfig: TempVoiceConfig = {
  hubs: [],
  showControlPanel: true,
};

export async function getTempvoiceConfig(
  ctx: BotContext,
  guildId: string,
): Promise<TempVoiceConfig> {
  const state = await ctx.config.getModuleState<TempVoiceConfig>(
    guildId,
    MODULE_NAME,
    tempvoiceConfigSchema,
  );
  return state.config;
}

export async function updateTempvoiceConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<TempVoiceConfig>,
): Promise<TempVoiceConfig> {
  const current = await getTempvoiceConfig(ctx, guildId);
  const updated: TempVoiceConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
