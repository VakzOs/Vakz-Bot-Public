import {
  AuditLogEvent,
  Events,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type Role,
} from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import {
  addExecutor,
  changeBlock,
  clip,
  createRollback,
  findAuditExecutor,
  isLogCategoryEnabled,
  rollbackRow,
  sendLog,
  targetEmbed,
} from './service.js';
import {
  buildChannelRollback,
  buildMessageRollback,
  buildRoleRollback,
  messageRollbackHasData,
  type MessageRollbackPayload,
} from './rollback.js';
import {
  deleteMessageSnapshot,
  loadMessageSnapshot,
  saveMessageSnapshot,
} from './message-store.js';

function channelLabel(channel: GuildBasedChannel): string {
  return `#${channel.name}`;
}

function memberLabel(member: GuildMember | PartialGuildMember): string {
  return `<@${member.id}>`;
}

function messageAuthor(message: Message | PartialMessage): string {
  return message.author ? `<@${message.author.id}>` : t('modules.logs.fields.unknown');
}

function messagePreview(
  message: Message | PartialMessage,
  payload?: MessageRollbackPayload,
): string {
  const content = message.content?.trim() || payload?.content.trim();
  if (content) return clip(content, t('modules.logs.fields.unavailable'));
  const embedCount = message.embeds.length || payload?.embeds?.length || 0;
  if (embedCount > 0) return `${embedCount} embed(s)`;
  const attachmentCount = message.attachments.size || payload?.attachments.length || 0;
  if (attachmentCount > 0) return `${attachmentCount} fichier(s)`;
  return t('modules.logs.fields.unavailable');
}

export const onMessageCreate = defineEvent({
  name: Events.MessageCreate,
  async execute(ctx, message) {
    await saveMessageSnapshot(ctx, message);
  },
});

export const onMessageDelete = defineEvent({
  name: Events.MessageDelete,
  async execute(ctx, message) {
    if (!message.guild || !(await isLogCategoryEnabled(ctx, message.guild.id, 'messages'))) return;
    let rollbackPayload = buildMessageRollback(message);
    if (!messageRollbackHasData(rollbackPayload)) {
      rollbackPayload =
        (await loadMessageSnapshot(ctx, message.guild.id, message.id)) ?? rollbackPayload;
    }
    const rollbackId = await createRollback(
      ctx,
      message.guild.id,
      'messageDelete',
      message.id,
      rollbackPayload,
    );
    await deleteMessageSnapshot(ctx, message.id);
    const embed = targetEmbed(
      t('modules.logs.events.messageDelete.title'),
      Colors.warning,
      `<#${message.channelId}>`,
      message.id,
    ).addFields(
      { name: t('modules.logs.fields.author'), value: messageAuthor(message), inline: true },
      {
        name: t('modules.logs.fields.content'),
        value: messagePreview(message, rollbackPayload),
      },
    );
    await sendLog(ctx, message.guild, 'messages', embed, [rollbackRow(rollbackId)]);
  },
});

export const onMessageBulkDelete = defineEvent({
  name: Events.MessageBulkDelete,
  async execute(ctx, messages, channel) {
    if (channel.isDMBased()) return;
    const embed = targetEmbed(
      t('modules.logs.events.messageBulkDelete.title'),
      Colors.warning,
      `<#${channel.id}>`,
      channel.id,
    ).addFields({
      name: t('modules.logs.fields.count'),
      value: String(messages.size),
      inline: true,
    });
    await sendLog(ctx, channel.guild, 'messages', embed);
  },
});

export const onMessageUpdate = defineEvent({
  name: Events.MessageUpdate,
  async execute(ctx, oldMessage, newMessage) {
    if (newMessage.guild) await saveMessageSnapshot(ctx, newMessage);
    if (!newMessage.guild || oldMessage.content === newMessage.content) return;
    const embed = targetEmbed(
      t('modules.logs.events.messageUpdate.title'),
      Colors.info,
      `<#${newMessage.channelId}>`,
      newMessage.id,
    ).addFields(
      { name: t('modules.logs.fields.author'), value: messageAuthor(newMessage), inline: true },
      {
        name: t('modules.logs.fields.change'),
        value: changeBlock(
          clip(oldMessage.content, t('modules.logs.fields.unavailable')),
          clip(newMessage.content, t('modules.logs.fields.unavailable')),
        ),
      },
    );
    await sendLog(ctx, newMessage.guild, 'messages', embed);
  },
});

export const onGuildMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(ctx, member) {
    const embed = targetEmbed(
      t('modules.logs.events.memberAdd.title'),
      Colors.success,
      memberLabel(member),
      member.id,
    );
    await sendLog(ctx, member.guild, 'members', embed);
  },
});

