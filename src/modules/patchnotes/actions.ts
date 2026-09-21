import type { ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { PATCH_SOURCES, getPatchSource, patchCategoryLabel } from './catalog.js';
import { getPatchnotesConfig } from './config.js';
import { publishLatestPatchNotes, type PublishLatestPatchNotesResult } from './service.js';

/** Libellé lisible d'un échec de publication, pour le retour dashboard. */
function reasonLabel(reason: PublishLatestPatchNotesResult['reason']): string {
  const known = [
    'missingSource',
    'missingChannel',
    'channelUnavailable',
    'missingPermissions',
    'noNotes',
  ];
  // Une raison inconnue retombe sur « envoi impossible » plutôt que d'afficher
  // la clé : la liste des raisons peut grandir côté service sans passer ici.
  const key = reason && known.includes(reason) ? reason : 'unknown';
  return t(`modules.patchnotes.actions.publishLatest.raisons.${key}`);
}

/**
 * Publie tout de suite la dernière note d'un abonnement — l'équivalent du bouton
 * « Publier maintenant » de l'ancien panneau Discord.
 */
const publishLatest = (): ModuleAction => ({
  id: 'publishLatest',
  label: t('modules.patchnotes.actions.publishLatest.label'),
  help: t('modules.patchnotes.actions.publishLatest.help'),
  style: 'primary',
  fields: [
    {
      key: 'sourceId',
      label: t('modules.patchnotes.actions.publishLatest.champs.sourceId.label'),
      type: 'select',
      help: t('modules.patchnotes.actions.publishLatest.champs.sourceId.help'),
      options: PATCH_SOURCES.map((source) => ({
        value: source.id,
        label: `${patchCategoryLabel(source.category)} · ${source.name}`,
      })),
    },
  ],
  async run({ ctx, guildId, input }) {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId : '';
    const msg = (key: string, vars?: Record<string, string | number>) =>
      t(`modules.patchnotes.actions.publishLatest.msg.${key}`, vars);
    if (!getPatchSource(sourceId)) return { ok: false, message: msg('pickSource') };

    const config = await getPatchnotesConfig(ctx, guildId);
    const sub = config.subscriptions.find((s) => s.sourceId === sourceId);
    if (!sub) {
      return { ok: false, message: msg('noSubscription') };
    }

    const result = await publishLatestPatchNotes(ctx, sub, 1);
    if (result.sent === 0) {
      return { ok: false, message: msg('nothing', { raison: reasonLabel(result.reason) }) };
    }
    return { ok: true, message: msg('done', { n: result.sent }) };
  },
});

export const patchnotesActions = (): ModuleAction[] => [publishLatest()];
