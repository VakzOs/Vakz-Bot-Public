import { EmbedBuilder, type APIEmbedField, type User } from 'discord.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Vakz-Bot · Kit d'embeds
 *
 * Source unique du « look » du bot, façon DraftBot :
 *  - palette native Discord (lisible sur thème sombre comme clair) ;
 *  - marqueur emoji automatique sur les embeds sémantiques (✅ ❌ ⚠️ ℹ️),
 *    sans doublon si le titre/description commence déjà par un emoji ;
 *  - identité du bot (nom + avatar) pour l'en-tête/pied de page brandé ;
 *  - helpers de mise en page : champs stats, listes, barres de progression,
 *    pagination, séparateur.
 *
 * Toutes les fabriques historiques (`infoEmbed`, `successEmbed`, …) gardent
 * leur signature : les ~150 appels existants adoptent le nouveau rendu sans
 * modification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Palette commune — couleurs natives Discord pour un rendu « maison ». */
export const Colors = {
  /** Blurple — couleur de marque du bot. */
  brand: 0x5865f2,
  /** Vert Discord — confirmations, succès. */
  success: 0x57f287,
  /** Jaune Discord — avertissements, états partiels. */
  warning: 0xfee75c,
  /** Rouge Discord — erreurs, sanctions. */
  error: 0xed4245,
  /** Bleu clair — informations neutres. */
  info: 0x00a8fc,
  /** Gris — éléments désactivés, chargement, secondaire. */
  neutral: 0x99aab5,
  /** Fuchsia Discord — catégorie « fun », mise en avant festive. */
  accent: 0xeb459e,
} as const;

/** Emojis de marque réutilisables (titres, champs, boutons, descriptions). */
export const Emojis = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  loading: '⏳',
  tip: '💡',
  sparkles: '✨',
  paw: '🐾',
  gear: '⚙️',
  shield: '🛡️',
  hammer: '🔨',
  lock: '🔒',
  unlock: '🔓',
  ticket: '🎫',
  bell: '🔔',
  pin: '📌',
  calendar: '📅',
  chart: '📊',
  crown: '👑',
  trophy: '🏆',
  medal: '🏅',
  star: '⭐',
  fire: '🔥',
  gift: '🎁',
  party: '🎉',
  coin: '🪙',
  gem: '💎',
  game: '🎮',
  music: '🎵',
  heart: '❤️',
  wave: '👋',
  question: '❓',
  link: '🔗',
  plus: '➕',
  minus: '➖',
  trash: '🗑️',
  pencil: '✏️',
  eye: '👁️',
  zap: '⚡',
  clock: '🕐',
  search: '🔍',
  scroll: '📜',
  picture: '🖼️',
  bust: '👤',
  house: '🏠',
  tag: '🏷️',
  compass: '🧭',
  map: '🗺️',
  backpack: '🎒',
  cake: '🎂',
  flag: '🚩',
  arrowUp: '⬆️',
  arrowDown: '⬇️',
} as const;

/** Séparateur visuel discret pour aérer une description. */
export const DIVIDER = '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌';

/**
 * Identité visuelle du bot (nom + avatar), renseignée une fois le client prêt via
 * `configureEmbedTheme`. Sert de source unique pour l'auteur/pied de page brandé,
 * sans avoir à passer le client à chaque fabrique d'embed.
 */
interface EmbedTheme {
  name: string;
  iconURL?: string;
}
let theme: EmbedTheme = { name: 'Vakz-Bot' };

/** À appeler au démarrage (ClientReady) : renseigne le nom et l'avatar du bot. */
export function configureEmbedTheme(patch: Partial<EmbedTheme>): void {
  theme = { ...theme, ...patch };
}

/** Nom d'affichage du bot (thème courant). */
export function embedThemeName(): string {
  return theme.name;
}

