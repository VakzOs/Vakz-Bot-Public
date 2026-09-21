import type { ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { resetOwnClaims } from './service.js';

/**
 * Efface les portes déjà ouvertes par l'admin lui-même — de quoi retester le
 * calendrier de bout en bout sans toucher aux autres membres.
 */
const resetMyClaims = (): ModuleAction => ({
  id: 'resetMyClaims',
  label: t('modules.advent.actions.resetMyClaims.label'),
  help: t('modules.advent.actions.resetMyClaims.help'),
  style: 'danger',
  confirm: t('modules.advent.actions.resetMyClaims.confirm'),
  async run({ ctx, guildId, actorId }) {
    if (!actorId) return { ok: false, message: t('modules.advent.actions.msg.noActor') };
    const count = await resetOwnClaims(ctx, guildId, actorId);
    return { ok: true, message: t('modules.advent.actions.resetMyClaims.msg.done', { n: count }) };
  },
});

export const adventActions = (): ModuleAction[] => [resetMyClaims()];
