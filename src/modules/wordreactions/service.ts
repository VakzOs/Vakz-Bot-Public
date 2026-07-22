import type { Guild, Message } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { type MatchType, MAX_EMOJIS, type WordReaction } from './config.js';

type GuildMessage = Message<true>;

/** Nombre maximal de réactions ajoutées à un même message (anti-spam). */
const MAX_REACTIONS_PER_MESSAGE = 5;

/** Emoji personnalisé (`<:name:id>` ou `<a:name:id>`) ou emoji unicode. */
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;
const UNICODE_EMOJI = /\p{Extended_Pictographic}/u;
/** Raccourci `:nom:` — un champ de modal ne convertit pas les emojis du serveur. */
const SHORTCODE = /^:(\w{2,32}):$/;

/**
 * Valide et normalise une saisie d'emojis (séparés par des espaces).
 * Un raccourci `:nom:` (que Discord n'auto-complète pas dans un modal) est résolu
 * contre les emojis du serveur et remplacé par sa forme `<:nom:id>`.
 */
export function parseEmojis(input: string, guild?: Guild): string[] {
  const result: string[] = [];
  for (const token of input.split(/\s+/).filter(Boolean)) {
    if (CUSTOM_EMOJI.test(token) || UNICODE_EMOJI.test(token)) {
      result.push(token);
      continue;
    }
    const shortcode = SHORTCODE.exec(token);
    const emoji = shortcode
      ? guild?.emojis.cache.find((candidate) => candidate.name === shortcode[1])
      : undefined;
    if (emoji) result.push(emoji.toString());
  }
  // Déduplication en conservant l'ordre.
  return [...new Set(result)].slice(0, MAX_EMOJIS);
}

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