/** Pied de page brandé « <Bot> · <contexte> » avec l'avatar du bot. */
export function brandedFooter(context?: string): { text: string; iconURL?: string } {
  return {
    text: context ? `${theme.name} · ${context}` : theme.name,
    iconURL: theme.iconURL,
  };
}

/**
 * Caractères qui, en tête de titre/description, jouent déjà le rôle de marqueur
 * visuel : on ne rajoute alors pas d'emoji sémantique (évite « ✅ ✅ … »).
 */
const EMOJI_LED =
  /^(?:\p{Extended_Pictographic}|[©®‼⁉™ℹ↔-↩⌚⌛⌨⏏⏩-⏳⏸-⏺Ⓜ▪-▫▶◀◻-◾☀-➿⤴-⤵⬅-⬇⬛-⬜⭐⭕〰〽㊗㊙])/u;

/** Préfixe `text` du marqueur, sauf s'il commence déjà par un emoji. */
function withMarker(text: string, marker: string): string {
  return EMOJI_LED.test(text) ? text : `${marker} ${text}`;
}

/**
 * Préfixe un texte d'un emoji, sauf s'il commence déjà par un emoji.
 * Idéal pour les titres issus des locales ou de la config utilisateur.
 */
export function withEmoji(text: string, emoji: string): string {
  return withMarker(text, emoji);
}

export interface EmbedOptions {
  title?: string;
  description?: string;
  /** Rend le titre cliquable. */
  url?: string;
  fields?: APIEmbedField[];
  thumbnail?: string;
  image?: string;
  /** En-tête auteur : `true` = identité du bot (thème) ; sinon objet explicite. */
  author?: true | { name: string; iconURL?: string; url?: string };
  /** Pied de page : chaîne = texte libre ; `true` = marque du bot (thème). */
  footer?: string | true | { text: string; iconURL?: string };
  /** Ajoute l'horodatage courant. */
  timestamp?: boolean;
  /** Remplace le marqueur emoji sémantique par défaut (ex. 🎉 pour un gain). */
  emoji?: string;
}

/**
 * Applique les options à un embed. Tout est optionnel : un appel `{ title,
 * description }` conserve le rendu historique (rétro-compatibilité des 150+
 * appels existants) ; les nouveaux champs n'agissent que si fournis.
 */
function applyOptions(embed: EmbedBuilder, o: EmbedOptions): EmbedBuilder {
  if (o.title) embed.setTitle(o.title);
  if (o.url) embed.setURL(o.url);
  if (o.description) embed.setDescription(o.description);
  if (o.fields?.length) embed.addFields(o.fields);
  if (o.thumbnail) embed.setThumbnail(o.thumbnail);
  if (o.image) embed.setImage(o.image);
  if (o.author === true) embed.setAuthor({ name: theme.name, iconURL: theme.iconURL });
  else if (o.author) embed.setAuthor(o.author);
  if (o.footer === true) embed.setFooter(brandedFooter());
  else if (typeof o.footer === 'string') embed.setFooter({ text: o.footer });
  else if (o.footer) embed.setFooter(o.footer);
  if (o.timestamp) embed.setTimestamp();
  return embed;
}

function baseEmbed(color: number, options: EmbedOptions): EmbedBuilder {
  return applyOptions(new EmbedBuilder().setColor(color), options);
}

/**
 * Embed sémantique : couleur + marqueur emoji automatique.
 *  - avec `title` : le titre est préfixé (« ✅ Salon configuré ») ;
 *  - sinon, si `markDescription`, la description est préfixée (look confirmation
 *    façon DraftBot : « ✅ Le salon a été enregistré. »).
 * Le marqueur est ignoré si le texte commence déjà par un emoji, et remplaçable
 * via `options.emoji`.
 */
function semanticEmbed(
  color: number,
  marker: string,
  options: EmbedOptions,
  markDescription: boolean,
): EmbedBuilder {
  const o = { ...options };
  const mark = o.emoji ?? marker;
  delete o.emoji;
  if (o.title) o.title = withMarker(o.title, mark);
  else if (markDescription && o.description) o.description = withMarker(o.description, mark);
  return baseEmbed(color, o);
}

