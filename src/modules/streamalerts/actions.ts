import type { ConfigField, ModuleAction } from '../../core/module.js';
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
const test: ModuleAction = {
  id: 'test',
  label: 'Tester un abonnement',
  help: 'Poste le dernier élément de la source dans son salon, sans attendre le prochain contrôle.',
  style: 'secondary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { subscriptions } = await getStreamalertsConfig(ctx, guildId);
    return [
      {
        key: 'id',
        label: 'Abonnement',
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
    if (!sub) return { ok: false, message: 'Choisis un abonnement enregistré.' };

    const outcome = await testSubscription(ctx, sub);
    switch (outcome) {
      case 'ok':
        return { ok: true, message: 'Annonce de test envoyée.' };
      case 'nochannel':
        return { ok: false, message: 'Cet abonnement n’a pas de salon.' };
      case 'unreachable':
        return { ok: false, message: 'Source injoignable (URL ou blocage réseau).' };
      default:
        return { ok: false, message: 'Aucun élément trouvé sur la source.' };
    }
  },
};

export const streamalertsActions: ModuleAction[] = [test];
