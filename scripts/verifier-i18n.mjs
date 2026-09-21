#!/usr/bin/env node
/**
 * Vérifie que chaque clé de traduction appelée dans le code existe vraiment.
 *
 * `t()` rend la clé elle-même quand elle manque : le bot affiche alors
 * « modules.gacha.bonus.taken » à un joueur, et rien n'a échoué au build ni
 * aux tests. C'est arrivé deux fois — une clé renommée d'un côté seulement,
 * un motif d'échec sans traduction — d'où ce contrôle.
 *
 * Les langues ne sont pas énumérées ici : elles sont découvertes dans
 * `locales/`. Deux régimes, parce que deux exigences différentes :
 *
 *   - les langues de RÉFÉRENCE (fr, en) sont maintenues par le dépôt et doivent
 *     rester alignées au mot près ;
 *   - une langue AJOUTÉE (`locales/ch/`…) a le droit d'être incomplète — `t()`
 *     retombe sur le français, une traduction partielle est utilisable, et
 *     exiger 2 000 clés d'un contributeur serait interdire la contribution.
 *     On y vérifie donc autre chose : ses métadonnées (nom, drapeau), sans
 *     lesquelles elle s'afficherait « CH 🏳️ » dans les sélecteurs, et ses clés
 *     ORPHELINES, qui sont des fautes de frappe ou des restes d'un renommage.
 *
 * Usage : node scripts/verifier-i18n.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Langues tenues par le dépôt : alignement strict exigé entre elles. */
const REFERENCE_LOCALES = ['fr', 'en'];

/** Langue de repli : toute clé appelée dans le code doit y exister. */
const DEFAULT_LOCALE = 'fr';

/** Métadonnées qu'une langue doit déclarer pour être présentable. */
const META_KEYS = ['langue.nom', 'langue.drapeau'];

async function sources(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(full)));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** Aplatit un fichier de langue en un ensemble de chemins pointés. */
function flatten(value, prefix = '', out = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child, path, out);
    else out.add(path);
  }
  return out;
}

/**
 * Les langues présentes dans `locales/`, dossier (`locales/fr/*.json`) ou
 * fichier (`locales/fr.json`). Le code d'une langue est le nom de son dossier
 * en minuscules, comme dans `src/core/i18n.ts` : ce contrôle doit voir
 * exactement ce que le bot verra.
 */
async function discoverLocales() {
  const found = new Map();
  for (const entry of await readdir('locales', { withFileTypes: true })) {
    if (entry.isDirectory()) found.set(entry.name.toLowerCase(), join('locales', entry.name));
    else if (entry.name.endsWith('.json')) {
      found.set(entry.name.replace(/\.json$/, '').toLowerCase(), join('locales', entry.name));
    }
  }
  return found;
}

async function loadLocale(path) {
  const keys = new Set();
  if ((await stat(path)).isDirectory()) {
    for (const entry of await readdir(path)) {
      if (!entry.endsWith('.json')) continue;
      flatten(JSON.parse(await readFile(join(path, entry), 'utf8')), '', keys);
    }
    return keys;
  }
  return flatten(JSON.parse(await readFile(path, 'utf8')));
}

const paths = await discoverLocales();
const dictionaries = Object.fromEntries(
  await Promise.all([...paths].map(async ([locale, path]) => [locale, await loadLocale(path)])),
);

const problems = [];
const missingReference = REFERENCE_LOCALES.filter((locale) => !dictionaries[locale]);
for (const locale of missingReference) problems.push(`locales : langue « ${locale} » absente`);

const literals = new Map();
const prefixes = new Map();

for (const file of await sources('src')) {
  const code = await readFile(file, 'utf8');
  for (const match of code.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    const key = match[1];
    // Une clé littérale finissant par un point n'en est pas une : c'est un
    // préfixe concaténé (`t('a.b.' + suffixe)`). On la traite comme telle.
    if (key.endsWith('.')) prefixes.set(key.slice(0, -1), file);
    else literals.set(key, file);
  }
  // t(`a.b.${x}`) — on ne retient que la partie fixe, avant la première
  // interpolation, et on vérifie qu'elle mène quelque part.
  for (const match of code.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]*?)\$\{/g)) {
    const prefix = match[1].replace(/\.$/, '');
    if (prefix) prefixes.set(prefix, file);
  }
}

/** Langues à contrôler au mot près : celles que le dépôt maintient. */
const checked = REFERENCE_LOCALES.filter((locale) => dictionaries[locale]);

for (const [key, file] of literals) {
  for (const locale of checked) {
    if (!dictionaries[locale].has(key)) problems.push(`${file} : « ${key} » absente de ${locale}`);
  }
}

for (const [prefix, file] of prefixes) {
  for (const locale of checked) {
    const some = [...dictionaries[locale]].some((key) => key.startsWith(`${prefix}.`));
    if (!some) problems.push(`${file} : préfixe « ${prefix}.* » sans aucune clé en ${locale}`);
  }
}

// Alignement strict entre langues de référence, deux à deux.
for (const locale of checked) {
  for (const other of checked) {
    if (locale === other) continue;
    for (const key of dictionaries[locale]) {
      if (!dictionaries[other].has(key))
        problems.push(`locales : « ${key} » en ${locale} mais pas en ${other}`);
    }
  }
}

// Toute langue, référence comprise, doit se nommer et porter son drapeau :
// c'est ce que lisent les sélecteurs du bot et du site.
for (const [locale, keys] of Object.entries(dictionaries)) {
  for (const meta of META_KEYS) {
    if (!keys.has(meta)) {
      problems.push(`locales/${locale} : « ${meta} » manquante (bloc « langue » de commun.json)`);
    }
  }
}

// Langues ajoutées : incomplètes par droit, mais pas inventées. Une clé qu'on
// ne trouve nulle part en français est une faute de frappe ou le reste d'un
// renommage — dans les deux cas, elle ne sera jamais lue.
const extras = Object.keys(dictionaries).filter((locale) => !checked.includes(locale));
const coverage = [];
for (const locale of extras) {
  const reference = dictionaries[DEFAULT_LOCALE];
  if (!reference) break;
  for (const key of dictionaries[locale]) {
    if (!reference.has(key))
      problems.push(`locales/${locale} : « ${key} » inconnue en ${DEFAULT_LOCALE}`);
  }
  const translated = [...reference].filter((key) => dictionaries[locale].has(key)).length;
  coverage.push(
    `${locale} : ${String(translated)}/${String(reference.size)} clés (${String(
      Math.round((translated / Math.max(reference.size, 1)) * 100),
    )} %)`,
  );
}

if (problems.length > 0) {
  console.error(`✖ ${String(problems.length)} problème(s) de traduction :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `✔ ${String(literals.size)} clé(s) littérale(s) et ${String(prefixes.size)} préfixe(s) dynamique(s) vérifiés, ${checked.join(' et ')} alignés.`,
);
// Le reste n'est pas un défaut : une langue de la communauté a le droit d'être
// en chemin. On l'affiche pour qu'on sache où elle en est.
for (const line of coverage) console.log(`  langue ajoutée — ${line}`);