export function infoEmbed(options: EmbedOptions): EmbedBuilder {
  // Pas de préfixe sur les descriptions info : souvent longues (panneaux, pages).
  return semanticEmbed(Colors.info, Emojis.info, options, false);
}

export function successEmbed(options: EmbedOptions): EmbedBuilder {
  return semanticEmbed(Colors.success, Emojis.success, options, true);
}

export function warningEmbed(options: EmbedOptions): EmbedBuilder {
  return semanticEmbed(Colors.warning, Emojis.warning, options, true);
}

export function errorEmbed(options: EmbedOptions): EmbedBuilder {
  return semanticEmbed(Colors.error, Emojis.error, options, true);
}

/** Embed de chargement neutre (« ⏳ … »), à éditer une fois l'opération finie. */
export function loadingEmbed(options: EmbedOptions = {}): EmbedBuilder {
  return semanticEmbed(Colors.neutral, Emojis.loading, options, true);
}

/**
 * Embed « marque » : couleur brand + en-tête auteur (nom + avatar du bot) +
 * horodatage, depuis le thème. Look à privilégier pour les réponses marquantes
 * (profils, classements, annonces). Pas de pied de page par défaut ; `footer`
 * reste une option explicite pour un texte contextuel ponctuel. Surchargeable.
 */
export function brandedEmbed(options: EmbedOptions & { color?: number } = {}): EmbedBuilder {
  const { color = Colors.brand, ...rest } = options;
  return baseEmbed(color, { author: true, timestamp: true, ...rest });
}

/** En-tête auteur à partir d'un membre/utilisateur (profils, sanctions, logs). */
export function userAuthor(user: User): { name: string; iconURL: string } {
  return { name: user.displayName ?? user.username, iconURL: user.displayAvatarURL() };
}

/** Champ d'embed raccourci. */
export function field(name: string, value: string, inline = false): APIEmbedField {
  return { name, value, inline };
}

/** Champ inline raccourci (stats côte à côte). */
export function inlineField(name: string, value: string): APIEmbedField {
  return { name, value, inline: true };
}

/** Champ invisible (espacement, alignement de colonnes). */
export function blankField(inline = false): APIEmbedField {
  return { name: '\u200b', value: '\u200b', inline };
}

/** Ligne de stats en champs inline : `statsFields([['Niveau', '12'], ['XP', '1 204']])`. */
export function statsFields(entries: ReadonlyArray<readonly [string, string]>): APIEmbedField[] {
  return entries.map(([name, value]) => inlineField(name, value));
}

/** Liste à puces propre (« • item » par ligne). */
export function listLines(items: readonly string[], bullet = '•'): string {
  return items.map((item) => `${bullet} ${item}`).join('\n');
}

/**
 * Barre de progression textuelle (« ▰▰▰▱▱▱▱▱▱▱ ») pour XP, objectifs, timers…
 * `ratio` est borné entre 0 et 1.
 */
export function progressBar(ratio: number, length = 10): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filledCells = Math.round(clamped * length);
  return `${'▰'.repeat(filledCells)}${'▱'.repeat(Math.max(0, length - filledCells))}`;
}

/** Barre + pourcentage (« ▰▰▰▱▱▱▱▱▱▱ 30 % »). */
export function progressLine(ratio: number, length = 10): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  return `${progressBar(clamped, length)} ${Math.round(clamped * 100)} %`;
}

/** Découpe un tableau en pages de `perPage` éléments (classements, listes). */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const size = Math.max(1, perPage);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length > 0 ? pages : [[]];
}

/** Étiquette de rang pour classements : 🥇 🥈 🥉 puis « **4.** », « **5.** »… */
export function rankLabel(index: number): string {
  const medals = ['🥇', '🥈', '🥉'] as const;
  return medals[index] ?? `**${index + 1}.**`;
}
