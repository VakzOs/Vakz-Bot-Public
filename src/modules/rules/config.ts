import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'rules';

const DEFAULT_CONTENT =
  'Bienvenue ! Merci de lire attentivement le règlement ci-dessous.\n\n' +
  '1. Reste courtois et respectueux envers les autres membres.\n' +
  '2. Pas de spam, de publicité non sollicitée ni de contenu interdit.\n' +
  '3. Respecte les décisions du staff.\n\n' +
  'En cliquant sur le bouton ci-dessous, tu confirmes avoir lu et accepté ce règlement.';

/**
 * Configuration du module « Règlement » : un message de règlement publié dans un
 * salon, avec un bouton d'acceptation qui attribue un rôle d'accès. `version`
 * permet de demander une re-validation lorsque le règlement évolue.
 */
export const rulesConfigSchema = z.object({
  channelId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  roleId: z.string().nullable().default(null),
  title: z.string().min(1).max(256).default('📜 Règlement du serveur'),
  content: z.string().min(1).max(4000).default(DEFAULT_CONTENT),
  buttonLabel: z.string().min(1).max(80).default("✅ J'accepte le règlement"),
  version: z.number().int().min(1).default(1),
  logChannelId: z.string().nullable().default(null),
});

export type RulesConfig = z.infer<typeof rulesConfigSchema>;

export const rulesDefaultConfig: RulesConfig = {
  channelId: null,
  messageId: null,
  roleId: null,
  title: '📜 Règlement du serveur',
  content: DEFAULT_CONTENT,
  buttonLabel: "✅ J'accepte le règlement",
  version: 1,
  logChannelId: null,
};

export async function getRulesConfig(ctx: BotContext, guildId: string): Promise<RulesConfig> {
  const state = await ctx.config.getModuleState<RulesConfig>(
    guildId,
    MODULE_NAME,
    rulesConfigSchema,
  );
  return state.config;
}

export async function updateRulesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<RulesConfig>,
): Promise<RulesConfig> {
  const current = await getRulesConfig(ctx, guildId);
  const updated: RulesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
