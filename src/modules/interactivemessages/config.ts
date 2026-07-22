import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'interactivemessages';

/** Styles de bouton proposés pour les boutons de rôle. */
export const BUTTON_STYLES = ['primary', 'secondary', 'success', 'danger'] as const;
export type ButtonStyleName = (typeof BUTTON_STYLES)[number];

/**
 * Un bouton d'un message interactif : soit un bouton de rôle (clic = ajout/retrait
 * du rôle), soit un bouton lien (ouvre une URL). Les liens n'ont pas de handler :
 * Discord les gère nativement.
 */
const buttonSchema = z.object({
  id: z.string(),
  type: z.enum(['role', 'link']),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).default(''),
  roleId: z.string().nullable().default(null),
  url: z.string().max(512).nullable().default(null),
  style: z.enum(BUTTON_STYLES).default('secondary'),
});

/**
 * Un « message interactif » : un embed (titre, description, couleur) publié dans
 * un salon, accompagné de boutons de rôle et/ou de liens.
 */
const panelSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  channelId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  title: z.string().max(256).default(''),
  description: z.string().max(2000).default(''),
  /** Couleur de l'embed (entier RGB) ; `null` = couleur de marque. */
  color: z.number().int().min(0).max(0xffffff).nullable().default(null),
  buttons: z.array(buttonSchema).max(25).default([]),
});

export const interactiveMessagesConfigSchema = z.object({
  panels: z.array(panelSchema).max(25).default([]),
});

export type InteractiveButton = z.infer<typeof buttonSchema>;
export type InteractivePanel = z.infer<typeof panelSchema>;
export type InteractiveMessagesConfig = z.infer<typeof interactiveMessagesConfigSchema>;

export const interactiveMessagesDefaultConfig: InteractiveMessagesConfig = {
  panels: [],
};

export async function getInteractiveMessagesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<InteractiveMessagesConfig> {
  const state = await ctx.config.getModuleState<InteractiveMessagesConfig>(
    guildId,
    MODULE_NAME,
    interactiveMessagesConfigSchema,
  );
  return state.config;
}

export async function updateInteractiveMessagesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<InteractiveMessagesConfig>,
): Promise<InteractiveMessagesConfig> {
  const current = await getInteractiveMessagesConfig(ctx, guildId);
  const updated: InteractiveMessagesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
