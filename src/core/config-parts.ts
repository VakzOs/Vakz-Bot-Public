import type { PartialGrant } from './guild-access.js';
import type { ConfigField, ConfigGroup } from './module.js';

/**
 * Ce qu'un gradé partiel peut faire d'un bloc de réglages.
 *
 * Le dashboard renvoie l'objet de configuration ENTIER, toujours : c'est ici
 * qu'on décide ce qu'on en retient, à deux crans de finesse. Le **bloc** —
 * déléguer « Anti-spam » ne doit pas revenir à déléguer tout l'automod à qui
 * sait écrire une requête HTTP. Et le **verbe** : confier les messages épinglés
 * à quelqu'un qui pourra en ajouter sans toucher à ceux des autres.
 *
 * La règle vit dans son propre fichier parce qu'elle se vérifie seule — voir
 * `npm run check:acces` — et ce fichier ne doit rien importer de la base.
 */

/**
 * Les gestes qu'un grade peut recevoir sur un bloc, du plus inoffensif au plus
 * lourd.
 *
 *   - `lire`       — voir le bloc, sans rien pouvoir enregistrer ;
 *   - `modifier`   — écrire ses champs, et le contenu de ses lignes ;
 *   - `creer`      — ajouter une ligne à une de ses listes ;
 *   - `supprimer`  — en retirer une ;
 *   - `reordonner` — changer l'ordre des lignes sans toucher à leur contenu ;
 *   - `basculer`   — n'actionner que les INTERRUPTEURS d'une ligne, c'est-à-dire
 *                    l'activer ou la désactiver sans pouvoir la réécrire.
 *
 * Tous n'ont pas de sens partout : un bloc sans liste n'a rien à créer, et
 * l'ordre ne veut rien dire pour une liste dont les lignes n'ont pas
 * d'identifiant. `verbsFor()` ne propose donc que ceux que la forme du bloc
 * rend réels.
 */
export const LIST_VERBS = [
  'lire',
  'modifier',
  'creer',
  'supprimer',
  'reordonner',
  'basculer',
] as const;

export type ListVerb = (typeof LIST_VERBS)[number];

/** Les verbes qui ÉCRIVENT. `lire` est le seul qui ne touche à rien. */
const WRITING_VERBS: ReadonlySet<ListVerb> = new Set<ListVerb>([
  'modifier',
  'creer',
  'supprimer',
  'reordonner',
  'basculer',
]);

/**
 * L'identifiant d'un bloc de réglages, dans son module.
 *
 * C'est la clé du groupe (`spam`, `badWords`…) quand il en a une. Un groupe
 * sans clé écrit à la racine de la config : il n'a pas de nom propre, on le
 * désigne donc par son rang, sous une forme qu'aucune clé de config ne peut
 * prendre. Réordonner les groupes d'un module déplace donc CES délégations-là —
 * le prix d'un bloc qui, par construction, n'a pas d'identité.
 */
export function configPartId(group: ConfigGroup, index: number): string {
  return group.key ?? `@${index}`;
}

/** Les champs `list` d'un bloc : ce sont eux qui ont des lignes à gouverner. */
export function listFields(group: ConfigGroup): ConfigField[] {
  return group.fields.filter((field) => field.type === 'list');
}

/** Ce bloc a-t-il des lignes, donc des verbes de liste à distribuer ? */
export function hasRows(group: ConfigGroup): boolean {
  return listFields(group).length > 0;
}

/** Une ligne de cette liste porte-t-elle au moins un interrupteur ? */
function hasSwitch(field: ConfigField): boolean {
  return (field.item ?? []).some((sub) => sub.type === 'boolean');
}

/**
 * Les verbes qui ont un sens sur CE bloc.
 *
 * Ils se déduisent de sa forme, jamais d'une liste tenue à la main : un module
 * ajouté propose d'emblée les bons, et un champ qui change de type les fait
 * suivre. Proposer `reordonner` sur une liste sans identifiant de ligne, par
 * exemple, serait promettre un réglage que l'on ne saurait pas appliquer —
 * l'ordre y est la seule identité des lignes.
 */
export function verbsFor(group: ConfigGroup): ListVerb[] {
  const verbs: ListVerb[] = ['lire', 'modifier'];
  const lists = listFields(group);
  if (lists.length === 0) return verbs;
  verbs.push('creer', 'supprimer');
  if (lists.some((field) => field.idKey)) verbs.push('reordonner');
  if (lists.some(hasSwitch)) verbs.push('basculer');
  return verbs;
}

