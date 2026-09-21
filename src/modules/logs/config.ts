import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

export const MODULE_NAME = 'logs';

export const logsConfigSchema = z.object({
  logChannelId: z.string().nullable().default(null),
  messages: z.boolean().default(true),
  members: z.boolean().default(true),
  channels: z.boolean().default(true),
  roles: z.boolean().default(true),
  moderation: z.boolean().default(true),
  invites: z.boolean().default(true),
});

export type LogsConfig = z.infer<typeof logsConfigSchema>;
export type LogCategory = keyof Pick<
  LogsConfig,
  'messages' | 'members' | 'channels' | 'roles' | 'moderation' | 'invites'
>;

export const logsDefaultConfig: LogsConfig = {
  logChannelId: null,
  messages: true,
  members: true,
  channels: true,
  roles: true,
  moderation: true,
  invites: true,
};

export async function getLogsConfig(ctx: BotContext, guildId: string): Promise<LogsConfig> {
  const state = await ctx.config.getModuleState<LogsConfig>(guildId, MODULE_NAME, logsConfigSchema);
  return state.config;
}

/**
 * Le suivi des invitations tourne-t-il sur ce serveur ?
 *
 * Volontairement plus permissif que `isLogCategoryEnabled` : celui-ci exige un
 * salon de logs, parce qu'il décide d'une PUBLICATION. Ici on décide de
 * MÉMORISER — rattacher une arrivée à l'invitation qui l'a amenée. Ce lien ne
 * se retrouve plus après coup : exiger un salon reviendrait à perdre
 * définitivement l'historique d'un serveur qui consulte `/invitations` sans
 * vouloir en publier une ligne.
 */
export async function isInviteTrackingEnabled(ctx: BotContext, guildId: string): Promise<boolean> {
  const state = await ctx.config.getModuleState<LogsConfig>(guildId, MODULE_NAME, logsConfigSchema);
  return state.enabled && state.config.invites;
}
