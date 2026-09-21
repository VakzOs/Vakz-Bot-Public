import type { ComponentEmojiResolvable, Guild } from 'discord.js';
import { get as emojiGet, has as emojiHas } from 'node-emoji';

const CUSTOM_EMOJI = /^<a?:\w+:\d+>$/;
const CUSTOM_EMOJI_PARTS = /^<(a)?:(\w+):(\d+)>$/;

/**
 * Normalise une saisie d'emoji avant stockage :
 * - `<:nom:id>` / `<a:nom:id>` : conservé tel quel ;
 * - `:nom:` correspondant à un emoji **du serveur** : converti en `<:nom:id>` ;
 * - `:nom:` correspondant à un **raccourci unicode standard** (ex. `:red_car:`) :
 *   converti en son emoji unicode (🚗) ;
 * - sinon (emoji unicode déjà saisi ou inconnu) : conservé tel quel.
 */
export function resolveEmojiInput(input: string, guild: Guild): string {
  const value = input.trim();
  if (!value) return '';
  if (CUSTOM_EMOJI.test(value)) return value;

  const nameMatch = /^:?([a-zA-Z0-9_+-]+):?$/.exec(value);
  if (nameMatch) {
    const name = nameMatch[1] ?? '';
    // 1) emoji personnalisé du serveur
    const found = guild.emojis.cache.find((emoji) => emoji.name === name);
    if (found) return found.toString();
    // 2) raccourci d'emoji unicode standard (:red_car: → 🚗)
    if (emojiHas(name)) {
      const unicode = emojiGet(name);
      if (unicode) return unicode;
    }
  }
  return value; // déjà un emoji unicode, ou inconnu
}

/**
 * Interprète une saisie d'emoji pour un bouton/menu. N'accepte qu'un emoji
 * personnalisé `<:nom:id>` ou un vrai emoji unicode : toute autre valeur
 * (mot, `:nom:` non résolu…) renvoie `undefined`, pour éviter un composant
 * refusé par Discord (Invalid Form Body).
 */
export function parseEmoji(input: string): ComponentEmojiResolvable | undefined {
  const value = input.trim();
  if (!value) return undefined;
  const match = CUSTOM_EMOJI_PARTS.exec(value);
  if (match) return { id: match[3], name: match[2], animated: Boolean(match[1]) };
  if (/\p{Extended_Pictographic}/u.test(value)) return value;
  return undefined;
}
