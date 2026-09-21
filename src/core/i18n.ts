import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.js';

const log = createLogger('i18n');

export const DEFAULT_LOCALE = 'fr';

/** Valeurs interpolables dans une traduction (`{nom}`). */
export type TranslateVars = Record<string, string | number>;

/** Signature de la fonction de traduction injectée aux modules. */
export type TranslateFn = (key: string, vars?: TranslateVars, locale?: string) => string;

type LocaleTree = { [key: string]: string | LocaleTree };

// dist/core/i18n.js -> ../../locales  ||  src/core/i18n.ts -> ../../locales
const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../locales');

const catalogues = new Map<string, LocaleTree>();

/**
 * Fusionne `source` dans `target`, en profondeur.
 *
 * Une langue est éclatée en un fichier par module : `locales/fr/gacha.json`
 * porte `{ modules: { gacha: … } }`, et tous se recouvrent sous la même racine.
 * Une fusion de surface écraserait `modules` au premier fichier suivant.
 */
function merge(target: LocaleTree, source: LocaleTree): LocaleTree {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof existing === 'object' &&
      existing !== null
    ) {
      merge(existing, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function readTree(path: string): LocaleTree | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LocaleTree;
  } catch (error) {
    log.error({ err: error, path }, 'Locale invalide, ignorée');
    return null;
  }
}

/**
 * Charge les langues depuis `locales/`.
 *
 * Deux dispositions cohabitent : un DOSSIER par langue (`locales/fr/*.json`,
 * un fichier par module) et un FICHIER par langue (`locales/fr.json`). La
 * première fait des textes d'un module une unité retirable du miroir public —
 * on ne retire pas un morceau de fichier, et les 8 000 caractères d'un jeu
 * qu'on croyait caché resteraient sinon publiés. La seconde reste acceptée :
 * un dépôt qui ne l'a pas encore adoptée doit continuer de fonctionner.
 */
function loadCatalogues(): void {
  let entries;
  try {
    entries = readdirSync(localesDir, { withFileTypes: true });
  } catch (error) {
    log.error({ err: error, localesDir }, 'Impossible de lire le dossier des locales');
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const locale = entry.name;
      const tree = catalogues.get(locale) ?? {};
      let parts = 0;
      for (const file of readdirSync(join(localesDir, locale))) {
        if (!file.endsWith('.json')) continue;
        const loaded = readTree(join(localesDir, locale, file));
        if (loaded) {
          merge(tree, loaded);
          parts += 1;
        }
      }
      catalogues.set(locale, tree);
      log.debug({ locale, parts }, 'Locale chargée');
      continue;
    }

    if (!entry.name.endsWith('.json')) continue;
    const locale = entry.name.replace(/\.json$/, '');
    const loaded = readTree(join(localesDir, entry.name));
    if (loaded) {
      catalogues.set(locale, merge(catalogues.get(locale) ?? {}, loaded));
      log.debug({ locale }, 'Locale chargée');
    }
  }

  if (!catalogues.has(DEFAULT_LOCALE)) {
    log.warn({ locale: DEFAULT_LOCALE }, 'Locale par défaut absente');
  }
}

loadCatalogues();

function lookup(tree: LocaleTree | undefined, key: string): string | undefined {
  if (!tree) return undefined;
  const parts = key.split('.');
  let current: string | LocaleTree | undefined = tree;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Traduit une clé pour une locale donnée.
 *
 * - Recherche par chemin pointé (ex. `core.ping.title`).
 * - Repli sur la locale par défaut (FR) si la clé manque.
 * - Renvoie la clé brute si introuvable partout (signale un oubli de traduction).
 */
export const t: TranslateFn = (key, vars, locale = DEFAULT_LOCALE) => {
  const value = lookup(catalogues.get(locale), key) ?? lookup(catalogues.get(DEFAULT_LOCALE), key);

  if (value === undefined) {
    log.warn({ key, locale }, 'Clé de traduction manquante');
    return key;
  }

  return interpolate(value, vars);
};

/** Liste des locales chargées. */
export function availableLocales(): string[] {
  return [...catalogues.keys()];
}
