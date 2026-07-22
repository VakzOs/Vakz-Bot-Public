import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'scheduledmessages';

/** Nombre maximal de messages programmés par serveur. */
export const MAX_MESSAGES = 25;

/** Cadences proposées. */
export const SCHEDULE_TYPES = ['daily', 'weekly', 'interval'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

/** Heure « HH:MM » sur 24 h. */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .default('12:00');

/**
 * Cadence d'un message programmé :
 * - `daily` : tous les jours à `time` ;
 * - `weekly` : chaque `weekday` (0 = dimanche) à `time` ;
 * - `interval` : toutes les `hours` heures.
 * Les heures sont exprimées dans le fuseau du bot (`TZ`, Europe/Paris en prod).
 */
export const scheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily'), time: timeSchema }),
  z.object({
    type: z.literal('weekly'),
    weekday: z.number().int().min(0).max(6).default(1),
    time: timeSchema,
  }),
  z.object({ type: z.literal('interval'), hours: z.number().int().min(1).max(168).default(24) }),
]);

export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduledMessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  content: z.string().min(1).max(2000),
  asEmbed: z.boolean().default(false),
  schedule: scheduleSchema,
  /** Dernier envoi (ms epoch) — anti-doublon et base des cadences par intervalle. */
  lastPosted: z.number().int().default(0),
});

export type ScheduledMessage = z.infer<typeof scheduledMessageSchema>;

export const scheduledmessagesConfigSchema = z.object({
  messages: z.array(scheduledMessageSchema).max(MAX_MESSAGES).default([]),
});

export type ScheduledmessagesConfig = z.infer<typeof scheduledmessagesConfigSchema>;

export const scheduledmessagesDefaultConfig: ScheduledmessagesConfig = { messages: [] };

export async function getScheduledmessagesConfig(
  ctx: BotContext,
  guildId: string,
): Promise<ScheduledmessagesConfig> {
  const state = await ctx.config.getModuleState<ScheduledmessagesConfig>(
    guildId,
    MODULE_NAME,
    scheduledmessagesConfigSchema,
  );
  return state.config;
}

export async function updateScheduledmessagesConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<ScheduledmessagesConfig>,
): Promise<ScheduledmessagesConfig> {
  const current = await getScheduledmessagesConfig(ctx, guildId);
  const updated: ScheduledmessagesConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