export const onGuildMemberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async execute(ctx, member) {
    const embed = targetEmbed(
      t('modules.logs.events.memberRemove.title'),
      Colors.warning,
      memberLabel(member),
      member.id,
    );
    await sendLog(ctx, member.guild, 'members', embed);
  },
});

export const onChannelCreate = defineEvent({
  name: Events.ChannelCreate,
  async execute(ctx, channel) {
    if (channel.isDMBased()) return;
    const executorId = await findAuditExecutor(
      channel.guild,
      AuditLogEvent.ChannelCreate,
      channel.id,
    );
    const embed = addExecutor(
      targetEmbed(
        t('modules.logs.events.channelCreate.title'),
        Colors.success,
        channelLabel(channel),
        channel.id,
      ),
      executorId,
    );
    await sendLog(ctx, channel.guild, 'channels', embed);
  },
});

export const onChannelDelete = defineEvent({
  name: Events.ChannelDelete,
  async execute(ctx, channel) {
    if (channel.isDMBased() || !(await isLogCategoryEnabled(ctx, channel.guild.id, 'channels')))
      return;
    const executorId = await findAuditExecutor(
      channel.guild,
      AuditLogEvent.ChannelDelete,
      channel.id,
    );
    const snapshot = buildChannelRollback(channel);
    const rollbackId = snapshot
      ? await createRollback(ctx, channel.guild.id, 'channelDelete', channel.id, snapshot)
      : null;
    const embed = addExecutor(
      targetEmbed(
        t('modules.logs.events.channelDelete.title'),
        Colors.error,
        channelLabel(channel),
        channel.id,
      ),
      executorId,
    );
    await sendLog(
      ctx,
      channel.guild,
      'channels',
      embed,
      rollbackId ? [rollbackRow(rollbackId)] : [],
    );
  },
});

export const onChannelUpdate = defineEvent({
  name: Events.ChannelUpdate,
  async execute(ctx, oldChannel, newChannel) {
    if (oldChannel.isDMBased() || newChannel.isDMBased()) return;
    const oldName = oldChannel.name;
    const newName = newChannel.name;
    if (oldName === newName) return;
    const executorId = await findAuditExecutor(
      newChannel.guild,
      AuditLogEvent.ChannelUpdate,
      newChannel.id,
    );
    const embed = addExecutor(
      targetEmbed(
        t('modules.logs.events.channelUpdate.title'),
        Colors.info,
        channelLabel(newChannel),
        newChannel.id,
      ),
      executorId,
    ).addFields({
      name: t('modules.logs.fields.change'),
      value: changeBlock(oldName, newName),
    });
    await sendLog(ctx, newChannel.guild, 'channels', embed);
  },
});

function roleLabel(role: Role): string {
  return `<@&${role.id}>`;
}

export const onRoleCreate = defineEvent({
  name: Events.GuildRoleCreate,
  async execute(ctx, role) {
    const executorId = await findAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    const embed = addExecutor(
      targetEmbed(
        t('modules.logs.events.roleCreate.title'),
        Colors.success,
        roleLabel(role),
        role.id,
      ),
      executorId,
    );
    await sendLog(ctx, role.guild, 'roles', embed);
  },
});

export const onRoleDelete = defineEvent({
  name: Events.GuildRoleDelete,
  async execute(ctx, role) {
    if (!(await isLogCategoryEnabled(ctx, role.guild.id, 'roles'))) return;
    const executorId = await findAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    const snapshot = buildRoleRollback(role);
    const rollbackId = snapshot
      ? await createRollback(ctx, role.guild.id, 'roleDelete', role.id, snapshot)
      : null;
    const embed = addExecutor(
      targetEmbed(t('modules.logs.events.roleDelete.title'), Colors.error, role.name, role.id),
      executorId,
    );
    await sendLog(ctx, role.guild, 'roles', embed, rollbackId ? [rollbackRow(rollbackId)] : []);
  },
});

export const onRoleUpdate = defineEvent({
  name: Events.GuildRoleUpdate,
  async execute(ctx, oldRole, newRole) {
    if (oldRole.name === newRole.name) return;
    const executorId = await findAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const embed = addExecutor(
      targetEmbed(
        t('modules.logs.events.roleUpdate.title'),
        Colors.info,
        roleLabel(newRole),
        newRole.id,
      ),
      executorId,
    ).addFields({
      name: t('modules.logs.fields.change'),
      value: changeBlock(oldRole.name, newRole.name),
    });
    await sendLog(ctx, newRole.guild, 'roles', embed);
  },
});
