import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'welcome';

/** Configuration d'un message d'accueil ou d'au revoir. */
const greetSchema = z.object({
  enabled: z.boolean(),
  channelId: z.string().nullable(),
  message: z.string().min(1).max(2000),
  embed: z.boolean(),
  // Pied de page de l'embed, éditable et optionnel. `.default('')` garde la
  // compatibilité avec les configs enregistrées avant l'ajout de ce champ.
  footer: z.string().max(256).default(''),
  // Carte-image générée (avatar + nom sur une image de fond). `.default` assure
  // la compatibilité avec les configs enregistrées avant l'ajout de ces champs.
  card: z.boolean().default(false),
  cardBackground: z.string().max(500).default(''),
});

export type GreetConfig = z.infer<typeof greetSchema>;
export type GreetKind = 'welcome' | 'leave';

const DEFAULT_WELCOME: GreetConfig = {
  enabled: true,
  channelId: null,
  message: 'Bienvenue {mention} sur **{server}** ! 🎉 Tu es notre {count}ᵉ membre.',
  embed: true,
  footer: '',
  card: false,
  cardBackground: '',
};

const DEFAULT_LEAVE: GreetConfig = {
  enabled: true,
  channelId: null,
  message: '**{username}** vient de quitter **{server}**. 👋',
  embed: false,
  footer: '',
  card: false,
  cardBackground: '',
};

/** Schéma complet de la configuration du module (validé par zod). */
export const welcomeConfigSchema = z.object({
  welcome: greetSchema.default(DEFAULT_WELCOME),
  leave: greetSchema.default(DEFAULT_LEAVE),
});

export type WelcomeConfig = z.infer<typeof welcomeConfigSchema>;

/** Config appliquée à l'activation du module (salons à définir ensuite). */
export const welcomeDefaultConfig: WelcomeConfig = {
  welcome: DEFAULT_WELCOME,
  leave: DEFAULT_LEAVE,
};

/** Lit la configuration du module pour un serveur (avec valeurs par défaut). */
export async function getWelcomeConfig(ctx: BotContext, guildId: string): Promise<WelcomeConfig> {
  const state = await ctx.config.getModuleState<WelcomeConfig>(
    guildId,
    MODULE_NAME,
    welcomeConfigSchema,
  );
  return state.config;
}

/** Met à jour partiellement la config d'accueil ou d'au revoir et la persiste. */
export async function updateGreetConfig(
  ctx: BotContext,
  guildId: string,
  kind: GreetKind,
  patch: Partial<GreetConfig>,
): Promise<WelcomeConfig> {
  const current = await getWelcomeConfig(ctx, guildId);
  const updated: WelcomeConfig = {
    ...current,
    [kind]: { ...current[kind], ...patch },
  };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
