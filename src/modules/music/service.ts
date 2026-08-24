import {
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type { Player, Track, UnresolvedTrack } from 'lavalink-client';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, brandedEmbed, withEmoji } from '../../lib/embeds.js';
import { getManager } from './manager.js';
import { getMusicConfig, type MusicConfig } from './config.js';

/** Données du demandeur passées à Lavalink et réaffichées dans les embeds. */
export interface Requester {
  id: string;
  username: string;
}

function requesterOf(track: Track | UnresolvedTrack): Requester | null {
  const raw = track.requester as Partial<Requester> | undefined;
  return raw?.id ? { id: raw.id, username: raw.username ?? '?' } : null;
}

/** Formate une durée de piste (ms) en `m:ss` ou `h:mm:ss`. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return hours > 0
    ? `${hours}:${mm}:${String(seconds).padStart(2, '0')}`
    : `${mm}:${String(seconds).padStart(2, '0')}`;
}

/** Parse une position `1:30`, `90` (secondes) ou `1m30s` en millisecondes. */
export function parsePosition(input: string): number | null {
  const value = input.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const clock = /^(\d+):([0-5]?\d)$/.exec(value);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  const units = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (units && (units[1] || units[2])) {
    return (Number(units[1] ?? 0) * 60 + Number(units[2] ?? 0)) * 1000;
  }
  return null;
}

function progressBar(position: number, duration: number, size = 18): string {
  if (!duration) return '';
  const ratio = Math.min(1, Math.max(0, position / duration));
  const filled = Math.round(ratio * (size - 1));
  let bar = '';
  for (let index = 0; index < size; index += 1) bar += index === filled ? '🔘' : '▬';
  return bar;
}

function loopIcon(mode: Player['repeatMode']): string {
  if (mode === 'track') return '🔂';
  if (mode === 'queue') return '🔁';
  return '➡️';
}

/** Ligne de file : `1. [Titre](url) · m:ss — demandé par …`. */
export function trackLine(track: Track | UnresolvedTrack, index?: number): string {
  const info = track.info;
  const prefix = index !== undefined ? `**${index}.** ` : '';
  const length = info.isStream ? '🔴 LIVE' : formatTime(info.duration ?? 0);
  const requester = requesterOf(track);
  const by = requester ? ` — <@${requester.id}>` : '';
  const title = info.uri ? `[${info.title}](${info.uri})` : info.title;
  return `${prefix}${title} · \`${length}\`${by}`;
}

/** Embed « Lecture en cours » avec barre de progression. */
export function nowPlayingEmbed(player: Player, track: Track): EmbedBuilder {
  const info = track.info;
  const requester = requesterOf(track);
  const timeline = info.isStream
    ? '🔴 **LIVE**'
    : `\`${formatTime(player.position)}\` ${progressBar(player.position, info.duration)} \`${formatTime(info.duration)}\``;

  const lines = [timeline, '', `${t('modules.music.field.author')} **${info.author}**`];
  if (requester) lines.push(`${t('modules.music.field.requestedBy')} <@${requester.id}>`);

  return brandedEmbed({
    color: Colors.brand,
    title: `🎵 ${info.title}`,
    url: info.uri || undefined,
    thumbnail: info.artworkUrl ?? undefined,
    description: lines.join('\n'),
    footer: `${loopIcon(player.repeatMode)} ${t(`modules.music.loopState.${player.repeatMode}`)} · 🔊 ${player.volume}%`,
  });
}

/** Embed de la file d'attente (piste courante + prochaines). */
export function queueEmbed(player: Player): EmbedBuilder {
  const current = player.queue.current;
  const upcoming = player.queue.tracks;
  const shown = upcoming.slice(0, 10).map((track, index) => trackLine(track, index + 1));
  const rest = upcoming.length - shown.length;

  const parts: string[] = [];
  if (current) {
    parts.push(`**${t('modules.music.field.nowPlaying')}**`, trackLine(current), '');
  }
  parts.push(`**${t('modules.music.field.upNext')}**`);
  parts.push(shown.length ? shown.join('\n') : t('modules.music.queueEmpty'));
  if (rest > 0) parts.push(t('modules.music.field.andMore', { count: rest }));

  return brandedEmbed({
    color: Colors.info,
    title: withEmoji(t('modules.music.field.queueTitle'), Emojis.music),
    description: parts.join('\n'),
    footer: `${loopIcon(player.repeatMode)} ${t(`modules.music.loopState.${player.repeatMode}`)} · 🔊 ${player.volume}%`,
  });
}

async function reply(interaction: ChatInputCommandInteraction, key: string): Promise<void> {
  const content = t(key);
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Le membre peut-il contrôler la lecture (rôle DJ, « Gérer le serveur », ou seul avec le bot) ? */
function canControl(member: GuildMember, player: Player, config: MusicConfig): boolean {
  if (!config.djRoleId) return true;
  if (member.roles.cache.has(config.djRoleId)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const channel = member.guild.channels.cache.get(player.voiceChannelId ?? '');
  if (channel?.isVoiceBased()) {
    const humans = channel.members.filter((m) => !m.user.bot).size;
    if (humans <= 1) return true;
  }
  return false;
}

/**
 * Vérifie qu'une commande de contrôle est légitime : Lavalink prêt, lecteur
 * existant, membre dans le bon salon et autorisé. Répond à l'utilisateur et
 * renvoie `null` en cas d'échec.
 */
export async function resolveControl(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<{ player: Player; config: MusicConfig } | null> {
  if (!interaction.inCachedGuild()) return null;

  const manager = getManager();
  if (!manager) {
    await reply(interaction, 'modules.music.notConfigured');
    return null;
  }
  if (!manager.useable) {
    await reply(interaction, 'modules.music.nodeDown');
    return null;
  }
  const voiceId = interaction.member.voice.channelId;
  if (!voiceId) {
    await reply(interaction, 'modules.music.notInVoice');
    return null;
  }
  const player = manager.getPlayer(interaction.guildId);
  if (!player || !player.queue.current) {
    await reply(interaction, 'modules.music.nothingPlaying');
    return null;
  }
  const config = await getMusicConfig(ctx, interaction.guildId);
  if (config.requireSameChannel && player.voiceChannelId && player.voiceChannelId !== voiceId) {
    await reply(interaction, 'modules.music.notSameChannel');
    return null;
  }
  if (!canControl(interaction.member, player, config)) {
    await reply(interaction, 'modules.music.noPermission');
    return null;
  }
  return { player, config };
}
