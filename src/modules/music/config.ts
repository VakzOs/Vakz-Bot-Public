import { z } from 'zod';
import { t } from '../../core/i18n.js';
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
  'ytsearch',
  'ytmsearch',
  'scsearch',
  'spsearch',
  'dzsearch',
] as const;

/**
 * Le libellé d'une plateforme, dans la langue ambiante. Le nom de marque ne
 * change pas ; ce qui l'accompagne (« identifiants requis ») se traduit.
 */
export function searchPlatformLabel(platform: (typeof SEARCH_PLATFORMS)[number]): string {
  return t(`modules.music.plateformes.${platform}`);
}

const SEARCH_VALUES = SEARCH_PLATFORMS;

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
