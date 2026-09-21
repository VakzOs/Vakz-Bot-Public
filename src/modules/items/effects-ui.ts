import type { ItemEffect } from './effects-schema.js';

/**
 * Contrat d'interface des effets d'objets, servi tel quel au dashboard web
 * (`GET /api/guilds/:id/items` → `effectsUI`).
 *
 * Le site ne connaît AUCUN type d'effet : il génère son éditeur à partir de
 * cette table. Ajouter un effet ici le fait donc apparaître sur le dashboard
 * sans toucher au dépôt du site.
 *
 * Même esprit que `configUI` pour les modules (voir `core/module.ts`).
 */

/**
 * Contrôle à afficher pour un champ d'effet.
 * - `number`   : entier libre (bornes `min`/`max` facultatives).
 * - `percent`  : entier 0–100, affiché avec un suffixe « % ».
 * - `text`     : ligne de texte (`maxLength`).
 * - `textarea` : texte multi-lignes (`maxLength`).
 * - `role`     : sélecteur de rôle du serveur.
 * - `item`     : sélecteur d'objet du catalogue du serveur.
 * - `select`   : liste de choix fixes fournie par `options`.
 */
export type EffectFieldType =
  | 'number'
  | 'percent'
  | 'text'
  | 'textarea'
  | 'role'
  | 'item'
  | 'select';

