import {
  ChannelType,
  PermissionFlagsBits,
  type APIEmbed,
  type AttachmentPayload,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type GuildTextBasedChannel,
  type Message,
  type OverwriteData,
  type OverwriteType,
  type PartialMessage,
  type PermissionOverwrites,
  type Role,
  type Webhook,
  type ChannelWebhookCreateOptions,
  type WebhookMessageCreateOptions,
  type WebhookType,
} from 'discord.js';

export type RollbackKind = 'messageDelete' | 'channelDelete' | 'roleDelete';

export interface MessageAttachmentSnapshot {
  url: string;
  name: string;
  contentType: string | null;
}

export interface MessageRollbackPayload {
  channelId: string;
  authorId: string | null;
  authorName: string;
  authorTag: string | null;
  authorAvatarUrl: string | null;
  content: string;
  embeds?: APIEmbed[];
  attachments: MessageAttachmentSnapshot[];
}

interface PermissionOverwriteSnapshot {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

interface ChannelRollbackPayload {
  name: string;
  type: GuildChannelCreateOptions['type'];
  parentId: string | null;
  position: number | null;
  topic: string | null;
  nsfw: boolean | null;
  rateLimitPerUser: number | null;
  bitrate: number | null;
  userLimit: number | null;
  permissionOverwrites: PermissionOverwriteSnapshot[];
}

interface RoleRollbackPayload {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
  unicodeEmoji: string | null;
}

export type RollbackResult =
  | { ok: true }
  | { ok: false; error: 'missing' | 'unsupported' | 'noPermission' | 'failed' };

type WebhookCapableChannel = GuildTextBasedChannel & {
  createWebhook(options: ChannelWebhookCreateOptions): Promise<Webhook<WebhookType.Incoming>>;
};

type ChannelWithOverwrites = GuildBasedChannel & {
  permissionOverwrites: { cache: { values(): Iterable<PermissionOverwrites> } };
};

type MovableChannel = {
  setPosition(position: number, options?: { reason?: string }): Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' ? value : null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function parsePayload<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function clipDiscord(value: string, limit = 1900): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function isWebhookCapable(channel: GuildTextBasedChannel): channel is WebhookCapableChannel {
  return 'createWebhook' in channel;
}

function isMovableChannel(channel: unknown): channel is MovableChannel {
  return isRecord(channel) && typeof channel.setPosition === 'function';
}

function isRestorableChannelType(
  type: ChannelType,
): type is NonNullable<GuildChannelCreateOptions['type']> {
  return (
    type === ChannelType.GuildText ||
    type === ChannelType.GuildAnnouncement ||
    type === ChannelType.GuildVoice ||
    type === ChannelType.GuildStageVoice ||
    type === ChannelType.GuildCategory ||
    type === ChannelType.GuildForum ||
    type === ChannelType.GuildMedia
  );
}

export function buildMessageRollback(message: Message | PartialMessage): MessageRollbackPayload {
  const author = message.author;
  return {
    channelId: message.channelId,
    authorId: author?.id ?? null,
    authorName: author?.username ?? author?.tag ?? 'Utilisateur',
    authorTag: author?.tag ?? null,
    authorAvatarUrl: author?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
    content: message.content ?? '',
    embeds: message.embeds.map((embed) => embed.toJSON()),
    attachments: [...message.attachments.values()].map((attachment) => ({
      url: attachment.url,
      name: attachment.name ?? 'attachment',
      contentType: attachment.contentType ?? null,
    })),
  };
}

export function buildChannelRollback(channel: GuildBasedChannel): ChannelRollbackPayload | null {
  if (!isRestorableChannelType(channel.type)) return null;

  const data = channel as unknown as Record<string, unknown>;
  const permissionOverwrites =
    'permissionOverwrites' in channel
      ? [...(channel as ChannelWithOverwrites).permissionOverwrites.cache.values()].map(
          (overwrite) => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString(),
          }),
        )
      : [];

  return {
    name: channel.name,
    type: channel.type,
    parentId: readString(data, 'parentId'),
    position: readNumber(data, 'rawPosition') ?? readNumber(data, 'position'),
    topic: readString(data, 'topic'),
    nsfw: readBoolean(data, 'nsfw'),
    rateLimitPerUser: readNumber(data, 'rateLimitPerUser'),
    bitrate: readNumber(data, 'bitrate'),
    userLimit: readNumber(data, 'userLimit'),
    permissionOverwrites,
  };
}

export function buildRoleRollback(role: Role): RoleRollbackPayload | null {
  if (role.managed || role.id === role.guild.id) return null;

  return {
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
    unicodeEmoji: role.unicodeEmoji ?? null,
  };
}

function rollbackReason(actorId: string): string {
  return `Rollback logs by ${actorId}`;
}

function attachmentFiles(payload: MessageRollbackPayload): AttachmentPayload[] {
  return payload.attachments.slice(0, 10).map((attachment) => ({
    attachment: attachment.url,
    name: attachment.name,
  }));
}

function attachmentLinks(payload: MessageRollbackPayload): string {
  return payload.attachments.map((attachment) => attachment.url).join('\n');
}

function messageEmbeds(payload: MessageRollbackPayload): APIEmbed[] {
  return payload.embeds ?? [];
}

export function messageRollbackHasData(payload: MessageRollbackPayload): boolean {
  return Boolean(
    payload.content.trim() || messageEmbeds(payload).length > 0 || payload.attachments.length > 0,
  );
}

