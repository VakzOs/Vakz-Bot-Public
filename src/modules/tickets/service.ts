import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type MessageActionRowComponentBuilder,
  type OverwriteResolvable,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import type { Ticket } from '@prisma/client';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Emojis, brandedEmbed, withEmoji } from '../../lib/embeds.js';
import { parseEmoji } from '../../lib/emoji.js';
import { MODULE_NAME, type TicketsConfig, type TicketType } from './config.js';

const MAX_ARCHIVE_MESSAGES = 500;
const CHUNK_LIMIT = 1900;

/** Embed du panneau d'ouverture publié dans le salon. */
export function buildPanelEmbed(config: TicketsConfig): EmbedBuilder {
  return brandedEmbed({ title: config.title, description: config.description });
}

/** Rangées de boutons du panneau : un bouton par type de ticket (5 par rangée). */
export function buildPanelComponents(
  config: TicketsConfig,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let i = 0; i < config.types.length; i += 5) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (const type of config.types.slice(i, i + 5)) {
      const button = new ButtonBuilder()
        .setCustomId(`${MODULE_NAME}|open|${type.id}`)
        .setLabel(type.label)
        .setStyle(ButtonStyle.Primary);
      const emoji = parseEmoji(type.emoji);
      if (emoji) button.setEmoji(emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }
  return rows;
}

