import { z } from 'zod';
import type { Item } from './service.js';

/**
 * Schéma des effets déclenchés à l'utilisation d'un objet (`/utiliser`). Isolé
 * ici (sans dépendance runtime vers le service) pour être importé aussi bien par
 * la validation (service, API web) que par le moteur d'application (effects.ts),
 * sans cycle d'import.
 *
 * Ajouter un type = une entrée dans l'union + un `case` dans `applyItemEffects`
 * + un libellé i18n + une ligne dans l'éditeur web.
 */
const roleEffect = z.object({ type: z.literal('role'), roleId: z.string().min(1) });
const coinsEffect = z.object({ type: z.literal('coins'), amount: z.number().int() });
const routeSelfEffect = z.object({
  type: z.literal('routeSelf'),
  health: z.number().int().default(0),
  energy: z.number().int().default(0),
  distance: z.number().int().default(0),
});
const routeDamageEffect = z.object({
  type: z.literal('routeDamage'),
  health: z.number().int().min(1),
});
const grantItemEffect = z.object({
  type: z.literal('grantItem'),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(999).default(1),
});
const privateChannelEffect = z.object({
  type: z.literal('privateChannel'),
  name: z.string().min(1).max(90).default('salon-{user}'),
});
const messageEffect = z.object({ type: z.literal('message'), text: z.string().min(1).max(500) });

export const itemEffectSchema = z.discriminatedUnion('type', [
  roleEffect,
  coinsEffect,
  routeSelfEffect,
  routeDamageEffect,
  grantItemEffect,
  privateChannelEffect,
  messageEffect,
]);
export type ItemEffect = z.infer<typeof itemEffectSchema>;

/** Liste d'effets d'un objet (max 15). */
export const itemEffectsSchema = z.array(itemEffectSchema).max(15);

/** Parse/valide une chaîne JSON d'effets ; renvoie `[]` si invalide. */
export function parseEffectsJson(raw: string): ItemEffect[] {
  let value: unknown = [];
  try {
    value = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  const parsed = itemEffectsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Effets configurés d'un objet. Rétrocompatibilité : si `effects` est vide mais
 * qu'un `roleReward` historique existe, on synthétise un effet « rôle ».
 */
export function parseEffects(item: Item): ItemEffect[] {
  const effects = parseEffectsJson(item.effects);
  if (effects.length === 0 && item.roleReward) {
    return [{ type: 'role', roleId: item.roleReward }];
  }
  return effects;
}

/** Au moins un effet nécessite-t-il une cible (membre visé) ? */
export function requiresTarget(effects: ItemEffect[]): boolean {
  return effects.some((e) => e.type === 'routeDamage');
}