/** Ce grade peut-il ÉCRIRE quelque chose de ce bloc, ou seulement le lire ? */
function writes(verbs: ReadonlySet<ListVerb>): boolean {
  for (const verb of verbs) if (WRITING_VERBS.has(verb)) return true;
  return false;
}

/** Une valeur atteinte par une clé éventuellement « pointée » (`a.b`). */
function readPath(source: Record<string, unknown>, path: string): unknown {
  let node: unknown = source;
  for (const step of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[step];
  }
  return node;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const steps = path.split('.');
  const last = steps.pop();
  if (!last) return;
  let node = target;
  for (const step of steps) {
    const next = node[step];
    const child = next && typeof next === 'object' && !Array.isArray(next) ? { ...next } : {};
    node[step] = child;
    node = child as Record<string, unknown>;
  }
  node[last] = value;
}

function asRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** L'identifiant d'une ligne, quand la liste en pose un (`idKey`). */
function rowId(row: unknown, idKey: string | undefined): string | undefined {
  if (!idKey) return undefined;
  const record = asRecord(row);
  const value = record?.[idKey];
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Les lignes à garder, une fois les verbes appliqués.
 *
 * On ne refuse pas l'enregistrement : on repart des lignes en place et l'on n'y
 * applique que les gestes permis. Une ligne ajoutée sans le droit de créer est
 * ignorée, une ligne retirée sans le droit de supprimer revient, une ligne
 * réécrite sans le droit de modifier retrouve son texte — sauf ses
 * interrupteurs, si le grade a `basculer`.
 *
 * L'appariement se fait par `idKey` quand la liste en déclare un : c'est exact,
 * même après un changement d'ordre, ce qui permet de distinguer « réordonner »
 * de « réécrire ». Sans identifiant, les lignes n'ont d'autre identité que leur
 * rang : on apparie rang à rang, et l'ordre ne se délègue pas séparément —
 * retirer une ligne au milieu s'y lit comme « les suivantes ont été réécrites,
 * la dernière supprimée ». Le compte y est, les droits aussi ; seul le récit
 * diffère.
 */
export function keepAllowedRows(
  before: unknown[],
  after: unknown[],
  field: Pick<ConfigField, 'idKey' | 'item'>,
  verbs: ReadonlySet<ListVerb>,
): unknown[] {
  const may = (verb: ListVerb): boolean => verbs.has(verb);
  const idKey = field.idKey;

  /** Ce que devient une ligne conservée : réécrite, basculée, ou intacte. */
  const content = (previous: unknown, next: unknown): unknown => {
    if (may('modifier')) return next;
    const from = asRecord(next);
    const base = asRecord(previous);
    if (!may('basculer') || !from || !base) return previous;
    // Seuls les INTERRUPTEURS passent : c'est ce qui distingue « désactiver une
    // alerte » de « la réécrire ». Le type suffit à les reconnaître — aucun nom
    // de champ n'est deviné ici.
    const row: Record<string, unknown> = { ...base };
    for (const sub of field.item ?? []) {
      if (sub.type !== 'boolean') continue;
      const value = readPath(from, sub.key);
      if (value !== undefined) writePath(row, sub.key, value);
    }
    return row;
  };

  if (idKey) {
    const known = new Map<string, unknown>();
    for (const row of before) {
      const id = rowId(row, idKey);
      if (id) known.set(id, row);
    }

    if (may('reordonner')) {
      // L'ordre soumis fait foi : on suit `after`, ligne à ligne.
      const seen = new Set<string>();
      const kept: unknown[] = [];
      for (const row of after) {
        const id = rowId(row, idKey);
        const previous = id ? known.get(id) : undefined;
        if (previous === undefined) {
          if (may('creer')) kept.push(row);
          continue;
        }
        if (id) seen.add(id);
        kept.push(content(previous, row));
      }
      if (!may('supprimer')) {
        // Ce qui a disparu revient à sa place, pas à la fin.
        before.forEach((row, index) => {
          const id = rowId(row, idKey);
          if (id && seen.has(id)) return;
          kept.splice(Math.min(index, kept.length), 0, row);
        });
      }
      return kept;
    }

    // Sans « reordonner », l'ordre reste CELUI D'AVANT : une liste est souvent
    // ordonnée, et changer son ordre change son effet.
    const submitted = new Map<string, unknown>();
    for (const row of after) {
      const id = rowId(row, idKey);
      if (id) submitted.set(id, row);
    }
    const kept: unknown[] = [];
    for (const row of before) {
      const id = rowId(row, idKey);
      const next = id ? submitted.get(id) : undefined;
      if (next === undefined) {
        if (!may('supprimer')) kept.push(row);
        continue;
      }
      kept.push(content(row, next));
    }
    if (may('creer')) {
      for (const row of after) {
        const id = rowId(row, idKey);
        if (!id || !known.has(id)) kept.push(row);
      }
    }
    return kept;
  }

  // Pas d'identifiant : le rang est la seule identité des lignes.
  const kept: unknown[] = [];
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    const previous = before[index];
    const next = after[index];
    if (previous === undefined) {
      if (may('creer') && next !== undefined) kept.push(next);
      continue;
    }
    if (next === undefined) {
      if (!may('supprimer')) kept.push(previous);
      continue;
    }
    kept.push(content(previous, next));
  }
  return kept;
}

