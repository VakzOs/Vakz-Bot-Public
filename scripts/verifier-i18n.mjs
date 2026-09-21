#!/usr/bin/env node
/**
 * Vérifie que chaque clé de traduction appelée dans le code existe vraiment.
 *
 * `t()` rend la clé elle-même quand elle manque : le bot affiche alors
 * « modules.gacha.bonus.taken » à un joueur, et rien n'a échoué au build ni
 * aux tests. C'est arrivé deux fois — une clé renommée d'un côté seulement,
 * un motif d'échec sans traduction — d'où ce contrôle.
 *
 * Trois choses vérifiées :
 *   1. toute clé littérale appelée dans `src/` existe en français ;
 *   2. les deux fichiers de langue portent exactement les mêmes clés ;
 *   3. les clés construites dynamiquement (`t(`a.b.${x}`)`) ont au moins un
 *      enfant sous leur préfixe — on ne peut pas deviner `x`, mais un préfixe
 *      entièrement absent est à coup sûr une erreur.
 *
 * Usage : node scripts/verifier-i18n.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const LOCALES = ['fr', 'en'];

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
 * Charge une langue, éclatée en un fichier par module (`locales/fr/*.json`) ou
 * d'un seul tenant (`locales/fr.json`).
 *
 * Les deux dispositions sont acceptées, comme dans `src/core/i18n.ts` : ce
 * contrôle doit voir exactement ce que le bot verra, sinon il valide un
 * catalogue qui n'est pas celui qui tourne.
 */
async function loadLocale(locale) {
  const keys = new Set();
  try {
    for (const entry of await readdir(`locales/${locale}`)) {
      if (!entry.endsWith('.json')) continue;
      flatten(JSON.parse(await readFile(`locales/${locale}/${entry}`, 'utf8')), '', keys);
    }
    return keys;
  } catch {
    // Pas de dossier : disposition d'un seul fichier.
  }
  return flatten(JSON.parse(await readFile(`locales/${locale}.json`, 'utf8')));
}

const dictionaries = Object.fromEntries(
  await Promise.all(LOCALES.map(async (locale) => [locale, await loadLocale(locale)])),
);

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

const problems = [];

for (const [key, file] of literals) {
  for (const locale of LOCALES) {
    if (!dictionaries[locale].has(key))
      problems.push(`${file} : « ${key} » absente de ${locale}.json`);
  }
}

for (const [prefix, file] of prefixes) {
  for (const locale of LOCALES) {
    const some = [...dictionaries[locale]].some((key) => key.startsWith(`${prefix}.`));
    if (!some) problems.push(`${file} : préfixe « ${prefix}.* » sans aucune clé en ${locale}.json`);
  }
}

const [fr, en] = [dictionaries.fr, dictionaries.en];
for (const key of fr) if (!en.has(key)) problems.push(`locales : « ${key} » en fr mais pas en en`);
for (const key of en) if (!fr.has(key)) problems.push(`locales : « ${key} » en en mais pas en fr`);

if (problems.length > 0) {
  console.error(`✖ ${String(problems.length)} problème(s) de traduction :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `✔ ${String(literals.size)} clé(s) littérale(s) et ${String(prefixes.size)} préfixe(s) dynamique(s) vérifiés, fr et en alignés.`,
);
