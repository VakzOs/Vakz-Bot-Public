import type { ConfigField, ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getStreamalertsConfig } from './config.js';
import { testSubscription } from './service.js';

/** Étiquette lisible d'un abonnement dans le sélecteur du dashboard. */
function subscriptionLabel(platform: string, displayName: string, identifier: string): string {
  return `${platform} · ${displayName || identifier}`;
}

/**
 * Poste immédiatement le dernier élément d'un abonnement, filtre par mot-clé
 * ignoré : le moyen de vérifier qu'une source et un salon sont bien réglés.
 */
const test = (): ModuleAction => ({
  id: 'test',
  label: t('modules.streamalerts.actions.test.label'),
  help: t('modules.streamalerts.actions.test.help'),
  style: 'secondary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { subscriptions } = await getStreamalertsConfig(ctx, guildId);
    return [
      {
        key: 'id',
        label: t('modules.streamalerts.actions.test.champs.id'),
        type: 'select',
        options: subscriptions.map((sub) => ({
          value: sub.id,
          label: subscriptionLabel(sub.platform, sub.displayName, sub.identifier),
        })),
      },
    ];
  },
  async run({ ctx, guildId, input }) {
    const id = typeof input.id === 'string' ? input.id : '';
    const { subscriptions } = await getStreamalertsConfig(ctx, guildId);
    const sub = subscriptions.find((s) => s.id === id);
    const msg = (key: string) => t(`modules.streamalerts.actions.test.msg.${key}`);
    if (!sub) return { ok: false, message: msg('pickSubscription') };

    const outcome = await testSubscription(ctx, sub);
    switch (outcome) {
      case 'ok':
        return { ok: true, message: msg('done') };
      case 'nochannel':
        return { ok: false, message: msg('noChannel') };
      case 'unreachable':
        return { ok: false, message: msg('unreachable') };
      default:
        return { ok: false, message: msg('noItem') };
    }
  },
});

export const streamalertsActions = (): ModuleAction[] => [test()];
