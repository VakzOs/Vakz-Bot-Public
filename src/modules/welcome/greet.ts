import { AttachmentBuilder, type GuildMember, type PartialGuildMember } from 'discord.js';
import { Colors, Emojis, errorEmbed, successEmbed } from '../../lib/embeds.js';
import { t } from '../../core/i18n.js';
import type { GreetConfig, GreetKind } from './config.js';
import { renderGreetCard } from './card.js';

type AnyMember = GuildMember | PartialGuildMember;

const CARD_FILENAME = 'welcome.png';

/**
 * Génère la carte-image d'accueil/au revoir pour un membre. Renvoie `null` si le
 * rendu échoue (police/canvas indisponible) — l'envoi retombe alors sur le texte.
 */
async function buildGreetCard(
  member: AnyMember,
  greet: GreetConfig,
  kind: GreetKind,
): Promise<AttachmentBuilder | null> {
  const displayName = member.user?.globalName ?? member.user?.username ?? 'Membre';
  try {
    const buffer = await renderGreetCard({
      title:
        kind === 'welcome'
          ? t('modules.welcome.card.welcomeTitle')
          : t('modules.welcome.card.leaveTitle'),
      name: displayName,
      subtitle:
        kind === 'welcome'
          ? t('modules.welcome.card.memberCount', { count: member.guild.memberCount })
          : '',
      avatarUrl: member.user?.displayAvatarURL({ extension: 'png', size: 256 }) ?? null,
      backgroundUrl: greet.cardBackground,
      accentColor: kind === 'welcome' ? Colors.success : Colors.error,
    });
    return new AttachmentBuilder(buffer, { name: CARD_FILENAME });
  } catch {
    return null;
  }
}

/**
 * Remplace les variables d'un message d'accueil/au revoir :
 * `{mention}`, `{username}`, `{server}`, `{count}`.
 */
export function formatGreeting(template: string, member: AnyMember): string {
  const username = member.user?.username ?? 'membre';
  return template
    .replaceAll('{mention}', `<@${member.id}>`)
    .replaceAll('{username}', username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));
}

/**
 * Envoie le message d'accueil/au revoir dans le salon configuré.
 * Ne fait rien si le sous-module est désactivé ou si aucun salon n'est défini.
 */
export async function sendGreeting(
  member: AnyMember,
  greet: GreetConfig,
  kind: GreetKind,
): Promise<void> {
  if (!greet.enabled || !greet.channelId) return;

  const channel = await member.guild.channels.fetch(greet.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const content = formatGreeting(greet.message, member);
  const card = greet.card ? await buildGreetCard(member, greet, kind) : null;

  if (greet.embed) {
    // Vert + 👋 pour une arrivée, rouge + 👋 pour un départ (look DraftBot).
    const embed = (kind === 'welcome' ? successEmbed : errorEmbed)({
      description: content,
      timestamp: true,
      emoji: Emojis.wave,
    });

    const footer = formatGreeting(greet.footer, member).trim();
    if (footer) embed.setFooter({ text: footer });

    // Avec une carte : elle occupe la grande image de l'embed et porte déjà le
    // nom du membre → on n'ajoute ni auteur (serveur) ni titre (pseudo) pour
    // éviter la redite. Sans carte : en-tête serveur + pseudo + avatar miniature.
    if (card) {
      embed.setImage(`attachment://${CARD_FILENAME}`);
    } else {
      const avatar = member.user?.displayAvatarURL({ size: 256 }) ?? null;
      const displayName = member.user?.globalName ?? member.user?.username ?? 'Membre';
      embed
        .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL() ?? undefined })
        .setTitle(displayName)
        .setThumbnail(avatar);
    }

    await channel.send({ embeds: [embed], ...(card ? { files: [card] } : {}) });
  } else {
    await channel.send({ content, ...(card ? { files: [card] } : {}) });
  }
}
