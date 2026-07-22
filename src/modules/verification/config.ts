import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'verification';

/** Méthodes de vérification proposées. */
export const VERIFICATION_METHODS = ['button', 'captcha'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

const DEFAULT_CONTENT =
  'Pour accéder au serveur, clique sur le bouton ci-dessous et valide la vérification.\n' +
  'Cette étape nous protège des bots et des comptes indésirables. Merci ! 🔐';

/**
 * Configuration du module « Vérification » : un message publié dans un salon
 * d'accueil, avec un bouton qui déclenche la vérification (simple clic ou
 * captcha image) et attribue le **rôle vérifié** débloquant le reste du serveur.
 */
export const verificationConfigSchema = z.object({
  channelId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  roleId: z.string().nullable().default(null),
  method: z.enum(VERIFICATION_METHODS).default('captcha'),
  title: z.string().min(1).max(256).default('🔐 Vérification'),
  content: z.string().min(1).max(4000).default(DEFAULT_CONTENT),
  buttonLabel: z.string().min(1).max(80).default('✅ Se vérifier'),
  logChannelId: z.string().nullable().default(null),
});

export type VerificationConfig = z.infer<typeof verificationConfigSchema>;

export const verificationDefaultConfig: VerificationConfig = {
  channelId: null,
  messageId: null,
  roleId: null,
  method: 'captcha',
  title: '🔐 Vérification',
  content: DEFAULT_CONTENT,
  buttonLabel: '✅ Se vérifier',
  logChannelId: null,
};

export async function getVerificationConfig(
  ctx: BotContext,
  guildId: string,
): Promise<VerificationConfig> {
  const state = await ctx.config.getModuleState<VerificationConfig>(
    guildId,
    MODULE_NAME,
    verificationConfigSchema,
  );
  return state.config;
}

export async function updateVerificationConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<VerificationConfig>,
): Promise<VerificationConfig> {
  const current = await getVerificationConfig(ctx, guildId);
  const updated: VerificationConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
