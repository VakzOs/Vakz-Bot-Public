import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'music';

/**
 * Plateformes de recherche proposées (sélecteur du panneau + dashboard). La
 * valeur correspond au préfixe de recherche Lavalink (`ytsearch`, `scsearch`…).
 * Spotify/Deezer passent par le plugin LavaSrc (inclus dans la config Lavalink
 * fournie) ; Spotify nécessite en plus des identifiants (SPOTIFY_CLIENT_*).
 */
export const SEARCH_PLATFORMS = [
  { value: 'ytsearch', label: 'YouTube' },
  { value: 'ytmsearch', label: 'YouTube Music' },
  { value: 'scsearch', label: 'SoundCloud' },
  { value: 'spsearch', label: 'Spotify (LavaSrc — identifiants requis)' },
  { value: 'dzsearch', label: 'Deezer (LavaSrc)' },
] as const;

const SEARCH_VALUES = SEARCH_PLATFORMS.map((platform) => platform.value);

export const musicConfigSchema = z.object({
  /** Rôle « DJ » : seul à pouvoir contrôler la lecture (skip, stop…). Null = tout le monde. */
  djRoleId: z.string().nullable().default(null),
  /** Volume appliqué à la connexion (1-100). */
  defaultVolume: z.number().int().min(1).max(100).default(60),
  /** Volume maximum autorisé via `/volume` (1-150). */
  maxVolume: z.number().int().min(1).max(150).default(100),
  /** Exiger d'être dans le même salon vocal que le bot pour le contrôler. */
  requireSameChannel: z.boolean().default(true),
  /** Quitter automatiquement le vocal quand la file est terminée. */
  autoLeave: z.boolean().default(true),
  /** Plateforme de recherche par défaut quand la requête n'est pas un lien. */
  defaultSearch: z
    .string()
    .refine((value) => SEARCH_VALUES.includes(value as (typeof SEARCH_VALUES)[number]))
    .default('ytsearch'),
});

export type MusicConfig = z.infer<typeof musicConfigSchema>;

export const musicDefaultConfig: MusicConfig = {
  djRoleId: null,
  defaultVolume: 60,
  maxVolume: 100,
  requireSameChannel: true,
  autoLeave: true,
  defaultSearch: 'ytsearch',
};

export async function getMusicConfig(ctx: BotContext, guildId: string): Promise<MusicConfig> {
  const state = await ctx.config.getModuleState<MusicConfig>(
    guildId,
    MODULE_NAME,
    musicConfigSchema,
  );
  return state.config;
}

export async function updateMusicConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<MusicConfig>,
): Promise<MusicConfig> {
  const current = await getMusicConfig(ctx, guildId);
  const updated: MusicConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
