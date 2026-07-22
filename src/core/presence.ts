import { ActivityType, type Client } from 'discord.js';
import type { Logger } from 'pino';

// Statuts « chat » : des BRUITS, des BÊTISES et des RÉACTIONS (pas des actions
// vagues façon « toilette express »). Chaque ligne doit se lire comme une petite
// scène de chat. Texte affiché tel quel en statut personnalisé (pas d'i18n).
const CAT_STATUS_LINES = [
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

export function pickBootPresence(): string {
  const index = Math.floor(Math.random() * CAT_STATUS_LINES.length);
  return CAT_STATUS_LINES[index] ?? CAT_STATUS_LINES[0];
}

export function applyBootPresence(client: Client<true>, logger: Logger): void {
  const state = pickBootPresence();
  client.user.setPresence({
    activities: [{ name: state, state, type: ActivityType.Custom }],
    status: 'online',
  });
  logger.info({ presence: state }, 'Presence du bot appliquee');
}
