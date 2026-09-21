import { EmbedBuilder, type Message } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import type { StarboardConfig } from './config.js';

const CUSTOM_EMOJI = /^<a?:(\w+):(\d+)>$/;
const STARBOARD_COLOR = 0xffac33;

/** Vérifie qu'une réaction correspond à l'emoji configuré (unicode ou custom). */
export function emojiMatches(
  stored: string,
  reactionName: string | null,
  reactionId: string | null,
): boolean {
  const custom = CUSTOM_EMOJI.exec(stored.trim());
  if (custom) return reactionId === custom[2];
  return reactionId === null && reactionName === stored.trim();
}

function firstImageUrl(message: Message): string | null {
  const image = message.attachments.find(
    (a) =>
      a.contentType?.startsWith('image/') === true || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? ''),
  );
  return image?.url ?? null;
}

/** Embed republié dans le starboard : auteur, contenu, image et lien d'origine. */
export function buildStarboardEmbed(message: Message): EmbedBuilder {
  const jump = `[${t('modules.starboard.jump')}](${message.url})`;
  const content = message.content?.trim();
  const embed = new EmbedBuilder()
    .setColor(STARBOARD_COLOR)
    .setDescription(content ? `${content}\n\n${jump}` : jump)
    .setTimestamp(message.createdAt);

  if (message.author) {
    embed.setAuthor({
      name: message.author.username,
      iconURL: message.author.displayAvatarURL(),
    });
  }
  const image = firstImageUrl(message);
  if (image) embed.setImage(image);
  return embed;
}

/** Texte d'accompagnement du message starboard : « ⭐ 5 · #salon ». */
function starboardContent(config: StarboardConfig, count: number, channelId: string): string {
  return t('modules.starboard.header', {
    emoji: config.emoji,
    count,
    channel: `<#${channelId}>`,
  });
}

/**
 * Synchronise l'entrée starboard d'un message selon son nombre d'étoiles :
 * crée/met à jour la republication au-dessus du seuil, la retire en dessous.
 */
export async function syncStarboard(
  ctx: BotContext,
  message: Message,
  count: number,
  config: StarboardConfig,
): Promise<void> {
  const guildId = message.guild?.id;
  if (!guildId || !config.channelId) return;

  const entry = await ctx.db.starboardEntry.findUnique({
    where: { guildId_sourceMessageId: { guildId, sourceMessageId: message.id } },
  });

  // En dessous du seuil : on retire l'éventuelle republication.
  if (count < config.threshold) {
    if (!entry) return;
    if (entry.starboardMessageId) {
      const channel = await message.guild?.channels.fetch(config.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const existing = await channel.messages.fetch(entry.starboardMessageId).catch(() => null);
        await existing?.delete().catch(() => undefined);
      }
    }
    await ctx.db.starboardEntry.delete({ where: { id: entry.id } }).catch(() => undefined);
    return;
  }

  const channel = await message.guild?.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const payload = {
    content: starboardContent(config, count, message.channelId),
    embeds: [buildStarboardEmbed(message)],
  };

  // Republication déjà existante : on met simplement le compteur à jour.
  if (entry?.starboardMessageId) {
    const existing = await channel.messages.fetch(entry.starboardMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      await ctx.db.starboardEntry.update({ where: { id: entry.id }, data: { starCount: count } });
      return;
    }
  }

  const sent = await channel.send(payload).catch(() => null);
  if (!sent) return;
  await ctx.db.starboardEntry.upsert({
    where: { guildId_sourceMessageId: { guildId, sourceMessageId: message.id } },
    update: { starboardMessageId: sent.id, starCount: count },
    create: {
      guildId,
      sourceChannelId: message.channelId,
      sourceMessageId: message.id,
      starboardMessageId: sent.id,
      authorId: message.author?.id ?? 'unknown',
      starCount: count,
    },
  });
}
