import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'levels';

const announceSchema = z.object({
  enabled: z.boolean(),
  /** Salon d'annonce de niveau ; `null` = le salon où le message a été envoyé. */
  channelId: z.string().nullable(),
  message: z.string().min(1).max(2000),
});

const rewardSchema = z.object({
  level: z.number().int().min(1).max(1000),
  roleId: z.string(),
});

export const levelsConfigSchema = z.object({
  xpMin: z.number().int().min(1).max(1000).default(15),
  xpMax: z.number().int().min(1).max(1000).default(25),
  /** Cooldown anti-spam entre deux gains d'XP, en secondes. */
  cooldown: z.number().int().min(0).max(3600).default(60),
  announce: announceSchema.default({
    enabled: true,
    channelId: null,
    message: '🎉 Bravo {mention}, tu passes niveau **{level}** !',
  }),
  rewards: z.array(rewardSchema).default([]),

  // --- Réglages avancés ---
  /** Salons où aucun XP n'est gagné (messages et vocal). */
  ignoredChannelIds: z.array(z.string()).default([]),
  /** Rôles dont les membres ne gagnent pas d'XP. */
  ignoredRoleIds: z.array(z.string()).default([]),
  /** Rôles « boost » : leurs membres gagnent l'XP multipliée. */
  boosterRoleIds: z.array(z.string()).default([]),
  /** Multiplicateur d'XP appliqué aux membres avec un rôle boost. */
  boosterMultiplier: z.number().min(1).max(5).default(2),
  /** Niveau maximum atteignable (0 = illimité). */
  maxLevel: z.number().int().min(0).max(1000).default(0),
  /** Facteur d'échelle de la courbe d'XP (>1 = progression plus lente). */
  curveFactor: z.number().min(0.25).max(4).default(1),
  /** Couleur d'accent de la carte de rang (entier RGB ; `null` = défaut). */
  cardColor: z.number().int().min(0).max(0xffffff).nullable().default(null),
  /** Gain d'XP en vocal activé. */
  voiceEnabled: z.boolean().default(false),
  /** XP gagné par minute passée en vocal (membre actif, non seul). */
  voiceXpPerMinute: z.number().int().min(0).max(500).default(10),
  /** Salon où maintenir un classement auto-actualisé (`null` = désactivé). */
  leaderboardChannelId: z.string().nullable().default(null),
  /** Message du classement auto (géré par le bot). */
  leaderboardMessageId: z.string().nullable().default(null),
});

export type AnnounceConfig = z.infer<typeof announceSchema>;
export type RewardRole = z.infer<typeof rewardSchema>;
export type LevelsConfig = z.infer<typeof levelsConfigSchema>;

export const levelsDefaultConfig: LevelsConfig = {
  xpMin: 15,
  xpMax: 25,
  cooldown: 60,
  announce: {
    enabled: true,
    channelId: null,
    message: '🎉 Bravo {mention}, tu passes niveau **{level}** !',
  },
  rewards: [],
  ignoredChannelIds: [],
  ignoredRoleIds: [],
  boosterRoleIds: [],
  boosterMultiplier: 2,
  maxLevel: 0,
  curveFactor: 1,
  cardColor: null,
  voiceEnabled: false,
  voiceXpPerMinute: 10,
  leaderboardChannelId: null,
  leaderboardMessageId: null,
};

export async function getLevelsConfig(ctx: BotContext, guildId: string): Promise<LevelsConfig> {
  const state = await ctx.config.getModuleState<LevelsConfig>(
    guildId,
    MODULE_NAME,
    levelsConfigSchema,
  );
  return state.config;
}

export async function updateLevelsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<LevelsConfig>,
): Promise<LevelsConfig> {
  const current = await getLevelsConfig(ctx, guildId);
  const updated: LevelsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
