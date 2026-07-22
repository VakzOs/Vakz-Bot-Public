import { EmbedBuilder, type APIEmbedField } from 'discord.js';

/** Palette commune pour garder des embeds lisibles et cohérents dans tout le bot. */
export const Colors = {
  brand: 0x5865f2,
  success: 0x22c55e,
  warning: 0xf59e0b,
  error: 0xef4444,
  info: 0x38bdf8,
  neutral: 0x64748b,
  /** Violet — catégorie « fun » ; évite le littéral dupliqué dans config-panel. */
  accent: 0xa78bfa,
} as const;

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
}

/**
 * Applique les options à un embed. Tout est optionnel : un appel `{ title,
 * description }` produit exactement le même rendu qu'avant (rétro-compatibilité
 * des 150+ appels existants) ; les nouveaux champs n'agissent que si fournis.
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
  if (o.footer === true) embed.setFooter({ text: theme.name, iconURL: theme.iconURL });
  else if (typeof o.footer === 'string') embed.setFooter({ text: o.footer });
  else if (o.footer) embed.setFooter(o.footer);
  if (o.timestamp) embed.setTimestamp();
  return embed;
}

function baseEmbed(color: number, options: EmbedOptions): EmbedBuilder {
  return applyOptions(new EmbedBuilder().setColor(color), options);
}

export function infoEmbed(options: EmbedOptions): EmbedBuilder {
  return baseEmbed(Colors.info, options);
}

export function successEmbed(options: EmbedOptions): EmbedBuilder {
  return baseEmbed(Colors.success, options);
}

export function warningEmbed(options: EmbedOptions): EmbedBuilder {
  return baseEmbed(Colors.warning, options);
}

export function errorEmbed(options: EmbedOptions): EmbedBuilder {
  return baseEmbed(Colors.error, options);
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
