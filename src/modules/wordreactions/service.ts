import type { Message } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { type MatchType, type WordReaction } from './config.js';

type GuildMessage = Message<true>;

/** Nombre maximal de réactions ajoutées à un même message (anti-spam). */
const MAX_REACTIONS_PER_MESSAGE = 5;

/** Découpe un texte en mots (ponctuation retirée), pour la correspondance « mot entier ». */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:()"'«»…\n\r]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Indique si `content` correspond au déclencheur selon le type de comparaison. */
export function matches(content: string, trigger: string, match: MatchType): boolean {
  const haystack = content.trim().toLowerCase();
  const needle = trigger.trim().toLowerCase();
  if (!needle) return false;
  switch (match) {
    case 'exact':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    case 'word':
      return words(content).includes(needle);
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

/** Emojis à ajouter à un message : toutes les règles applicables, dédupliqués. */
export function collectEmojis(message: GuildMessage, rules: WordReaction[]): string[] {
  const emojis: string[] = [];
  for (const rule of rules) {
    if (rule.channelId && rule.channelId !== message.channelId) continue;
    if (!matches(message.content, rule.trigger, rule.match)) continue;
    for (const emoji of rule.emojis) {
      if (!emojis.includes(emoji)) emojis.push(emoji);
    }
  }
  return emojis.slice(0, MAX_REACTIONS_PER_MESSAGE);
}

/**
 * Ajoute les réactions correspondantes à un message. Les emojis invalides ou
 * inaccessibles (custom d'un autre serveur) sont ignorés silencieusement.
 */
export async function reactToMessage(
  ctx: BotContext,
  message: GuildMessage,
  rules: WordReaction[],
): Promise<void> {
  const emojis = collectEmojis(message, rules);
  for (const emoji of emojis) {
    try {
      await message.react(emoji);
    } catch (error) {
      ctx.logger.debug(
        { err: error, guildId: message.guildId, emoji },
        'Réaction de mot ignorée (emoji invalide ?)',
      );
    }
  }
}
