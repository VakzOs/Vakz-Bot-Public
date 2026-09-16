import { z } from 'zod';
import { effectSpec } from './effects-ui.js';
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
  /**
   * Chances (0-100 %) que l'objet se RETOURNE contre son utilisateur : les
   * dégâts le frappent lui au lieu de la cible. 0 = jamais de retour de bâton.
   */
  backfirePercent: z.number().int().min(0).max(100).default(10),
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

/** Vole des pieces a la cible et les credite a l'utilisateur. */
const stealCoinsEffect = z.object({
  type: z.literal('stealCoins'),
  amount: z.number().int().min(1).max(1_000_000),
  /** Chances (0-100 %) que le vol se retourne : c'est TOI qui paies la cible. */
  backfirePercent: z.number().int().min(0).max(100).default(10),
});

/** Reduit la cible au silence (timeout Discord) pendant `minutes`. */
const timeoutEffect = z.object({
  type: z.literal('timeout'),
  // Discord plafonne le timeout a 28 jours ; on reste sous 7 jours.
  minutes: z.number().int().min(1).max(10_080),
  /** Chances (0-100 %) que ce soit TOI qui sois reduit au silence. */
  backfirePercent: z.number().int().min(0).max(100).default(10),
});

/** Draine l'energie de la cible sur la Route de l'Infini. */
const drainEnergyEffect = z.object({
  type: z.literal('drainEnergy'),
  energy: z.number().int().min(1).max(200),
  /** Chances (0-100 %) que ce soit TON energie qui parte. */
  backfirePercent: z.number().int().min(0).max(100).default(10),
});

/** Soigne sur la Route : soi-meme ou la cible (pendant de routeDamage). */
const healTargetEffect = z.object({
  type: z.literal('healTarget'),
  health: z.number().int().min(0).max(1000).default(0),
  energy: z.number().int().min(0).max(200).default(0),
  /** Qui est soigne : la cible (defaut) ou soi-meme. */
  on: z.enum(['self', 'target']).default('target'),
});

/** Renomme temporairement un membre ; le pseudo est restaure apres `minutes`. */
const nicknameEffect = z.object({
  type: z.literal('nickname'),
  // Discord plafonne un pseudo de serveur a 32 caracteres.
  nickname: z.string().min(1).max(32),
  minutes: z.number().int().min(1).max(10_080).default(60),
  /** Qui est renomme : soi-meme ou la cible. */
  on: z.enum(['self', 'target']).default('target'),
});

/** Colle un canneton a la cible pendant `turns` evenements de Route. */
const ducklingEffect = z.object({
  type: z.literal('duckling'),
  turns: z.number().int().min(1).max(100).default(5),
  /** Part des pieces gagnees prelevee au profit de celui qui l'a colle. */
  stealPercent: z.number().int().min(0).max(100).default(10),
  /** Part de la distance gagnee en moins. */
  distancePercent: z.number().int().min(0).max(100).default(10),
  /** Degats subis en plus. */
  damagePercent: z.number().int().min(0).max(100).default(10),
  /** Chances (0-100 %) que le canneton te colle a TOI. */
  backfirePercent: z.number().int().min(0).max(100).default(10),
});

/** Retire le canneton colle (a soi ou a la cible). */
const unstickDucklingEffect = z.object({
  type: z.literal('unstickDuckling'),
  on: z.enum(['self', 'target']).default('self'),
});

/**
 * Effets « simples » : tout sauf la boite mystere. Sert de base a la boite
 * mystere pour eviter toute recursion (donc pas de boite dans une boite).
 */
const baseEffects = [
  roleEffect,
  coinsEffect,
  routeSelfEffect,
  routeDamageEffect,
  grantItemEffect,
  privateChannelEffect,
  messageEffect,
  stealCoinsEffect,
  timeoutEffect,
  drainEnergyEffect,
  healTargetEffect,
  nicknameEffect,
  ducklingEffect,
  unstickDucklingEffect,
] as const;

const baseEffectSchema = z.discriminatedUnion('type', [...baseEffects]);
export type BaseItemEffect = z.infer<typeof baseEffectSchema>;

/**
 * Boite mystere : a l'usage, UN seul tirage pondere parmi `outcomes` est
 * applique. Un poids plus eleve = plus de chances de sortir.
 */
const mysteryBoxEffect = z.object({
  type: z.literal('mysteryBox'),
  outcomes: z
    .array(
      z.object({
        weight: z.number().int().min(1).max(1000).default(1),
        /** Libelle optionnel affiche quand ce tirage sort. */
        label: z.string().max(120).default(''),
        effects: z.array(baseEffectSchema).max(5),
      }),
    )
    .min(1)
    .max(10),
});

export const itemEffectSchema = z.discriminatedUnion('type', [...baseEffects, mysteryBoxEffect]);
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

/**
 * Au moins un effet exige-t-il une cible (membre visé) ? La cible attendue par
 * un effet est décrite par `effects-ui.ts`, seule source de vérité :
 * - `required` : cible toujours nécessaire ;
 * - `option`   : elle ne l'est que selon la config de l'effet (`on: 'target'`,
 *   ou un tirage de boîte mystère qui vise quelqu'un) ;
 * - `none`     : jamais.
 */
export function requiresTarget(effects: ItemEffect[]): boolean {
  return effects.some((effect) => {
    const spec = effectSpec(effect.type);
    if (spec?.target === 'required') return true;
    if (spec?.target !== 'option') return false;
    // Une boîte mystère vise quelqu'un dès qu'UN de ses tirages possibles le
    // fait : on ne sait pas à l'avance lequel sortira.
    if (effect.type === 'mysteryBox') {
      return effect.outcomes.some((outcome) => requiresTarget(outcome.effects));
    }
    return 'on' in effect && effect.on === 'target';
  });
}
