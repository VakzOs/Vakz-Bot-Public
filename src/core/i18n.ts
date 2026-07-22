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

function loadCatalogues(): void {
  let files: string[];
  try {
    files = readdirSync(localesDir).filter((file) => file.endsWith('.json'));
  } catch (error) {
    log.error({ err: error, localesDir }, 'Impossible de lire le dossier des locales');
    return;
  }

  for (const file of files) {
    const locale = file.replace(/\.json$/, '');
    try {
      const raw = readFileSync(join(localesDir, file), 'utf8');
      catalogues.set(locale, JSON.parse(raw) as LocaleTree);
      log.debug({ locale }, 'Locale chargée');
    } catch (error) {
      log.error({ err: error, file }, 'Locale invalide, ignorée');
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
  const value =
    lookup(catalogues.get(locale), key) ?? lookup(catalogues.get(DEFAULT_LOCALE), key);

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
