import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { brandedEmbed } from '../../lib/embeds.js';
import { t } from '../../core/i18n.js';
import type { StreamerConfig } from './config.js';

/** Rangée contenant le bouton Activer/Désactiver. */
export function buildButtonRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('sm|toggle')
      .setLabel(t('modules.streamer.button'))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🎥'),
  );
}

/** Construit l'embed du panneau « Mode streameur » (rôle + liste des membres). */
export function buildStreamerEmbed(config: StreamerConfig, guild: Guild): EmbedBuilder {
  const role = config.roleId ? guild.roles.cache.get(config.roleId) : null;
  const members = role ? [...role.members.values()] : [];
  const roleText = config.roleId ? `<@&${config.roleId}>` : '—';
  const list = members.length
    ? members
        .map((member) => `• ${member}`)
        .join('\n')
        .slice(0, 1024)
    : t('modules.streamer.embed.noMembers');

  // Note : les mentions de rôle ne s'affichent que dans la VALEUR d'un champ
  // (pas dans son nom) — on met donc le rôle + le compte dans la valeur.
  return brandedEmbed({ title: config.title, description: config.description }).addFields({
    name: '\u200b',
    value: `${t('modules.streamer.embed.roleField', { role: roleText, count: members.length })}\n${list}`,
  });
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'nochannel' | 'norole' | 'send' };

/** Publie (ou met à jour) le panneau « Mode streameur » dans le salon configuré. */
export async function publishStreamer(guild: Guild, config: StreamerConfig): Promise<PublishResult> {
  if (!config.channelId) return { ok: false, error: 'nochannel' };
  if (!config.roleId) return { ok: false, error: 'norole' };

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, error: 'nochannel' };

  const payload = {
    embeds: [buildStreamerEmbed(config, guild)],
    components: [buildButtonRow()],
  };

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
