import { ActivityType, type Client } from 'discord.js';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import { db } from './db.js';

/**
 * Statut affiché sous le nom du bot (« message de profil »).
 *
 * La liste par défaut vit ici, mais elle n'est qu'un point de départ : le
 * propriétaire la remplace depuis le dashboard, et c'est alors la version
 * enregistrée en base qui fait foi. Le tirage se fait au démarrage — un
 * redémarrage (manuel, `/maj`, ou la cadence automatique) change donc de
 * statut.
 */

/** Clé `AppSetting` où vit la liste personnalisée (JSON : tableau de chaînes). */
export const PRESENCE_LINES_KEY = 'presence.lines';

/** Limite Discord d'un statut personnalisé. */
export const MAX_PRESENCE_LENGTH = 128;

/** Assez pour varier, assez peu pour rester éditable d'un coup d'œil. */
export const MAX_PRESENCE_LINES = 60;

// Statuts « chat » : des BRUITS, des BÊTISES et des RÉACTIONS (pas des actions
// vagues façon « toilette express »). Chaque ligne doit se lire comme une petite
// scène de chat. Texte affiché tel quel en statut personnalisé (pas d'i18n).
export const DEFAULT_PRESENCE_LINES = [
  // Bruits
  'meow meow',
  'mrrp ?',
  'pspspsps',
  'ronronne à fond',
  'miaou strident',
  'feulement menaçant',
  'miaule à la porte',
  'réclame en hurlant',
  // Bêtises
  'fait tomber un verre',
  'pousse un stylo du bord',
  'renverse la gamelle d’eau',
  'griffe le canapé',
  'déroule le papier toilette',
  'recrache une pelote de poils',
  'shoote un bouchon sous le frigo',
  'marche sur le clavier',
  'escalade les rideaux',
  'fait tomber les clés',
  'attaque tes chevilles',
  'vole la place au chaud',
  // Réactions
  'fixe le vide intensément',
  'sursaute pour rien',
  'boude dans un carton',
  'juge silencieusement',
  't’ignore royalement',
  'guette les pigeons',
  'poursuit le laser',
  'chasse la mouche',
] as const;

/**
 * Nettoie une liste saisie depuis le dashboard : on coupe, on jette le vide,
 * on déduplique, on borne. Une ligne trop longue est **tronquée** plutôt que
 * refusée — Discord la couperait de toute façon.
 */
export function sanitizePresenceLines(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const line = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESENCE_LENGTH);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= MAX_PRESENCE_LINES) break;
  }
  return lines;
}

/**
 * Les statuts réellement utilisés : ceux du dashboard s'ils existent, sinon la
 * liste par défaut. Une liste vidée revient donc aux statuts d'origine plutôt
 * que de laisser le bot sans statut du tout.
 */
export async function getPresenceLines(client: PrismaClient = db): Promise<string[]> {
  const row = await client.appSetting.findUnique({ where: { key: PRESENCE_LINES_KEY } });
  if (!row) return [...DEFAULT_PRESENCE_LINES];
  try {
    const lines = sanitizePresenceLines(JSON.parse(row.value));
    return lines.length > 0 ? lines : [...DEFAULT_PRESENCE_LINES];
  } catch {
    return [...DEFAULT_PRESENCE_LINES];
  }
}

/** Enregistre la liste personnalisée et renvoie ce qui a été retenu. */
export async function setPresenceLines(
  lines: unknown,
  client: PrismaClient = db,
): Promise<string[]> {
  const clean = sanitizePresenceLines(lines);
  const value = JSON.stringify(clean);
  await client.appSetting.upsert({
    where: { key: PRESENCE_LINES_KEY },
    update: { value },
    create: { key: PRESENCE_LINES_KEY, value },
  });
  return clean.length > 0 ? clean : [...DEFAULT_PRESENCE_LINES];
}

/** Tire un statut au hasard dans une liste (jamais vide en retour). */
export function pickPresence(lines: readonly string[]): string {
  const pool = lines.length > 0 ? lines : DEFAULT_PRESENCE_LINES;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? pool[0] ?? 'meow meow';
}

/** Statut actuellement affiché par le bot, tel que Discord le connaît. */
export function currentPresence(client: Client): string | null {
  const activity = client.user?.presence.activities.find(
    (entry) => entry.type === ActivityType.Custom,
  );
  return activity?.state ?? activity?.name ?? null;
}

/**
 * Tire et applique un statut. Appelé au démarrage, et de nouveau quand la liste
 * change depuis le dashboard : on voit alors tout de suite l'effet de sa
 * modification, sans attendre le prochain redémarrage.
 */
export async function applyBootPresence(client: Client<true>, logger: Logger): Promise<string> {
  const lines = await getPresenceLines().catch((error: unknown) => {
    logger.error({ err: error }, 'Lecture des statuts échouée, liste par défaut utilisée');
    return [...DEFAULT_PRESENCE_LINES];
  });
  const state = pickPresence(lines);
  client.user.setPresence({
    activities: [{ name: state, state, type: ActivityType.Custom }],
    status: 'online',
  });
  logger.info({ presence: state }, 'Presence du bot appliquee');
  return state;
}
