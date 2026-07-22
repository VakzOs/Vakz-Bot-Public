import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'economy';

const shopItemSchema = z.object({
  roleId: z.string(),
  price: z.number().int().min(0).max(100_000_000),
  /** Stock restant ; `-1` = illimité, `0` = épuisé. */
  stock: z.number().int().min(-1).max(1_000_000).default(-1),
});

/** Une boutique nommée : une bannière optionnelle et jusqu'à 25 articles (rôles). */
const shopSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  bannerUrl: z.string().max(512).nullable().default(null),
  items: z.array(shopItemSchema).max(25).default([]),
});

export const economyConfigSchema = z.object({
  currencyName: z.string().min(1).max(30).default('pièces'),
  // Jusqu'à 64 caractères pour accepter un code d'emoji personnalisé (<:nom:id>).
  currencySymbol: z.string().min(1).max(64).default('🪙'),
  /** Gain par message (aléatoire entre min et max). */
  messageMin: z.number().int().min(0).max(10_000).default(1),
  messageMax: z.number().int().min(0).max(10_000).default(3),
  /** Cooldown anti-spam entre deux gains par message (secondes). */
  messageCooldown: z.number().int().min(0).max(3600).default(60),
  /** Montant de la récompense quotidienne. */
  dailyAmount: z.number().int().min(0).max(1_000_000).default(100),
  /** Ancienne boutique unique (migrée vers `shops`). Conservée pour la migration. */
  shop: z.array(shopItemSchema).max(25).default([]),
  /** Boutiques nommées (jusqu'à 10), chacune avec ses articles. */
  shops: z.array(shopSchema).max(10).default([]),

  // --- Réglages avancés ---
  /** Salons où aucune monnaie n'est gagnée (messages et vocal). */
  ignoredChannelIds: z.array(z.string()).default([]),
  /** Rôles dont les membres ne gagnent pas de monnaie. */
  ignoredRoleIds: z.array(z.string()).default([]),
  /** Gain de monnaie en vocal activé. */
  voiceEnabled: z.boolean().default(false),
  /** Monnaie gagnée par minute passée en vocal (membre actif, non seul). */
  voicePerMinute: z.number().int().min(0).max(10_000).default(5),
  /** Salon où maintenir un classement auto (les plus riches). `null` = désactivé. */
  leaderboardChannelId: z.string().nullable().default(null),
  /** Message du classement auto (géré par le bot). */
  leaderboardMessageId: z.string().nullable().default(null),
});

export type ShopItem = z.infer<typeof shopItemSchema>;
export type Shop = z.infer<typeof shopSchema>;
export type EconomyConfig = z.infer<typeof economyConfigSchema>;

export const economyDefaultConfig: EconomyConfig = {
  currencyName: 'pièces',
  currencySymbol: '🪙',
  messageMin: 1,
  messageMax: 3,
  messageCooldown: 60,
  dailyAmount: 100,
  shop: [],
  shops: [],
  ignoredChannelIds: [],
  ignoredRoleIds: [],
  voiceEnabled: false,
  voicePerMinute: 5,
  leaderboardChannelId: null,
  leaderboardMessageId: null,
};

export async function getEconomyConfig(ctx: BotContext, guildId: string): Promise<EconomyConfig> {
  const state = await ctx.config.getModuleState<EconomyConfig>(
    guildId,
    MODULE_NAME,
    economyConfigSchema,
  );
  const config = state.config;

  // Migration paresseuse : l'ancienne boutique unique `shop` devient une
  // boutique nommée dans `shops` (une seule fois, puis `shop` est vidée).
  if (config.shop.length > 0 && config.shops.length === 0) {
    const migrated: EconomyConfig = {
      ...config,
      shops: [
        {
          id: 'default',
          name: 'Boutique',
          bannerUrl: null,
          items: config.shop.map((item) => ({ ...item, stock: item.stock ?? -1 })),
        },
      ],
      shop: [],
    };
    await ctx.config.setConfig(guildId, MODULE_NAME, migrated);
    return migrated;
  }
  return config;
}

export async function updateEconomyConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<EconomyConfig>,
): Promise<EconomyConfig> {
  const current = await getEconomyConfig(ctx, guildId);
  const updated: EconomyConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}

/** Formate un montant avec le symbole de la monnaie du serveur. */
export function formatMoney(config: EconomyConfig, amount: number): string {
  return `**${amount.toLocaleString('fr-FR')}** ${config.currencySymbol}`;
}