function buildCloseRow(ticketId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|close|${ticketId}`)
      .setLabel(t('modules.tickets.close.button'))
      .setStyle(ButtonStyle.Danger),
  );
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'nochannel' | 'notypes' | 'send' };

/** Publie (ou met à jour) le panneau (embed + un bouton par type). */
export async function publishPanel(guild: Guild, config: TicketsConfig): Promise<PublishResult> {
  if (!config.panelChannelId) return { ok: false, error: 'nochannel' };
  if (config.types.length === 0) return { ok: false, error: 'notypes' };
  const channel = await guild.channels.fetch(config.panelChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, error: 'nochannel' };

  const payload = { embeds: [buildPanelEmbed(config)], components: buildPanelComponents(config) };
  if (config.messageId) {
    const existing = await channel.messages.fetch(config.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return { ok: true, messageId: existing.id };
    }
  }
  try {
    const sent = await channel.send(payload);
    return { ok: true, messageId: sent.id };
  } catch {
    return { ok: false, error: 'send' };
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15);
}

/** Numéro séquentiel du prochain ticket de ce type (basé sur l'historique). */
async function nextSequence(ctx: BotContext, guildId: string, typeId: string): Promise<number> {
  return (await ctx.db.ticket.count({ where: { guildId, typeId } })) + 1;
}

/**
 * Construit le nom du salon/fil à partir du format configuré. Variables :
 * `{type}` (préfixe ou libellé), `{number}` (n° sur 4 chiffres), `{count}`
 * (n° brut), `{user}` (pseudo), `{id}` (identifiant du membre).
 */
function ticketChannelName(
  format: string,
  type: TicketType,
  member: GuildMember,
  sequence: number,
): string {
  const typeSlug = slug(type.prefix.trim() || type.label) || 'ticket';
  const number = String(sequence).padStart(4, '0');
  const replaced = (format || '{type}-{number}')
    .replaceAll('{type}', typeSlug)
    .replaceAll('{number}', number)
    .replaceAll('{count}', String(sequence))
    .replaceAll('{user}', slug(member.user.username) || member.id)
    .replaceAll('{id}', member.id);
  const name = replaced
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return name || `ticket-${number}`;
}

export async function countOpenTickets(
  ctx: BotContext,
  guildId: string,
  openerId: string,
): Promise<number> {
  return ctx.db.ticket.count({ where: { guildId, openerId, status: 'open' } });
}

/**
 * Ferme les tickets « fantômes » d'un membre : ceux marqués ouverts dont le
 * salon n'existe plus (supprimé hors du bouton, ou pendant que le bot était
 * hors-ligne). Auto-réparation avant tout calcul de limite.
 */
async function pruneDeadTickets(ctx: BotContext, guild: Guild, openerId: string): Promise<void> {
  const open = await ctx.db.ticket.findMany({
    where: { guildId: guild.id, openerId, status: 'open' },
  });
  for (const ticket of open) {
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) {
      await ctx.db.ticket.update({
        where: { id: ticket.id },
        data: { status: 'closed', closedAt: new Date() },
      });
    }
  }
}

export type OpenResult =
  | { ok: true; channelId: string }
  | { ok: false; error: 'max' | 'noperm' | 'create' };

/** Crée un salon de ticket privé (catégorie) visible par l'auteur + les rôles du type. */
async function createTicketChannel(
  ctx: BotContext,
  guild: Guild,
  me: GuildMember,
  member: GuildMember,
  config: TicketsConfig,
  type: TicketType,
  name: string,
): Promise<GuildTextBasedChannel | null> {
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
  for (const roleId of type.roleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }
  return guild.channels
    .create({
      name,
      type: ChannelType.GuildText,
      parent: config.categoryId ?? undefined,
      permissionOverwrites: overwrites,
    })
    .catch((error: unknown) => {
      ctx.logger.warn({ err: error, guildId: guild.id }, 'Création de salon de ticket échouée');
      return null;
    });
}

/** Crée un fil privé de ticket dans le salon du panneau. */
async function createTicketThread(
  ctx: BotContext,
  guild: Guild,
  config: TicketsConfig,
  name: string,
): Promise<GuildTextBasedChannel | null> {
  if (!config.panelChannelId) return null;
  const parent = await guild.channels.fetch(config.panelChannelId).catch(() => null);
  if (!parent || parent.type !== ChannelType.GuildText) return null;
  return parent.threads
    .create({
      name,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    })
    .catch((error: unknown) => {
      ctx.logger.warn({ err: error, guildId: guild.id }, 'Création de fil de ticket échouée');
      return null;
    });
}

/** Ouvre un ticket (salon privé ou fil privé selon la config). */
export async function openTicket(
  ctx: BotContext,
  guild: Guild,
  member: GuildMember,
  config: TicketsConfig,
  type: TicketType,
): Promise<OpenResult> {
  await pruneDeadTickets(ctx, guild, member.id);
  if ((await countOpenTickets(ctx, guild.id, member.id)) >= config.maxOpen) {
    return { ok: false, error: 'max' };
  }
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return { ok: false, error: 'noperm' };
  const requiredPerm =
    config.mode === 'thread'
      ? PermissionFlagsBits.CreatePrivateThreads
      : PermissionFlagsBits.ManageChannels;
  if (!me.permissions.has(requiredPerm)) return { ok: false, error: 'noperm' };

  const sequence = await nextSequence(ctx, guild.id, type.id);
  const name = ticketChannelName(config.nameFormat, type, member, sequence);

  const channel =
    config.mode === 'thread'
      ? await createTicketThread(ctx, guild, config, name)
      : await createTicketChannel(ctx, guild, me, member, config, type, name);
  if (!channel) return { ok: false, error: 'create' };

  const ticket = await ctx.db.ticket.create({
    data: { guildId: guild.id, channelId: channel.id, openerId: member.id, typeId: type.id },
  });

  const embed = brandedEmbed({
    title: withEmoji(t('modules.tickets.welcomeTitle'), Emojis.ticket),
    description: t('modules.tickets.welcome', { user: `<@${member.id}>`, type: type.label }),
  });

  // Mentionner l'auteur l'ajoute automatiquement au fil privé ; les rôles staff
  // sont notifiés (ils accèdent aux fils privés via la permission « Gérer les fils »).
  const roleMentions = type.roleIds.map((r) => `<@&${r}>`).join(' ');
  await channel
    .send({
      content: roleMentions ? `<@${member.id}> ${roleMentions}` : `<@${member.id}>`,
      embeds: [embed],
      components: [buildCloseRow(ticket.id)],
      allowedMentions: { users: [member.id], roles: type.roleIds },
    })
    .catch(() => undefined);

  return { ok: true, channelId: channel.id };
}

/** Peut fermer : l'auteur, un admin, ou un membre d'un rôle du type du ticket. */
export function canCloseTicket(
  member: GuildMember,
  ticket: Ticket,
  config: TicketsConfig,
): boolean {
  if (ticket.openerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const type = config.types.find((candidate) => candidate.id === ticket.typeId);
  return !!type && type.roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function formatMessageLine(message: Message): string {
  const time = `<t:${Math.floor(message.createdTimestamp / 1000)}:t>`;
  const author = message.author?.username ?? 'inconnu';
  let body = message.content || (message.embeds.length ? '[embed]' : '');
  const attachments = [...message.attachments.values()].map((a) => a.url);
  if (attachments.length) body += `${body ? '\n' : ''}${attachments.join('\n')}`;
  return `**${author}** ${time}: ${body || '—'}`.slice(0, CHUNK_LIMIT);
}

function buildTranscriptChunks(messages: Message[]): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const message of messages) {
    const line = formatMessageLine(message);
    if (current.length + line.length + 1 > CHUNK_LIMIT) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function fetchAllMessages(channel: GuildTextBasedChannel): Promise<Message[]> {
  const out: Message[] = [];
  let before: string | undefined;
  while (out.length < MAX_ARCHIVE_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    out.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return out.reverse();
}

/** Archive la conversation d'un ticket dans un fil du salon d'archives. */
async function archiveTicket(
  ctx: BotContext,
  guild: Guild,
  ticketChannel: GuildTextBasedChannel,
  ticket: Ticket,
  config: TicketsConfig,
  closedBy: string,
): Promise<void> {
  if (!config.archiveChannelId) return;
  const archive = await guild.channels.fetch(config.archiveChannelId).catch(() => null);
  if (!archive || archive.type !== ChannelType.GuildText) return;

  const messages = await fetchAllMessages(ticketChannel);
  const type = config.types.find((candidate) => candidate.id === ticket.typeId);
  // Le fil d'archive reprend le nom réel du salon du ticket (ex. « sup-0001 »).
  const threadName = ticketChannel.name.slice(0, 100);

  const thread = await archive.threads.create({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    type: ChannelType.PublicThread,
  });

  const header = brandedEmbed({
    title: withEmoji(t('modules.tickets.archive.title'), Emojis.ticket),
    description: t('modules.tickets.archive.header', {
      type: type?.label ?? '—',
      opener: `<@${ticket.openerId}>`,
      closedBy: `<@${closedBy}>`,
      count: messages.length,
    }),
  });
  await thread.send({ embeds: [header], allowedMentions: { parse: [] } });

  for (const chunk of buildTranscriptChunks(messages)) {
    await thread.send({ content: chunk, allowedMentions: { parse: [] } });
  }
}

/** Ferme un ticket : archive éventuellement la conversation, puis supprime le salon. */
export async function closeTicket(
  ctx: BotContext,
  guild: Guild,
  ticket: Ticket,
  config: TicketsConfig,
  closedBy: string,
): Promise<void> {
  await ctx.db.ticket.update({
    where: { id: ticket.id },
    data: { status: 'closed', closedBy, closedAt: new Date() },
  });
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (config.archiveChannelId && channel?.isTextBased()) {
    try {
      await archiveTicket(ctx, guild, channel, ticket, config, closedBy);
    } catch (error) {
      ctx.logger.warn({ err: error, guildId: guild.id }, 'Archivage du ticket échoué');
    }
  }
  await channel?.delete().catch(() => undefined);
}
