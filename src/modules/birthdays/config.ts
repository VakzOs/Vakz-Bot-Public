import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'birthdays';

export const birthdaysConfigSchema = z.object({
  channelId: z.string().nullable().default(null),
  /** Rôle attribué le jour de l'anniversaire (optionnel). */
  roleId: z.string().nullable().default(null),
  message: z.string().min(1).max(2000).default('🎂 Joyeux anniversaire {mention} ! 🎉'),
  /** Heure d'annonce (0-23) dans le fuseau du bot. */
  announceHour: z.number().int().min(0).max(23).default(9),
  /** Minute d'annonce (0-59). */
  announceMinute: z.number().int().min(0).max(59).default(0),
});

export type BirthdaysConfig = z.infer<typeof birthdaysConfigSchema>;

export const birthdaysDefaultConfig: BirthdaysConfig = {
  channelId: null,
  roleId: null,
  message: '🎂 Joyeux anniversaire {mention} ! 🎉',
  announceHour: 9,
  announceMinute: 0,
};

export async function getBirthdaysConfig(
  ctx: BotContext,
  guildId: string,
): Promise<BirthdaysConfig> {
  const state = await ctx.config.getModuleState<BirthdaysConfig>(
    guildId,
    MODULE_NAME,
    birthdaysConfigSchema,
  );
  return state.config;
}

export async function updateBirthdaysConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<BirthdaysConfig>,
): Promise<BirthdaysConfig> {
  const current = await getBirthdaysConfig(ctx, guildId);
  const updated: BirthdaysConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
