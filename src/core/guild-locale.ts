import { db } from './db.js';
import {
  DEFAULT_LOCALE,
  isKnownLocale,
  matchDiscordLocale,
  normalizeLocale,
  runWithLocale,
  useLocale,
} from './i18n.js';
import { createLogger } from './logger.js';

const log = createLogger('i18n');

/**
 * La langue choisie par chaque serveur, en mémoire.
 *
 * Elle est demandée à CHAQUE interaction — avant même de savoir si la commande
 * existe — et une lecture SQLite par clic de bouton serait payer en boucle une
 * valeur qui ne change qu'à travers le dashboard. Le cache est invalidé à
 * l'écriture, seul endroit d'où elle change.
 */
const cache = new Map<string, string>();

/**
 * La langue d'un serveur.
 *
 * Trois cas, dans cet ordre : la langue choisie dans le dashboard ; à défaut
 * celle que Discord prête au serveur (`discordLocale`), qui vaut mieux que du
 * français pour un serveur anglophone qui n'a jamais rien réglé ; à défaut la
 * langue par défaut.
 *
 * Une langue stockée puis retirée du dépôt (dossier supprimé, langue
 * communautaire abandonnée) retombe sur FR plutôt que de renvoyer des clés
 * brutes aux membres : `isKnownLocale` est la garde qui le garantit.
 */
export async function localeForGuild(
  guildId: string | null | undefined,
  /** Ce que Discord dit de ce serveur (`guild.preferredLocale`), si on l'a. */
  discordLocale?: string,
): Promise<string> {
  if (!guildId) return matchDiscordLocale(discordLocale) ?? DEFAULT_LOCALE;
  const cached = cache.get(guildId);
  if (cached) return cached;

  let stored: string | null | undefined;
  try {
    const row = await db.guild.findUnique({ where: { id: guildId }, select: { locale: true } });
    stored = row ? row.locale : null;
  } catch (error) {
    // Une base injoignable ne doit pas empêcher le bot de répondre : il
    // répondra dans la langue par défaut.
    log.error({ err: error, guildId }, 'Lecture de la langue du serveur impossible');
  }

  // Aucune ligne : ce serveur n'a jamais rien configuré. On ne met PAS le
  // résultat en cache — il ne vient pas de la base, et il changerait sous nos
  // pieds dès la première écriture.
  if (stored === null || stored === undefined) {
    return matchDiscordLocale(discordLocale) ?? DEFAULT_LOCALE;
  }

  const locale = isKnownLocale(stored) ? normalizeLocale(stored) : DEFAULT_LOCALE;
  cache.set(guildId, locale);
  return locale;
}

/**
 * Change la langue d'un serveur. Renvoie `false` si la langue est inconnue —
 * l'appelant (API web) le traduit en refus, plutôt que d'écrire un code qui
 * ferait parler le bot en clés de traduction.
 */
export async function setGuildLocale(guildId: string, locale: string): Promise<boolean> {
  const wanted = normalizeLocale(locale);
  if (!isKnownLocale(wanted)) return false;
  await db.guild.upsert({
    where: { id: guildId },
    update: { locale: wanted },
    create: { id: guildId, locale: wanted },
  });
  cache.set(guildId, wanted);
  return true;
}

/** Oublie la langue mémorisée d'un serveur (purge des données, tests). */
export function forgetGuildLocale(guildId: string): void {
  cache.delete(guildId);
}

/**
 * Exécute `fn` dans la langue du serveur.
 *
 * À utiliser partout où du texte part vers un serveur en dehors d'une
 * interaction — une tâche planifiée qui poste un anniversaire, un évènement
 * Discord. Sans cela, `t()` retombe sur la langue par défaut : le serveur a
 * choisi l'anglais dans le dashboard et reçoit ses rappels en français.
 */
export async function withGuildLocale<T>(
  guildId: string | null | undefined,
  fn: () => Promise<T>,
  discordLocale?: string,
): Promise<T> {
  const locale = await localeForGuild(guildId, discordLocale);
  return runWithLocale(locale, fn);
}

/**
 * Pose la langue d'un serveur pour la suite du traitement en cours.
 *
 * C'est la forme à utiliser dans une tâche planifiée qui parcourt les serveurs :
 * une ligne en tête d'itération, et tout ce que l'itération produit — embed de
 * classement, annonce, rappel — sort dans la langue de CE serveur.
 */
export async function useGuildLocale(guildId: string | null | undefined): Promise<void> {
  useLocale(await localeForGuild(guildId));
}