async function sendMessageWithWebhook(
  channel: GuildTextBasedChannel,
  payload: MessageRollbackPayload,
  actorId: string,
): Promise<boolean> {
  const me = channel.guild.members.me;
  const permissions = me?.permissionsIn(channel);
  if (!permissions?.has(PermissionFlagsBits.ManageWebhooks) || !isWebhookCapable(channel)) {
    return false;
  }

  const rawContent =
    payload.content ||
    attachmentLinks(payload) ||
    (messageEmbeds(payload).length === 0 ? '*contenu indisponible*' : '');
  const options: WebhookMessageCreateOptions = {
    username: clipDiscord(payload.authorName, 80) || 'Utilisateur',
    avatarURL: payload.authorAvatarUrl ?? undefined,
    content: rawContent ? clipDiscord(rawContent) : undefined,
    embeds: messageEmbeds(payload),
    files: attachmentFiles(payload),
    allowedMentions: { parse: [] },
  };

  const webhook = await channel
    .createWebhook({ name: 'Vakz Rollback', reason: rollbackReason(actorId) })
    .catch(() => null);
  if (!webhook) return false;

  const sent = await webhook.send(options).catch(() => null);
  await webhook.delete(rollbackReason(actorId)).catch(() => undefined);
  return Boolean(sent);
}

async function restoreDeletedMessage(
  guild: Guild,
  payload: MessageRollbackPayload,
  actorId: string,
): Promise<RollbackResult> {
  const channel = await guild.channels.fetch(payload.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, error: 'missing' };

  const textChannel = channel as GuildTextBasedChannel;
  const me = guild.members.me;
  const permissions = me?.permissionsIn(textChannel);
  if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
    return { ok: false, error: 'noPermission' };
  }

  if (await sendMessageWithWebhook(textChannel, payload, actorId)) return { ok: true };

  const author = payload.authorId ? `<@${payload.authorId}>` : payload.authorName;
  const content = [`Message restaure de ${author}`, payload.content, attachmentLinks(payload)]
    .filter(Boolean)
    .join('\n');

  const sent = await textChannel
    .send({
      content: clipDiscord(content || `Message restaure de ${author}`, 2000),
      embeds: messageEmbeds(payload),
      files: attachmentFiles(payload),
      allowedMentions: { parse: [] },
    })
    .catch(() => null);

  return sent ? { ok: true } : { ok: false, error: 'failed' };
}

async function restoreDeletedChannel(
  guild: Guild,
  payload: ChannelRollbackPayload,
  actorId: string,
): Promise<RollbackResult> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, error: 'noPermission' };
  }

  const permissionOverwrites: OverwriteData[] = payload.permissionOverwrites.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: BigInt(overwrite.allow),
    deny: BigInt(overwrite.deny),
  }));

  const options: GuildChannelCreateOptions = {
    name: payload.name,
    type: payload.type,
    parent: payload.parentId ?? undefined,
    topic: payload.topic ?? undefined,
    nsfw: payload.nsfw ?? undefined,
    rateLimitPerUser: payload.rateLimitPerUser ?? undefined,
    bitrate: payload.bitrate ?? undefined,
    userLimit: payload.userLimit ?? undefined,
    permissionOverwrites,
    reason: rollbackReason(actorId),
  };

  const restored = await guild.channels.create(options).catch(() => null);
  if (!restored) return { ok: false, error: 'failed' };

  if (payload.position !== null && isMovableChannel(restored)) {
    await restored
      .setPosition(payload.position, { reason: rollbackReason(actorId) })
      .catch(() => undefined);
  }

  return { ok: true };
}

async function restoreDeletedRole(
  guild: Guild,
  payload: RoleRollbackPayload,
  actorId: string,
): Promise<RollbackResult> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, error: 'noPermission' };
  }

  const restored = await guild.roles
    .create({
      name: payload.name,
      color: payload.color,
      hoist: payload.hoist,
      mentionable: payload.mentionable,
      permissions: BigInt(payload.permissions),
      unicodeEmoji: payload.unicodeEmoji ?? undefined,
      reason: rollbackReason(actorId),
    })
    .catch(() => null);
  if (!restored) return { ok: false, error: 'failed' };

  await restored
    .setPosition(payload.position, { reason: rollbackReason(actorId) })
    .catch(() => undefined);
  return { ok: true };
}

export async function restoreRollback(
  guild: Guild,
  kind: RollbackKind,
  payload: string,
  actorId: string,
): Promise<RollbackResult> {
  if (kind === 'messageDelete') {
    const parsed = parsePayload<MessageRollbackPayload>(payload);
    return parsed ? restoreDeletedMessage(guild, parsed, actorId) : { ok: false, error: 'failed' };
  }

  if (kind === 'channelDelete') {
    const parsed = parsePayload<ChannelRollbackPayload>(payload);
    return parsed ? restoreDeletedChannel(guild, parsed, actorId) : { ok: false, error: 'failed' };
  }

  if (kind === 'roleDelete') {
    const parsed = parsePayload<RoleRollbackPayload>(payload);
    return parsed ? restoreDeletedRole(guild, parsed, actorId) : { ok: false, error: 'failed' };
  }

  return { ok: false, error: 'unsupported' };
}

export function asRollbackKind(kind: string): RollbackKind | null {
  if (kind === 'messageDelete' || kind === 'channelDelete' || kind === 'roleDelete') return kind;
  return null;
}
