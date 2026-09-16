/**
 * Catégories du dashboard, qui range les modules et les illustre.
 *
 * Le visuel (catégorie + emoji) vivait ici, dans une table indexée par nom de
 * module. Deux défauts, le second décisif :
 *   - un module dont on oubliait la ligne tombait SILENCIEUSEMENT dans
 *     « operations », loin de son code, sans que rien n'échoue ;
 *   - la table nommait chaque module, donc survivait à son dossier : publier
 *     une variante du bot sans un module laissait quand même son nom ici.
 *
 * Le visuel se déclare donc sur le module (`category` et `emoji` de
 * `defineModule`), comme le reste de ce qu'il annonce. Ne reste ici que le
 * vocabulaire commun — les catégories — et le repli pour qui n'en déclare pas.
 */
export type CategoryId = 'security' | 'community' | 'engagement' | 'operations' | 'fun';

export interface ModuleVisual {
  category: CategoryId;
  emoji: string;
}

/**
 * Le repli : un module qui ne dit rien de lui-même reste rangeable, plutôt que
 * de faire échouer le dashboard pour une question de décor.
 */
export const DEFAULT_VISUAL: ModuleVisual = { category: 'operations', emoji: '\u{2699}\u{FE0F}' };

/**
 * Le visuel d'un module.
 *
 * Prend le module et non son nom : la table par nom est précisément ce dont on
 * s'est débarrassé. Le paramètre est structurel pour ne pas faire dépendre ce
 * fichier de `module.ts`, qui dépend déjà de lui pour `CategoryId`.
 */
export function moduleVisual(module: { category?: CategoryId; emoji?: string }): ModuleVisual {
  return {
    category: module.category ?? DEFAULT_VISUAL.category,
    emoji: module.emoji ?? DEFAULT_VISUAL.emoji,
  };
}
