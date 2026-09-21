import {
  AuditLogEvent,
  Events,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Invite,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type Role,
} from 'discord.js';
import { defineEvent, type BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import {
  addExecutor,
  changeBlock,
  clip,
  createRollback,
  executorValue,
  findAuditExecutor,
  isLogCategoryEnabled,
  memberLogCategory,
  rollbackRow,
  sendLog,
  targetEmbed,
} from './service.js';
import {
  closeJoin,
  forgetGuildInvites,
  inviterStats,
  recentAuditExecutor,
  rememberInvite,
  trackJoin,
  warmInviteCache,
  type JoinOrigin,
} from './invites.js';
import { isInviteTrackingEnabled } from './config.js';
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
  if (embedCount > 0) return t('modules.logs.fields.embedCount', { count: embedCount });
  const attachmentCount = message.attachments.size || payload?.attachments.length || 0;
  if (attachmentCount > 0) return t('modules.logs.fields.fileCount', { count: attachmentCount });
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

/**
 * Le texte d'un message, quand on le connaît vraiment.
 *
 * Un message absent du cache arrive « partiel » : son `content` vaut `null`,
 * qui n'est le texte de personne. Le prendre pour l'ancien contenu fait voir
 * une modification partout où Discord touche au message sans que son auteur y
 * soit pour quelque chose — accrocher l'aperçu d'un lien, épingler — et rend
 * des lignes qui ne disent rien (« indisponible → indisponible »). D'où la
 * distinction entre « vide » et « inconnu ». Le typage de discord.js promet un
 * message entier à `messageUpdate` : à l'exécution, il n'en est rien.
 */
function knownContent(message: Message | PartialMessage): string | null {
  return typeof message.content === 'string' ? message.content : null;
}

/**
 * En deçà de quoi une édition est celle dont l'évènement nous parle.
 *
 * L'évènement nous parvient dans la seconde ; la marge couvre une reprise de
 * passerelle, qui rejoue ce qui s'est dit pendant la coupure, sans aller
 * jusqu'à prendre un vieil horodatage pour une édition du jour.
 */
const RECENT_EDIT_MS = 2 * 60 * 1000;

/**
 * Le message vient-il d'être édité par son auteur ?
 *
 * Seule une édition pose `edited_timestamp` : accrocher l'aperçu d'un lien,
 * épingler ou retirer un aperçu n'y touchent pas. C'est donc ce qui distingue
 * un geste de l'auteur d'un geste de Discord quand l'ancien texte nous échappe.
 */
function justEdited(message: Message | PartialMessage): boolean {
  const edited = message.editedTimestamp;
  return edited !== null && Date.now() - edited < RECENT_EDIT_MS;
}

/** Complète un message partiel, faute de quoi son texte reste « inconnu ». */
async function fullMessage(message: Message | PartialMessage): Promise<Message | PartialMessage> {
  if (typeof message.content === 'string') return message;
  return (await message.fetch().catch(() => null)) ?? message;
}

export const onMessageUpdate = defineEvent({
  name: Events.MessageUpdate,
  async execute(ctx, oldMessage, newMessage) {
    const guild = newMessage.guild;
    if (!guild || !(await isLogCategoryEnabled(ctx, guild.id, 'messages'))) return;

    // La copie gardée pour la restauration se lit AVANT d'être remplacée :
    // c'est elle qui sait ce que disait un message que le cache a oublié.
    const snapshot = await loadMessageSnapshot(ctx, guild.id, newMessage.id);
    const before = knownContent(oldMessage) ?? snapshot?.content ?? null;

    // Aller chercher le message entier ne se justifie que si l'on a de quoi le
    // comparer, ou si l'auteur vient d'y toucher.
    const current =
      before === null && !justEdited(newMessage) ? newMessage : await fullMessage(newMessage);
    const after = knownContent(current);

    // Un message resté partiel ne porte que ce que Discord vient de changer :
    // en faire une copie effacerait le texte gardé pour la restauration.
    if (after !== null) await saveMessageSnapshot(ctx, current);

    // Rien à montrer : Discord ne nous a pas dit le nouveau texte.
    if (after === null) return;
    if (before === null) {
      // L'avant nous échappe (message oublié du cache et trop vieux pour la
      // copie). Une édition fraîche vaut quand même sa ligne — l'avant y sera
      // dit inconnu ; le reste, ce sont les gestes de Discord, et ils se taisent.
      if (!justEdited(current)) return;
    } else if (before.trim() === after.trim()) {
      // Le texte n'a pas bougé : un embed réédité, un aperçu accroché.
      return;
    }

    const embed = targetEmbed(
      t('modules.logs.events.messageUpdate.title'),
      Colors.info,
      `<#${current.channelId}>`,
      current.id,
    ).addFields(
      { name: t('modules.logs.fields.author'), value: messageAuthor(current), inline: true },
      {
        name: t('modules.logs.fields.change'),
        value: changeBlock(
          before === null
            ? t('modules.logs.fields.unknown')
            : clip(before, t('modules.logs.fields.empty')),
          clip(after, t('modules.logs.fields.empty')),
        ),
      },
    );
    await sendLog(ctx, guild, 'messages', embed);
  },
});

/** Décrit l'invitation empruntée : son code, ou ce qui en tient lieu. */
function inviteValue(origin: JoinOrigin): string {
  if (origin.source !== 'invite' || !origin.code) {
    return t(`modules.logs.sources.${origin.source}`);
  }
  const uses = origin.uses;
  if (uses === null) return `\`${origin.code}\``;
  return `\`${origin.code}\` · ${t('modules.logs.invites.uses', { count: uses })}`;
}

export const onGuildMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(ctx, member) {
    const origin = await trackJoin(ctx, member);
    const embed = targetEmbed(
      t('modules.logs.events.memberAdd.title'),
      Colors.success,
      memberLabel(member),
      member.id,
    );

    if (origin) {
      embed.addFields(
        {
          name: t('modules.logs.fields.inviter'),
          value: executorValue(origin.inviterId),
          inline: true,
        },
        { name: t('modules.logs.fields.invite'), value: inviteValue(origin), inline: true },
      );
      // Le compte de l'inviteur se lit au moment où il grossit : c'est là qu'il
      // raconte quelque chose (« sa 12e, dont 9 restées »).
      if (origin.inviterId) {
        const stats = await inviterStats(ctx, member.guild.id, origin.inviterId);
        embed.addFields({
          name: t('modules.logs.fields.inviterTotal'),
          value: t('modules.logs.invites.tally', { total: stats.total, present: stats.present }),
          inline: true,
        });
      }
    }

    const category = await memberLogCategory(ctx, member.guild.id, origin !== null);
    await sendLog(ctx, member.guild, category, embed);
  },
});