/**
 * La config à retenir quand l'acteur n'a qu'une PARTIE du module.
 *
 * On part de la config en place et l'on n'y réécrit que les blocs ouverts, dans
 * la limite de leurs verbes : le dashboard peut bien renvoyer l'objet entier,
 * ce qu'il contient d'autre est ignoré. Sans cette fusion, déléguer
 * « Anti-spam » reviendrait à déléguer tout l'automod à qui sait écrire une
 * requête HTTP.
 *
 * Le même appel, avec une base vide, sert à ne SERVIR que les blocs ouverts :
 * un bloc qu'on ne peut pas voir n'a pas non plus à se lire. Un bloc ouvert en
 * lecture seule (`lire`) se sert donc, mais ne s'écrit jamais — d'où le
 * `readOnly`, qui distingue les deux usages de cette fonction.
 */
export function keepAllowedGroups(
  base: Record<string, unknown>,
  submitted: unknown,
  configUI: ConfigGroup[] | undefined,
  grant: PartialGrant,
  { readOnly = false }: { readOnly?: boolean } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  const source = asRecord(submitted);
  if (!source) return result;

  (configUI ?? []).forEach((group, index) => {
    const granted = grant.parts.get(configPartId(group, index));
    if (!granted) return;
    const verbs: ReadonlySet<ListVerb> =
      granted === '*' ? new Set(verbsFor(group)) : new Set(granted);
    // Lecture seule : le bloc se sert, mais rien n'en revient à l'écriture.
    if (!readOnly && !writes(verbs)) return;

    // Un groupe avec clé écrit dans un sous-objet ; sans clé, à la racine. Dans
    // les deux cas on avance CHAMP PAR CHAMP : remplacer le sous-objet entier
    // emporterait aussi ce que le module y a persisté lui-même (le `messageId`
    // d'un panneau publié) et que le formulaire ne renvoie pas forcément.
    const into: Record<string, unknown> = group.key
      ? { ...(asRecord(result[group.key]) ?? {}) }
      : result;
    const from = group.key ? (asRecord(source[group.key]) ?? {}) : source;

    for (const field of group.fields) {
      // Servir, c'est montrer ce qui est là — les verbes ne gouvernent que
      // l'écriture. Filtrer les lignes ici priverait un gradé « lire » de tout
      // ce qu'il a justement le droit de voir.
      if (readOnly) {
        const value = readPath(from, field.key);
        if (value !== undefined) writePath(into, field.key, value);
        continue;
      }
      if (field.type === 'list') {
        // Les lignes ont leurs propres droits : on n'écrit pas la liste, on la
        // recompose geste par geste.
        writePath(
          into,
          field.key,
          keepAllowedRows(
            asRows(readPath(into, field.key)),
            asRows(readPath(from, field.key)),
            field,
            verbs,
          ),
        );
        continue;
      }
      // Un champ ordinaire ne se crée ni ne se supprime : il se modifie.
      if (!verbs.has('modifier')) continue;
      const value = readPath(from, field.key);
      if (value !== undefined) writePath(into, field.key, value);
    }

    if (group.key) result[group.key] = into;
  });

  return result;
}
