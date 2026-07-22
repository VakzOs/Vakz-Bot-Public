import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type MessageActionRowComponentBuilder,
  type TextChannel,
} from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import { recordSanction } from '../moderation/service.js';
import { type AutomodAction, type AutomodConfig } from './config.js';

const MAX_TIMEOUT_MS = 28 * 86_400_000;
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[-\w]+/i;
const URL_RE = /https?:\/\/[^\s/$.?#].[^\s]*/i;
const URL_GLOBAL_RE = /https?:\/\/([^\s/$.?#].[^\s]*)/gi;
const OLD_HONEYPOT_TITLE = 'DO NOT SEND MESSAGES IN THIS CHANNEL';
const OLD_HONEYPOT_DESCRIPTION =
  'This channel is used to catch compromised accounts. Any messages sent here will result in an immediate ban.';
const OLD_HONEYPOT_REASON = 'Honeypot channel triggered';

interface Violation {
  rule: string;
  action: AutomodAction;
  reason: string;
  detail: string;
  timeoutMinutes?: number;
}

const spamBuckets = new Map<string, number[]>();

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function trimBucket(values: number[], windowMs: number, now: number): number[] {
  return values.filter((value) => now - value <= windowMs);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function clip(value: string, max = 900): string {
  const text = value.trim();
  return text.length > max
    ? `${text.slice(0, max - 3)}...`
    : text || t('modules.automod.log.empty');
}

function actionLabel(action: AutomodAction): string {
  return t(`modules.automod.actions.${action}`);
}

export function isAutomodBypassed(member: GuildMember, config: AutomodConfig): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return member.roles.cache.some((role) => config.ignoredRoleIds.includes(role.id));
}

function hasAllowedDomain(content: string, allowlist: string[]): boolean {
  const allowed = allowlist.map((item) => item.toLowerCase().trim()).filter(Boolean);
  if (allowed.length === 0) return false;

  for (const match of content.matchAll(URL_GLOBAL_RE)) {
    const host = match[1]?.split('/')[0]?.toLowerCase() ?? '';
    if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  }
  return true;
}

function containsBadWord(content: string, words: string[]): string | null {
  const normalized = normalize(content);
  return (
    words.find((word) => {
      const clean = normalize(word).trim();
      return clean.length > 0 && normalized.includes(clean);
    }) ?? null
  );
}

function capsPercent(content: string): number {
  const letters = [...content].filter((char) => /\p{L}/u.test(char));
  if (letters.length === 0) return 0;
  const caps = letters.filter((char) => char === char.toUpperCase() && char !== char.toLowerCase());
  return Math.round((caps.length / letters.length) * 100);
}

export function findViolation(message: Message<true>, config: AutomodConfig): Violation | null {
  if (config.ignoredChannelIds.includes(message.channelId)) return null;

  const content = message.content ?? '';
  const spam = config.spam;
  if (spam.enabled) {
    const now = Date.now();
    const windowMs = spam.windowSeconds * 1000;
    const bucketKey = key(message.guildId, message.author.id);
    const bucket = trimBucket(spamBuckets.get(bucketKey) ?? [], windowMs, now);
    bucket.push(now);
    spamBuckets.set(bucketKey, bucket);

    if (bucket.length >= spam.maxMessages) {
      spamBuckets.set(bucketKey, []);
      return {
        rule: 'spam',
        action: spam.action,
        timeoutMinutes: spam.timeoutMinutes,
        reason: t('modules.automod.reason.spam', {
          count: spam.maxMessages,
          seconds: spam.windowSeconds,
        }),
        detail: t('modules.automod.detail.spam', {
          count: bucket.length,
          seconds: spam.windowSeconds,
        }),
      };
    }
  }

  if (config.invites.enabled && INVITE_RE.test(content)) {
    return {
      rule: 'invites',
      action: config.invites.action,
      reason: t('modules.automod.reason.invites'),
      detail: clip(content),
    };
  }

  if (
    config.links.enabled &&
    URL_RE.test(content) &&
    !hasAllowedDomain(content, config.links.allowlist)
  ) {
    return {
      rule: 'links',
      action: config.links.action,
      reason: t('modules.automod.reason.links'),
      detail: clip(content),
    };
  }

  if (config.badWords.enabled) {
    const word = containsBadWord(content, config.badWords.words);
    if (word) {
      return {
        rule: 'badWords',
        action: config.badWords.action,
        timeoutMinutes: config.badWords.timeoutMinutes,
        reason: t('modules.automod.reason.badWords'),
        detail: t('modules.automod.detail.badWords', { word }),
      };
    }
  }

  if (config.mentions.enabled && message.mentions.users.size >= config.mentions.maxMentions) {
    return {
      rule: 'mentions',
      action: config.mentions.action,
      timeoutMinutes: config.mentions.timeoutMinutes,
      reason: t('modules.automod.reason.mentions'),
      detail: t('modules.automod.detail.mentions', { count: message.mentions.users.size }),
    };
  }

  if (config.caps.enabled && content.length >= config.caps.minLength) {
    const percent = capsPercent(content);
    if (percent >= config.caps.percent) {
      return {
        rule: 'caps',
        action: config.caps.action,
        reason: t('modules.automod.reason.caps'),
        detail: t('modules.automod.detail.caps', { percent }),
      };
    }
  }

  return null;
}

async function deleteMessage(message: Message<true>): Promise<void> {
  if (!message.deletable) return;
  await message.delete().catch(() => undefined);
}

async function canActOn(member: GuildMember): Promise<boolean> {
  const me = member.guild.members.me;
  if (!me) return false;
  if (member.id === member.guild.ownerId) return false;
  if (member.id === me.id) return false;
  return member.roles.highest.position < me.roles.highest.position;
}

function timeoutMs(minutes: number | undefined): number {
  return Math.min((minutes ?? 10) * 60_000, MAX_TIMEOUT_MS);
}

export async function logIncident(
  ctx: BotContext,
  guild: Guild,
  config: AutomodConfig,
  data: {
    userId: string;
    channelId: string;
    messageId?: string | null;
    rule: string;
    action: AutomodAction | 'honeypot';
    reason: string;
    detail: string;
  },
): Promise<void> {
  await ctx.db.automodIncident.create({
    data: {
      guildId: guild.id,
      userId: data.userId,
      channelId: data.channelId,
      messageId: data.messageId ?? null,
      rule: data.rule,
      action: data.action,
      reason: data.reason,
      detail: data.detail,
    },
  });

  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(
      data.action === 'honeypot' || data.action === 'ban' || data.action === 'kick'
        ? Colors.error
        : Colors.warning,
    )
    .setTitle(t('modules.automod.log.title'))
    .addFields(
      { name: t('modules.automod.log.member'), value: `<@${data.userId}>`, inline: true },
      {
        name: t('modules.automod.log.rule'),
        value: t(`modules.automod.rules.${data.rule}`),
        inline: true,
      },
      {
        name: t('modules.automod.log.action'),
        value:
          data.action === 'honeypot'
            ? t('modules.automod.honeypot.action')
            : actionLabel(data.action),
        inline: true,
      },
      { name: t('modules.automod.log.channel'), value: `<#${data.channelId}>`, inline: true },
      { name: t('modules.automod.log.reason'), value: data.reason },
      { name: t('modules.automod.log.detail'), value: clip(data.detail, 1000) },
    )
    .setTimestamp();

  await (channel as GuildTextBasedChannel).send({ embeds: [embed] }).catch(() => undefined);
}

export async function applyViolation(
  ctx: BotContext,
  message: Message<true>,
  config: AutomodConfig,
  violation: Violation,
): Promise<void> {
  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;

  await deleteMessage(message);

  if (violation.action === 'warn') {
    await recordSanction(ctx, message.guild, {
      type: 'warn',
      userId: member.id,
      moderatorId: message.client.user.id,
      reason: violation.reason,
    });
  }

  if (violation.action === 'timeout' && (await canActOn(member))) {
    const duration = timeoutMs(violation.timeoutMinutes);
    await member.timeout(duration, violation.reason).catch(() => undefined);
    await recordSanction(ctx, message.guild, {
      type: 'timeout',
      userId: member.id,
      moderatorId: message.client.user.id,
      reason: violation.reason,
      expiresAt: new Date(Date.now() + duration),
    });
  }

  if (violation.action === 'kick' && (await canActOn(member))) {
    await member.kick(violation.reason).catch(() => undefined);
    await recordSanction(ctx, message.guild, {
      type: 'kick',
      userId: member.id,
      moderatorId: message.client.user.id,
      reason: violation.reason,
    });
  }

  if (violation.action === 'ban' && (await canActOn(member))) {
    await message.guild.members.ban(member.id, { reason: violation.reason }).catch(() => undefined);
    await recordSanction(ctx, message.guild, {
      type: 'ban',
      userId: member.id,
      moderatorId: message.client.user.id,
      reason: violation.reason,
    });
  }

  await logIncident(ctx, message.guild, config, {
    userId: member.id,
    channelId: message.channelId,
    messageId: message.id,
    rule: violation.rule,
    action: violation.action,
    reason: violation.reason,
    detail: violation.detail,
  });
}

export async function handleHoneypotMessage(
  ctx: BotContext,
  message: Message<true>,
  config: AutomodConfig,
): Promise<boolean> {
  if (!config.honeypot.enabled || message.channelId !== config.honeypot.channelId) return false;
  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isAutomodBypassed(member, config)) return true;

  await deleteMessage(message);
  const reason = honeypotReason(config);
  if (await canActOn(member)) {
    await message.guild.members.ban(member.id, { reason }).catch(() => undefined);
    await recordSanction(ctx, message.guild, {
      type: 'ban',
      userId: member.id,
      moderatorId: message.client.user.id,
      reason,
    });
  }

  await logIncident(ctx, message.guild, config, {
    userId: member.id,
    channelId: message.channelId,
    messageId: message.id,
    rule: 'honeypot',
    action: 'honeypot',
    reason,
    detail: message.content || t('modules.automod.log.empty'),
  });
  await syncHoneypotMessage(ctx, message.guild, config);
  return true;
}

export async function countHoneypotBans(ctx: BotContext, guildId: string): Promise<number> {
  return ctx.db.automodIncident.count({ where: { guildId, rule: 'honeypot' } });
}

function honeypotTitle(config: AutomodConfig): string {
  return config.honeypot.title === OLD_HONEYPOT_TITLE
    ? t('modules.automod.honeypot.embedTitle')
    : config.honeypot.title;
}

function honeypotDescription(config: AutomodConfig): string {
  return config.honeypot.description === OLD_HONEYPOT_DESCRIPTION
    ? t('modules.automod.honeypot.embedDescription')
    : config.honeypot.description;
}

function honeypotReason(config: AutomodConfig): string {
  return config.honeypot.banReason === OLD_HONEYPOT_REASON
    ? t('modules.automod.honeypot.banReason')
    : config.honeypot.banReason;
}

export async function buildHoneypotEmbed(
  ctx: BotContext,
  guildId: string,
  config: AutomodConfig,
): Promise<EmbedBuilder> {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(honeypotTitle(config))
    .setDescription(honeypotDescription(config));
}

export async function buildHoneypotComponents(
  ctx: BotContext,
  guildId: string,
): Promise<ActionRowBuilder<MessageActionRowComponentBuilder>[]> {
  const bans = await countHoneypotBans(ctx, guildId);
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('automod|honeypot-bans')
        .setLabel(t('modules.automod.honeypot.counter', { count: bans }))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    ),
  ];
}

export async function syncHoneypotMessage(
  ctx: BotContext,
  guild: Guild,
  config: AutomodConfig,
): Promise<string | null> {
  if (!config.honeypot.channelId) return null;
  const channel = await guild.channels.fetch(config.honeypot.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const payload = {
    embeds: [await buildHoneypotEmbed(ctx, guild.id, config)],
    components: await buildHoneypotComponents(ctx, guild.id),
  };
  if (config.honeypot.messageId) {
    const existing = await channel.messages.fetch(config.honeypot.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => undefined);
      return existing.id;
    }
  }

  const sent = await (channel as GuildTextBasedChannel).send(payload).catch(() => null);
  return sent?.id ?? null;
}

export async function createHoneypotChannel(guild: Guild): Promise<TextChannel | null> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;

  return guild.channels
    .create({
      name: 'do-not-send-here',
      type: ChannelType.GuildText,
      topic: t('modules.automod.honeypot.topic'),
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
      reason: t('modules.automod.honeypot.createReason'),
    })
    .catch(() => null);
}
