import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'tickets';

const DEFAULT_DESCRIPTION =
  'Besoin d’aide ? Choisis le type de ticket ci-dessous pour ouvrir un salon privé avec l’équipe concernée.';

/**
 * Un type de ticket : un bouton du panneau, avec sa liste de rôles autorisés à
 * voir/prendre les tickets de ce type (en plus de l'auteur et du bot).
 */
const ticketTypeSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  emoji: z.string().max(64).default(''),
  /** Préfixe des salons (ex. `Sup` → `sup-0001`). Vide = nom `type-pseudo`. */
  prefix: z.string().max(20).default(''),
  roleIds: z.array(z.string()).max(20).default([]),
});

export type TicketType = z.infer<typeof ticketTypeSchema>;

/**
 * Configuration du module « Tickets » : panneau publié avec un bouton par type,
 * catégorie où créer les salons, salon d'archivage des transcripts, et limite
 * de tickets simultanés par membre.
 */
/** Comment matérialiser un ticket : salon privé dans une catégorie, ou fil privé. */
export const ticketModeSchema = z.enum(['channel', 'thread']);
export type TicketMode = z.infer<typeof ticketModeSchema>;

export const ticketsConfigSchema = z.object({
  panelChannelId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  categoryId: z.string().nullable().default(null),
  archiveChannelId: z.string().nullable().default(null),
  title: z.string().min(1).max(256).default('🎫 Support'),
  description: z.string().min(1).max(2000).default(DEFAULT_DESCRIPTION),
  maxOpen: z.number().int().min(1).max(10).default(1),
  /** Salon privé (catégorie) ou fil privé dans le salon du panneau. */
  mode: ticketModeSchema.default('channel'),
  /** Format de nom : `{type}`, `{number}`, `{count}`, `{user}`, `{id}`. */
  nameFormat: z.string().min(1).max(60).default('{type}-{number}'),
  types: z.array(ticketTypeSchema).max(25).default([]),
});

export type TicketsConfig = z.infer<typeof ticketsConfigSchema>;

export const ticketsDefaultConfig: TicketsConfig = {
  panelChannelId: null,
  messageId: null,
  categoryId: null,
  archiveChannelId: null,
  title: '🎫 Support',
  description: DEFAULT_DESCRIPTION,
  maxOpen: 1,
  mode: 'channel',
  nameFormat: '{type}-{number}',
  types: [],
};

export async function getTicketsConfig(ctx: BotContext, guildId: string): Promise<TicketsConfig> {
  const state = await ctx.config.getModuleState<TicketsConfig>(
    guildId,
    MODULE_NAME,
    ticketsConfigSchema,
  );
  return state.config;
}

export async function updateTicketsConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<TicketsConfig>,
): Promise<TicketsConfig> {
  const current = await getTicketsConfig(ctx, guildId);
  const updated: TicketsConfig = { ...current, ...patch };
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
