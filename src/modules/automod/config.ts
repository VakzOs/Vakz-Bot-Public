import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

export const MODULE_NAME = 'automod';

const actionSchema = z.enum(['delete', 'warn', 'timeout', 'kick', 'ban']);

const ruleSchema = z.object({
  enabled: z.boolean().default(false),
  action: actionSchema.default('delete'),
});

export const automodConfigSchema = z.object({
  logChannelId: z.string().nullable().default(null),
  ignoredChannelIds: z.array(z.string()).default([]),
  ignoredRoleIds: z.array(z.string()).default([]),
  spam: ruleSchema
    .extend({
      maxMessages: z.number().int().min(2).max(20).default(5),
      windowSeconds: z.number().int().min(3).max(60).default(10),
      timeoutMinutes: z.number().int().min(1).max(40320).default(10),
    })
    .default({
      enabled: true,
      action: 'timeout',
      maxMessages: 5,
      windowSeconds: 10,
      timeoutMinutes: 10,
    }),
  invites: ruleSchema.default({ enabled: true, action: 'warn' }),
  links: ruleSchema
    .extend({
      allowlist: z.array(z.string()).default([]),
    })
    .default({ enabled: false, action: 'warn', allowlist: [] }),
  badWords: ruleSchema
    .extend({
      words: z.array(z.string()).default([]),
      timeoutMinutes: z.number().int().min(1).max(40320).default(30),
    })
    .default({ enabled: false, action: 'timeout', words: [], timeoutMinutes: 30 }),
  mentions: ruleSchema
    .extend({
      maxMentions: z.number().int().min(3).max(50).default(8),
      timeoutMinutes: z.number().int().min(1).max(40320).default(10),
    })
    .default({ enabled: true, action: 'timeout', maxMentions: 8, timeoutMinutes: 10 }),
  caps: ruleSchema
    .extend({
      minLength: z.number().int().min(8).max(300).default(20),
      percent: z.number().int().min(50).max(100).default(75),
    })
    .default({ enabled: false, action: 'delete', minLength: 20, percent: 75 }),
  honeypot: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().nullable().default(null),
      messageId: z.string().nullable().default(null),
      title: z.string().max(256).default('NE PAS ENVOYER DE MESSAGES DANS CE SALON'),
      description: z
        .string()
        .max(2000)
        .default(
          'Ce salon sert à détecter les comptes compromis. Tout message envoyé ici entraînera un bannissement immédiat.',
        ),
      emoji: z.string().max(32).default('\u{1F36F}'),
      banReason: z.string().max(500).default('Honeypot déclenché'),
    })
    .default({
      enabled: false,
      channelId: null,
      messageId: null,
      title: 'NE PAS ENVOYER DE MESSAGES DANS CE SALON',
      description:
        'Ce salon sert à détecter les comptes compromis. Tout message envoyé ici entraînera un bannissement immédiat.',
      emoji: '\u{1F36F}',
      banReason: 'Honeypot déclenché',
    }),
});

export type AutomodConfig = z.infer<typeof automodConfigSchema>;
export type AutomodAction = z.infer<typeof actionSchema>;

export const automodDefaultConfig: AutomodConfig = automodConfigSchema.parse({});

export async function getAutomodConfig(ctx: BotContext, guildId: string): Promise<AutomodConfig> {
  const state = await ctx.config.getModuleState<AutomodConfig>(
    guildId,
    MODULE_NAME,
    automodConfigSchema,
  );
  return state.config;
}

export async function updateAutomodConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<AutomodConfig>,
): Promise<AutomodConfig> {
  const current = await getAutomodConfig(ctx, guildId);
  const updated: AutomodConfig = automodConfigSchema.parse({ ...current, ...patch });
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
