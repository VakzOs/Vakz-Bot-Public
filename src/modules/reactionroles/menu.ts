import { EmbedBuilder, type Guild, type GuildEmoji, type Message } from 'discord.js';
import { Colors } from '../../lib/embeds.js';
import { resolveEmojiInput } from '../../lib/emoji.js';
import type { ReactionRolesConfig, RoleEntry } from './config.js';

// Réexport pour le panneau (saisie d'emoji lors de l'ajout d'un rôle).
export { resolveEmojiInput };

const CUSTOM = /^<(a)?:(\w+):(\d+)>$/;

/** Ligne d'un rôle façon DraftBot : « {emoji} | {libellé} ». */
function roleLine(role: RoleEntry): string {
  return role.emoji ? `${role.emoji} | ${role.label}` : role.label;
}

/** Embed du menu : titre, intro, puis un rôle par ligne. */
export function buildMenuEmbed(config: ReactionRolesConfig): EmbedBuilder {
  const lines = config.roles.map(roleLine).join('\n\n');
  const description = lines ? `${config.description}\n\n${lines}` : config.description;
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(config.title)
    .setDescription(description);
}

/**
 * Emoji utilisable avec `message.react` : `GuildEmoji` pour un emoji du
 * serveur, `nom:id` en repli, ou l'emoji unicode. `null` si non réactionnable.
 */
export function reactionEmoji(guild: Guild, stored: string): GuildEmoji | string | null {
  const match = CUSTOM.exec(stored);
  if (match) {
    const found = guild.emojis.cache.get(match[3] ?? '');
    return found ?? `${match[2]}:${match[3]}`;
  }
  if (/\p{Extended_Pictographic}/u.test(stored)) return stored;
  return null;
}

/** Rôle associé à une réaction (par id d'emoji personnalisé ou nom unicode). */
export function roleForReaction(
  config: ReactionRolesConfig,
  emoji: { id: string | null; name: string | null },
): string | null {
  for (const role of config.roles) {
    const match = CUSTOM.exec(role.emoji);
    if (match) {
      if (emoji.id && emoji.id === match[3]) return role.roleId;
    } else if (emoji.name && emoji.name === role.emoji) {
      return role.roleId;
    }
  }
  return null;
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'nochannel' | 'noroles' | 'noemoji' | 'permissions' | 'send' };

interface MenuLogger {
  warn(obj: unknown, msg?: string): void;
}

function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: number }).code
    : undefined;
}

/**
 * Publie (ou met à jour) le message du menu puis (re)pose les réactions
 * correspondant à chaque rôle disposant d'un emoji valide.
 */
export async function publishMenu(
  guild: Guild,
  config: ReactionRolesConfig,
  logger?: MenuLogger,
): Promise<PublishResult> {
  if (!config.channelId) return { ok: false, error: 'nochannel' };
  if (config.roles.length === 0) return { ok: false, error: 'noroles' };
  const reactable = config.roles.filter((role) => reactionEmoji(guild, role.emoji) !== null);
  if (reactable.length === 0) return { ok: false, error: 'noemoji' };

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, error: 'nochannel' };

  const embed = buildMenuEmbed(config);
  let message: Message | null = null;
  if (config.messageId) {
    const existing = await channel.messages.fetch(config.messageId).catch(() => null);
    if (existing) {
      message = await existing.edit({ embeds: [embed], components: [] }).catch(() => null);
    }
  }
  if (!message) {
    try {
      message = await channel.send({ embeds: [embed] });
    } catch (error) {
      const code = errorCode(error);
      logger?.warn({ err: error, code }, 'Publication du menu de rôles échouée');
      return { ok: false, error: code === 50013 || code === 50001 ? 'permissions' : 'send' };
    }
  }

  // (Re)synchronise les réactions : on repart propre puis on repose l'ensemble.
  await message.reactions.removeAll().catch(() => undefined);
  for (const role of reactable) {
    const emoji = reactionEmoji(guild, role.emoji);
    if (emoji) {
      await message.react(emoji).catch((err: unknown) => {
        logger?.warn({ err, emoji: role.emoji }, 'Réaction impossible à poser');
      });
    }
  }
  return { ok: true, messageId: message.id };
}