/** Un champ éditable d'un effet (rendu par le dashboard). */
export interface EffectField {
  /** Clé dans l'objet d'effet (ex. `health`). */
  key: string;
  /** Libellé affiché au-dessus du contrôle. */
  label: string;
  type: EffectFieldType;
  /** Valeur posée à la création de l'effet (doit satisfaire le schéma zod). */
  default: string | number;
  help?: string;
  placeholder?: string;
  /** Types `number` (et `percent`, qui vaut 0–100 par défaut). */
  min?: number;
  max?: number;
  /** Types `text` / `textarea`. */
  maxLength?: number;
  /** Type `select` : choix possibles. */
  options?: { value: string; label: string }[];
  /** Largeur du champ sur une grille de 6 colonnes (défaut : pleine largeur). */
  span?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Description complète d'un type d'effet pour l'éditeur web. */
export interface EffectSpec {
  type: ItemEffect['type'];
  /** Libellé de l'entrée dans le sélecteur de type (emoji inclus). */
  label: string;
  /** Aide affichée sous le sélecteur. */
  help: string;
  /**
   * Cible (membre visé) attendue par l'effet :
   * - `none`     : aucune cible ;
   * - `required` : `/utiliser` exige un membre visé ;
   * - `option`   : cible facultative, l'effet s'applique sans elle.
   */
  target: 'none' | 'required' | 'option';
  fields: EffectField[];
}

/**
 * Table des effets exposés au dashboard. L'ordre est celui du sélecteur ; la
 * première entrée sert de type par défaut à l'ajout d'un effet.
 */
export const itemEffectsUI: EffectSpec[] = [
  {
    type: 'routeDamage',
    label: '🎯 Dégâts sur la Route',
    help: 'Inflige des dégâts à un membre ciblé sur son voyage.',
    target: 'required',
    fields: [
      { key: 'health', label: 'Dégâts infligés à la cible', type: 'number', default: 20, min: 1 },
    ],
  },
  {
    type: 'role',
    label: '🏷️ Donner un rôle',
    help: 'Accorde un rôle Discord à celui qui l’utilise.',
    target: 'none',
    fields: [{ key: 'roleId', label: 'Rôle à donner', type: 'role', default: '' }],
  },
  {
    type: 'routeSelf',
    label: '🧭 Soin / énergie / distance',
    help: 'Bonus appliqué à SON propre voyage.',
    target: 'none',
    fields: [
      { key: 'health', label: '❤️ Vie', type: 'number', default: 0, span: 2 },
      { key: 'energy', label: '⚡ Énergie', type: 'number', default: 0, span: 2 },
      { key: 'distance', label: '📏 Distance', type: 'number', default: 0, span: 2 },
    ],
  },
  {
    type: 'coins',
    label: '🪙 Donner des pièces',
    help: 'Crédite (ou retire) des pièces d’économie.',
    target: 'none',
    fields: [{ key: 'amount', label: 'Pièces (négatif = retrait)', type: 'number', default: 100 }],
  },
  {
    type: 'grantItem',
    label: '🎁 Donner un objet',
    help: 'Ajoute un autre objet à l’inventaire.',
    target: 'none',
    fields: [
      { key: 'itemId', label: 'Objet à donner', type: 'item', default: '', span: 4 },
      { key: 'quantity', label: 'Qté', type: 'number', default: 1, min: 1, max: 999, span: 2 },
    ],
  },
  {
    type: 'privateChannel',
    label: '🔒 Salon privé',
    help: 'Crée un salon visible par lui seul (et les admins).',
    target: 'none',
    fields: [
      {
        key: 'name',
        label: 'Nom du salon ({user} = pseudo)',
        type: 'text',
        default: 'salon-{user}',
        placeholder: 'salon-{user}',
        maxLength: 90,
      },
    ],
  },
  {
    type: 'message',
    label: '💬 Message',
    help: 'Affiche un message personnalisé.',
    target: 'none',
    fields: [
      {
        key: 'text',
        label: 'Message affiché',
        type: 'textarea',
        default: '',
        placeholder: 'Message affiché à l’utilisation…',
        maxLength: 500,
      },
    ],
  },
  {
    type: 'stealCoins',
    label: '🪙 Voler des pièces',
    help: 'Dérobe des pièces à la cible et te les crédite (borné à ce qu’elle possède).',
    target: 'required',
    fields: [
      { key: 'amount', label: 'Pièces volées', type: 'number', default: 50, min: 1, span: 3 },
      {
        key: 'backfirePercent',
        label: 'Retour de bâton (%)',
        type: 'percent',
        default: 10,
        help: 'Chances que le vol se retourne : c’est toi qui paies la cible. 0 = désactivé.',
        span: 3,
      },
    ],
  },
  {
    type: 'timeout',
    label: '🤐 Réduire au silence',
    help: 'Applique un timeout Discord à la cible (permission « Isoler les membres » requise).',
    target: 'required',
    fields: [
      {
        key: 'minutes',
        label: 'Durée (minutes)',
        type: 'number',
        default: 10,
        min: 1,
        max: 10080,
        span: 3,
      },
      {
        key: 'backfirePercent',
        label: 'Retour de bâton (%)',
        type: 'percent',
        default: 10,
        help: 'Chances que ce soit toi qui sois réduit au silence. 0 = désactivé.',
        span: 3,
      },
    ],
  },
  {
    type: 'drainEnergy',
    label: '🥱 Drainer l’énergie',
    help: 'Vide l’énergie de la cible sur la Route de l’Infini.',
    target: 'required',
    fields: [
      {
        key: 'energy',
        label: 'Énergie drainée',
        type: 'number',
        default: 30,
        min: 1,
        max: 200,
        span: 3,
      },
      {
        key: 'backfirePercent',
        label: 'Retour de bâton (%)',
        type: 'percent',
        default: 10,
        help: 'Chances que ce soit ton énergie qui parte. 0 = désactivé.',
        span: 3,
      },
    ],
  },
  {
    type: 'healTarget',
    label: '💚 Soigner sur la Route',
    help: 'Rend des PV et/ou de l’énergie, à la cible ou à soi-même.',
    target: 'option',
    fields: [
      {
        key: 'health',
        label: '❤️ PV rendus',
        type: 'number',
        default: 25,
        min: 0,
        max: 1000,
        span: 2,
      },
      {
        key: 'energy',
        label: '⚡ Énergie rendue',
        type: 'number',
        default: 0,
        min: 0,
        max: 200,
        span: 2,
      },
      {
        key: 'on',
        label: 'Appliquer sur',
        type: 'select',
        default: 'target',
        options: [
          { value: 'target', label: 'La cible' },
          { value: 'self', label: 'Soi-même' },
        ],
        span: 2,
      },
    ],
  },
  {
    type: 'nickname',
    label: '🏷️ Renommage temporaire',
    help: 'Change le pseudo pour une durée limitée, puis le restaure. Impossible sur un membre de rang égal ou supérieur au bot.',
    target: 'option',
    fields: [
      {
        key: 'nickname',
        label: 'Nouveau pseudo',
        type: 'text',
        default: '',
        placeholder: 'Canneton',
        maxLength: 32,
        span: 3,
      },
      {
        key: 'minutes',
        label: 'Durée (minutes)',
        type: 'number',
        default: 60,
        min: 1,
        max: 10080,
        span: 2,
      },
      {
        key: 'on',
        label: 'Sur',
        type: 'select',
        default: 'target',
        options: [
          { value: 'target', label: 'La cible' },
          { value: 'self', label: 'Soi-même' },
        ],
        span: 1,
      },
    ],
  },
  {
    type: 'duckling',
    label: '🐥 Coller un canneton',
    help: 'Colle un canneton à la cible : il prélève une part de ses gains (à ton profit), la ralentit et amplifie les dégâts qu’elle subit, pendant X événements de Route.',
    target: 'required',
    fields: [
      {
        key: 'turns',
        label: 'Durée (événements)',
        type: 'number',
        default: 5,
        min: 1,
        max: 100,
        span: 3,
      },
      { key: 'stealPercent', label: '🪙 Gains volés (%)', type: 'percent', default: 10, span: 3 },
      {
        key: 'distancePercent',
        label: '📏 Distance en moins (%)',
        type: 'percent',
        default: 10,
        span: 2,
      },
      {
        key: 'damagePercent',
        label: '❤️ Dégâts en plus (%)',
        type: 'percent',
        default: 10,
        span: 2,
      },
      {
        key: 'backfirePercent',
        label: 'Retour de bâton (%)',
        type: 'percent',
        default: 10,
        help: 'Chances que le canneton te colle à toi (la cible touche alors le butin). 0 = désactivé.',
        span: 2,
      },
    ],
  },
  {
    type: 'unstickDuckling',
    label: '🕊️ Chasser le canneton',
    help: 'Retire le canneton collé, à soi ou à la cible.',
    target: 'option',
    fields: [
      {
        key: 'on',
        label: 'Chasser celui de',
        type: 'select',
        default: 'self',
        options: [
          { value: 'self', label: 'Soi-même' },
          { value: 'target', label: 'La cible' },
        ],
      },
    ],
  },
  {
    type: 'mysteryBox',
    label: '🎲 Boîte mystère',
    help: 'Tire au sort UN groupe d’effets parmi une liste pondérée (poids plus élevé = plus probable). Ne peut pas contenir une autre boîte mystère.',
    target: 'option',
    fields: [
      {
        key: 'outcomes',
        label: 'Tirages possibles',
        type: 'textarea',
        default: '[]',
        help: 'Liste JSON de { weight, label, effects[] } — effets simples uniquement.',
        placeholder: '[{"weight":9,"label":"Broutille","effects":[{"type":"coins","amount":5}]}]',
      },
    ],
  },
];

/** Description d'un type d'effet, ou `undefined` s'il est inconnu. */
export function effectSpec(type: string): EffectSpec | undefined {
  return itemEffectsUI.find((spec) => spec.type === type);
}
