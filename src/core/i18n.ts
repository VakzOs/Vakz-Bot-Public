import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * Ce qu'une langue dit d'elle-même — nom et drapeau tels qu'affichés dans les
 * sélecteurs du dashboard.
 *
 * Ces valeurs viennent du bloc `langue` de la langue elle-même
 * (`locales/<code>/commun.json`) et de nulle part ailleurs : une liste de noms
 * et de drapeaux tenue dans le code obligerait à modifier le cœur pour ajouter
 * une langue, et c'est précisément ce qu'on ne veut pas. Déposer un dossier
 * suffit.
 */
export interface LocaleInfo {
  /** Nom du dossier, en minuscules (`fr`, `en`, `ch`…). */
  code: string;
  /** Nom de la langue, écrit DANS cette langue (« Français », « English »). */
  name: string;
  /** Emoji drapeau affiché à côté du nom. */
  flag: string;
  /** Codes de langue Discord correspondants (`fr`, `en-US`…). */
  discord: string[];
}

/** Drapeau de repli : une langue qui n'en déclare pas reste affichable. */
const FALLBACK_FLAG = '🏳️';

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
 *
 * Aucune liste de langues n'est tenue ici : ce qui est là est chargé. Déposer
 * `locales/ch/` suffit à faire apparaître le suisse allemand dans le bot et
 * dans le dashboard.
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
      // Le code d'une langue est le nom de son dossier, normalisé : `CH` et
      // `ch` désignent la même langue, et un code stocké en base ou reçu du
      // dashboard doit retrouver son catalogue quelle que soit sa casse.
      const locale = entry.name.toLowerCase();
      const tree = catalogues.get(locale) ?? {};
      let parts = 0;
      for (const file of readdirSync(join(localesDir, entry.name))) {
        if (!file.endsWith('.json')) continue;
        const loaded = readTree(join(localesDir, entry.name, file));
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
    const locale = entry.name.replace(/\.json$/, '').toLowerCase();
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
 * La langue en vigueur pour le traitement en cours (interaction, évènement).
 *
 * Les 1 200 appels à `t('clé')` du dépôt ne passent pas de langue : la leur
 * passer un à un serait une réécriture de tous les modules, et le prochain
 * module l'oublierait. Le cœur pose donc la langue du serveur autour du
 * traitement (voir `runWithLocale`), et `t()` la retrouve ici. Hors de tout
 * traitement — démarrage, construction des slash commands — le magasin est
 * vide et la langue par défaut s'applique.
 */
const localeStore = new AsyncLocalStorage<string>();

/** Exécute `fn` avec `locale` comme langue ambiante pour tout ce qu'il appelle. */
export function runWithLocale<T>(locale: string | undefined, fn: () => T): T {
  if (!locale) return fn();
  return localeStore.run(normalizeLocale(locale), fn);
}

/** La langue ambiante, si un traitement en a posé une. */
export function currentLocale(): string | undefined {
  return localeStore.getStore();
}

/**
 * Pose la langue pour LA SUITE du traitement en cours, sans envelopper de
 * fonction.
 *
 * `runWithLocale` demande une fermeture ; au milieu d'une tâche planifiée qui
 * parcourt les serveurs, cela voudrait dire réécrire la boucle — et un `continue`
 * dans une fermeture n'est plus un `continue`. Une ligne en tête d'itération
 * suffit ici, et l'itération suivante repose la sienne.
 *
 * L'effet est borné au contexte asynchrone courant : le cœur exécute chaque
 * tâche dans un `runWithLocale`, ce qui garantit qu'une langue posée par une
 * tâche ne survit pas à cette tâche.
 */
export function useLocale(locale: string): void {
  localeStore.enterWith(normalizeLocale(locale));
}

/** Normalise un code de langue (casse, espaces). */
export function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase();
}

/**
 * Traduit une clé pour une locale donnée.
 *
 * - Recherche par chemin pointé (ex. `core.ping.title`).
 * - Langue explicite, sinon celle du traitement en cours, sinon FR.
 * - Repli sur la locale par défaut (FR) si la clé manque : une traduction
 *   partielle reste utilisable, ce qui est la condition pour qu'une langue
 *   proposée par la communauté puisse arriver incomplète.
 * - Renvoie la clé brute si introuvable partout (signale un oubli de traduction).
 */
export const t: TranslateFn = (key, vars, locale) => {
  const wanted = normalizeLocale(locale ?? currentLocale() ?? DEFAULT_LOCALE);
  const value = lookup(catalogues.get(wanted), key) ?? lookup(catalogues.get(DEFAULT_LOCALE), key);

  if (value === undefined) {
    log.warn({ key, locale: wanted }, 'Clé de traduction manquante');
    return key;
  }

  return interpolate(value, vars);
};

/** Liste des locales chargées. */
export function availableLocales(): string[] {
  return [...catalogues.keys()];
}

/** Cette langue est-elle chargée ? (Garde d'entrée : API web, base.) */
export function isKnownLocale(locale: string): boolean {
  return catalogues.has(normalizeLocale(locale));
}

/** Ce qu'une langue dit d'elle-même, avec des replis si elle le tait. */
export function localeInfo(code: string): LocaleInfo {
  const locale = normalizeLocale(code);
  const tree = catalogues.get(locale);
  const discord = lookup(tree, 'langue.discord') ?? locale;
  return {
    code: locale,
    // Sans nom déclaré, le code est un pis-aller lisible (« CH ») : mieux vaut
    // une ligne dans le sélecteur qu'une langue introuvable.
    name: lookup(tree, 'langue.nom') ?? locale.toUpperCase(),
    flag: lookup(tree, 'langue.drapeau') ?? FALLBACK_FLAG,
    discord: discord
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

/**
 * Toutes les langues disponibles, la langue par défaut en tête puis les autres
 * par ordre alphabétique de nom. C'est ce que servent l'API web et les
 * sélecteurs.
 */
export function listLocales(): LocaleInfo[] {
  return availableLocales()
    .map((code) => localeInfo(code))
    .sort((a, b) => {
      if (a.code === DEFAULT_LOCALE) return -1;
      if (b.code === DEFAULT_LOCALE) return 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * La langue chargée qui correspond à un code Discord (`fr`, `en-GB`, `de`).
 *
 * Discord donne la langue du serveur ou du membre ; on cherche d'abord une
 * langue qui revendique ce code exact dans son bloc `langue.discord`, puis un
 * préfixe (`en-GB` -> `en`). `undefined` quand aucune ne correspond : à
 * l'appelant de décider s'il reste sur la langue du serveur ou sur FR.
 */
export function matchDiscordLocale(discordLocale: string | undefined): string | undefined {
  if (!discordLocale) return undefined;
  const wanted = normalizeLocale(discordLocale);
  const infos = listLocales();
  const exact = infos.find((info) => info.discord.some((code) => normalizeLocale(code) === wanted));
  if (exact) return exact.code;
  const base = wanted.split('-')[0] ?? wanted;
  return infos.find(
    (info) =>
      info.code === base ||
      info.discord.some((code) => normalizeLocale(code).split('-')[0] === base),
  )?.code;
}
