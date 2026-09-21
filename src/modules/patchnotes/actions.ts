import type { ModuleAction } from '../../core/module.js';
import { PATCH_SOURCES, getPatchSource } from './catalog.js';
import { getPatchnotesConfig } from './config.js';
import { publishLatestPatchNotes, type PublishLatestPatchNotesResult } from './service.js';

/** Libellé lisible d'un échec de publication, pour le retour dashboard. */
function reasonLabel(reason: PublishLatestPatchNotesResult['reason']): string {
  switch (reason) {
    case 'missingSource':
      return 'source inconnue';
    case 'missingChannel':
      return 'aucun salon configuré';
    case 'channelUnavailable':
      return 'salon introuvable ou non textuel';
    case 'missingPermissions':
      return 'permissions manquantes dans le salon';
    case 'noNotes':
      return 'aucune note trouvée sur la source';
    default:
      return 'envoi impossible';
  }
}

/**
 * Publie tout de suite la dernière note d'un abonnement — l'équivalent du bouton
 * « Publier maintenant » de l'ancien panneau Discord.
 */
const publishLatest: ModuleAction = {
  id: 'publishLatest',
  label: 'Publier la dernière note',
  help: 'Envoie immédiatement la dernière note de patch de la source choisie dans son salon.',
  style: 'primary',
  fields: [
    {
      key: 'sourceId',
      label: 'Source',
      type: 'select',
      help: 'Doit correspondre à un abonnement déjà enregistré ci-dessus.',
      options: PATCH_SOURCES.map((source) => ({
        value: source.id,
        label: `${source.category} · ${source.name}`,
      })),
    },
  ],
  async run({ ctx, guildId, input }) {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId : '';
    if (!getPatchSource(sourceId)) return { ok: false, message: 'Choisis une source valide.' };

    const config = await getPatchnotesConfig(ctx, guildId);
    const sub = config.subscriptions.find((s) => s.sourceId === sourceId);
    if (!sub) {
      return { ok: false, message: "Cette source n'a pas encore d'abonnement enregistré." };
    }

    const result = await publishLatestPatchNotes(ctx, sub, 1);
    if (result.sent === 0) {
      return { ok: false, message: `Rien publié : ${reasonLabel(result.reason)}.` };
    }
    return { ok: true, message: `${result.sent} note publiée.` };
  },
};

export const patchnotesActions: ModuleAction[] = [publishLatest];
