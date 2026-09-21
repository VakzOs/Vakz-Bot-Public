import type { ModuleAction } from '../../core/module.js';
import { resetOwnClaims } from './service.js';

/**
 * Efface les portes déjà ouvertes par l'admin lui-même — de quoi retester le
 * calendrier de bout en bout sans toucher aux autres membres.
 */
const resetMyClaims: ModuleAction = {
  id: 'resetMyClaims',
  label: 'Réinitialiser mes ouvertures',
  help: 'Supprime uniquement TES ouvertures de portes, pour retester le calendrier.',
  style: 'danger',
  confirm: 'Effacer tes propres ouvertures de portes sur ce serveur ?',
  async run({ ctx, guildId, actorId }) {
    if (!actorId) return { ok: false, message: 'Acteur inconnu.' };
    const count = await resetOwnClaims(ctx, guildId, actorId);
    return { ok: true, message: `${count} ouverture(s) effacée(s).` };
  },
};

export const adventActions: ModuleAction[] = [resetMyClaims];