export const onGuildMemberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async execute(ctx, member) {
    // Referme l'arrivée même si le départ ne se publie pas : c'est ce qui
    // distingue ensuite « a fait entrer 12 membres » de « 12 sont restés ».
    const join = (await isInviteTrackingEnabled(ctx, member.guild.id))
      ? await closeJoin(ctx, member.guild.id, member.id)
      : null;

    const embed = targetEmbed(
      t('modules.logs.events.memberRemove.title'),
      Colors.warning,
      memberLabel(member),
      member.id,
    );

    if (join) {
      embed.addFields(
        {
          name: t('modules.logs.fields.inviter'),
          value: executorValue(join.inviterId),
          inline: true,
        },
        {
          name: t('modules.logs.fields.joinedAt'),
          value: `<t:${Math.floor(join.joinedAt.getTime() / 1000)}:R>`,
          inline: true,
        },
      );
    }

    const category = await memberLogCategory(ctx, member.guild.id, join !== null);
    await sendLog(ctx, member.guild, category, embed);
  },
});

/** Le serveur d'une invitation, sous sa forme complète (celle du cache). */
function inviteGuild(ctx: BotContext, invite: Invite): Guild | null {
  const id = invite.guild?.id;
  return (id ? ctx.client.guilds.cache.get(id) : undefined) ?? null;
}

export const onInviteCreate = defineEvent({
  name: Events.InviteCreate,
  async execute(ctx, invite) {
    const guild = inviteGuild(ctx, invite);
    if (!guild) return;

    // Avant toute publication : une invitation créée puis empruntée dans la
    // foulée n'aurait sinon aucun compteur « d'avant » à qui se comparer.
    rememberInvite(invite);

    const embed = targetEmbed(
      t('modules.logs.events.inviteCreate.title'),
      Colors.success,
      `\`${invite.code}\``,
      invite.code,
    ).addFields(
      {
        name: t('modules.logs.fields.inviter'),
        value: executorValue(invite.inviterId),
        inline: true,
      },
      {
        name: t('modules.logs.fields.channel'),
        value: invite.channelId ? `<#${invite.channelId}>` : t('modules.logs.fields.unknown'),
        inline: true,
      },
      {
        name: t('modules.logs.fields.maxUses'),
        value: invite.maxUses ? String(invite.maxUses) : t('modules.logs.invites.unlimited'),
        inline: true,
      },
      {
        name: t('modules.logs.fields.expires'),
        value: invite.expiresTimestamp
          ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>`
          : t('modules.logs.invites.never'),
        inline: true,
      },
    );
    await sendLog(ctx, guild, 'invites', embed);
  },
});

export const onInviteDelete = defineEvent({
  name: Events.InviteDelete,
  async execute(ctx, invite) {
    const guild = inviteGuild(ctx, invite);
    // L'instantané n'est PAS touché ici : une invitation arrivée à son plafond
    // est supprimée par Discord au moment même où elle sert, et c'est sa
    // disparition qui permet à `resolveJoinOrigin` d'attribuer l'arrivée. Le
    // prochain relevé la retirera de lui-même.
    if (!guild || !(await isLogCategoryEnabled(ctx, guild.id, 'invites'))) return;

    const executorId = await recentAuditExecutor(guild, AuditLogEvent.InviteDelete);
    const embed = addExecutor(
      targetEmbed(
        t('modules.logs.events.inviteDelete.title'),
        Colors.warning,
        `\`${invite.code}\``,
        invite.code,
      ),
      executorId,
    ).addFields({
      name: t('modules.logs.fields.channel'),
      value: invite.channelId ? `<#${invite.channelId}>` : t('modules.logs.fields.unknown'),
      inline: true,
    });
    await sendLog(ctx, guild, 'invites', embed);
  },
});

export const onGuildCreate = defineEvent({
  name: Events.GuildCreate,
  async execute(ctx, guild) {
    // Sans instantané de départ, la première arrivée du serveur serait
    // « origine inconnue ».
    if (!(await isInviteTrackingEnabled(ctx, guild.id))) return;
    await warmInviteCache(ctx, guild);
  },
});

export const onGuildDelete = defineEvent({
  name: Events.GuildDelete,
  execute(_ctx, guild) {
    forgetGuildInvites(guild.id);
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
