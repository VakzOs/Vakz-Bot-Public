/**
 * Vérification des réglages de module dans toutes les langues
 * (`npm run reglages:check`).
 *
 * Le dashboard n'affiche pas que le nom d'un module : il affiche le formulaire
 * qui le règle, et c'est là que vit l'essentiel de son texte — le titre de
 * chaque bloc, le libellé de chaque champ, le libellé de chaque choix d'un
 * menu, et l'**aide** qui dit à quoi le réglage sert. Tout cela passe par
 * `t()` depuis une fabrique (voir CLAUDE.md), et rien à la compilation ne dit
 * ce qui en sort réellement.
 *
 * Trois façons de se tromper, aucune ne casse quoi que ce soit :
 *
 *   - une clé de traduction absente ne lève pas : `t()` rend la clé, et
 *     l'administrateur lit « modules.levels.ui.g0.champs.xpMin.label » sous un
 *     champ. `npm run i18n:check` attrape la clé littérale manquante d'une
 *     langue de référence ; ce script attrape ce qui en reste à l'écran,
 *     y compris pour une clé absente des DEUX langues ;
 *   - une traduction qui change la FORME plutôt que le texte — la clé d'un
 *     champ, son type, la valeur d'un choix sont lues par le code : traduites,
 *     elles écriraient dans une autre case ou enregistreraient un mot que le
 *     module ne reconnaît pas ;
 *   - un champ SANS aide. Il ne casse rien non plus : il se règle simplement au
 *     juger, et le dashboard est le seul endroit où l'admin pourrait apprendre
 *     ce qu'il fait.
 *
 * Les 222 champs du dépôt sont documentés : un champ sans aide est donc une
 * FAUTE, sans liste d'attente ni période de grâce. C'est ce qui empêche le
 * prochain champ ajouté de repartir muet — le moment où on écrit un champ est
 * le seul où l'on sait encore à quoi il sert.
 */
import { DEFAULT_LOCALE, listLocales, runWithLocale } from '../src/core/i18n.js';
import { loadModules } from '../src/core/loader.js';
import { moduleActions, moduleConfigUI } from '../src/core/module.js';
import type { BotModule, ConfigField, ConfigGroup, ModuleAction } from '../src/core/module.js';

/**
 * Les champs qui ont le DROIT de n'avoir aucune aide.
 *
 * Elle est vide, et doit le rester : les 222 champs du dépôt sont documentés.
 * Elle existe pour qu'un cas vraiment indéfendable puisse être écrit noir sur
 * blanc, avec son motif, plutôt que de rouvrir la porte à tous les autres.
 * Clé : `<module>/<bloc>/<champ>`.
 */
const AIDES_TOLEREES = new Set<string>([]);

/**
 * À quoi reconnaît-on une clé de traduction restée à l'écran ?
 *
 * `t()` rend la clé elle-même quand elle manque partout, et une clé ressemble à
 * `modules.levels.ui.g0.champs.xpMin.label` : que des identifiants, au moins
 * trois, séparés par des points, sans espace. Aucun libellé écrit pour un
 * humain ne prend cette forme.
 */
const CLE_NUE = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){2,}$/;

const erreurs: string[] = [];
/** Modules identiques au français dans une autre langue : repli, pas une faute. */
const nonTraduits: string[] = [];

function faute(locale: string, message: string): void {
  erreurs.push(`[${locale}] ${message}`);
}

/** Un texte servi au dashboard : non vide, et pas une clé affichée telle quelle. */
function verifieTexte(valeur: string | undefined, ou: string, locale: string): void {
  if (valeur === undefined) return;
  if (valeur.trim().length === 0) {
    faute(locale, `${ou} : vide`);
    return;
  }
  if (CLE_NUE.test(valeur)) {
    faute(locale, `${ou} : clé de traduction affichée telle quelle (« ${valeur} »)`);
  }
}

function verifieChamp(champ: ConfigField, ou: string, locale: string): void {
  if (champ.label.trim().length === 0) faute(locale, `${ou} · libellé : vide`);
  verifieTexte(champ.label, `${ou} · libellé`, locale);
  verifieTexte(champ.help, `${ou} · aide`, locale);
  verifieTexte(champ.placeholder, `${ou} · exemple`, locale);
  verifieTexte(champ.addLabel, `${ou} · bouton d'ajout`, locale);
  for (const choix of champ.options ?? []) {
    verifieTexte(choix.label, `${ou} · choix « ${choix.value} »`, locale);
  }
  // Les sous-champs d'une ligne de liste : un libellé suffit, « Rôle » n'a rien
  // à expliquer que son libellé ne dise déjà.
  for (const sous of champ.item ?? []) verifieChamp(sous, `${ou} / ${sous.key}`, locale);
}

function verifieBloc(groupe: ConfigGroup, ou: string, locale: string): void {
  verifieTexte(groupe.label, `${ou} · titre`, locale);
  verifieTexte(groupe.description, `${ou} · description`, locale);
  for (const champ of groupe.fields) verifieChamp(champ, `${ou} / ${champ.key}`, locale);
}

/**
 * La forme d'un bloc, réduite à ce que le CODE lit : clés, types, valeurs de
 * choix, identifiants de ligne, valeurs par défaut. C'est cela qui doit être
 * identique d'une langue à l'autre ; le reste est du texte, et le texte a le
 * droit de changer.
 */
function forme(champ: ConfigField): unknown {
  return {
    key: champ.key,
    type: champ.type,
    idKey: champ.idKey ?? null,
    default: champ.default ?? null,
    options: (champ.options ?? []).map((choix) => choix.value),
    item: (champ.item ?? []).map(forme),
  };
}

function formeBloc(groupe: ConfigGroup): unknown {
  return { key: groupe.key ?? null, fields: groupe.fields.map(forme) };
}

const registry = await loadModules();
const langues = listLocales();
const modules = (registry.modules as BotModule[]).filter((module) => !module.internal);

for (const module of modules) {
  // Un tableau posé tel quel fige ses `t()` au chargement : le dashboard part
  // en français quelle que soit la langue demandée, sans que rien ne le dise.
  if (module.configUI !== undefined && typeof module.configUI !== 'function') {
    erreurs.push(`${module.name} : « configUI » est un tableau, pas une fabrique`);
    continue;
  }
  if (module.actions !== undefined && typeof module.actions !== 'function') {
    erreurs.push(`${module.name} : « actions » est un tableau, pas une fabrique`);
    continue;
  }

  const blocsFr = runWithLocale(DEFAULT_LOCALE, () => moduleConfigUI(module));
  const boutonsFr = runWithLocale(DEFAULT_LOCALE, () => moduleActions(module));

  for (const info of langues) {
    let blocs: ConfigGroup[];
    let boutons: ModuleAction[];
    try {
      blocs = runWithLocale(info.code, () => moduleConfigUI(module));
      boutons = runWithLocale(info.code, () => moduleActions(module));
    } catch (error) {
      faute(info.code, `${module.name} : construction impossible — ${String(error)}`);
      continue;
    }

    for (const [rang, groupe] of blocs.entries()) {
      verifieBloc(groupe, `${module.name} · bloc ${groupe.key ?? `g${rang}`}`, info.code);
    }
    for (const bouton of boutons) {
      const ou = `${module.name} · bouton ${bouton.id}`;
      verifieTexte(bouton.label, `${ou} · libellé`, info.code);
      verifieTexte(bouton.help, `${ou} · aide`, info.code);
      verifieTexte(bouton.confirm, `${ou} · confirmation`, info.code);
      for (const champ of bouton.fields ?? [])
        verifieChamp(champ, `${ou} / ${champ.key}`, info.code);
    }

    if (info.code === DEFAULT_LOCALE) continue;

    if (JSON.stringify(blocs.map(formeBloc)) !== JSON.stringify(blocsFr.map(formeBloc))) {
      faute(info.code, `${module.name} : la traduction change la FORME des réglages`);
    }
    if (boutons.map((b) => b.id).join(',') !== boutonsFr.map((b) => b.id).join(',')) {
      faute(info.code, `${module.name} : la traduction change les boutons`);
    }
    if (blocsFr.length > 0 && JSON.stringify(blocs) === JSON.stringify(blocsFr)) {
      nonTraduits.push(`[${info.code}] ${module.name}`);
    }
  }

  // Ce que l'admin peut apprendre d'un réglage. Seuls les champs de premier
  // niveau sont comptés : dans une ligne de liste, le libellé suffit.
  const nus = blocsFr.flatMap((groupe, rang) =>
    groupe.fields
      .filter((champ) => (champ.help ?? '').trim().length === 0)
      .map((champ) => `${groupe.key ?? `g${rang}`}/${champ.key}`),
  );
  const fautifs = nus.filter((champ) => !AIDES_TOLEREES.has(`${module.name}/${champ}`));
  if (fautifs.length > 0) {
    erreurs.push(`${module.name} : ${fautifs.length} champ(s) sans aide — ${fautifs.join(', ')}`);
  }
}

// Une fabrique doit être rejouable : appelée deux fois dans la même langue,
// elle rend la même chose. Sinon le formulaire change à chaque rechargement.
for (const module of modules) {
  if (typeof module.configUI !== 'function') continue;
  const une = JSON.stringify(runWithLocale(DEFAULT_LOCALE, () => moduleConfigUI(module)));
  const deux = JSON.stringify(runWithLocale(DEFAULT_LOCALE, () => moduleConfigUI(module)));
  if (une !== deux) erreurs.push(`${module.name} : la fabrique de réglages n'est pas rejouable`);
}

// Comptés sur le terrain plutôt que déduits du reste à faire : un module
// déclaré documenté mais incomplet est une FAUTE, pas un champ documenté, et
// le résumé ne doit pas l'annoncer comme tel.
let champsTotal = 0;
let champsAides = 0;
for (const module of modules) {
  for (const groupe of runWithLocale(DEFAULT_LOCALE, () => moduleConfigUI(module))) {
    for (const champ of groupe.fields) {
      champsTotal += 1;
      if ((champ.help ?? '').trim().length > 0) champsAides += 1;
    }
  }
}

console.log(
  `Réglages : ${modules.length} module(s), ${champsTotal} champ(s) · langues : ${langues
    .map((l) => l.code)
    .join(', ')}`,
);
console.log(`Documentés : ${champsAides}/${champsTotal} champ(s)`);
if (nonTraduits.length > 0) {
  // Pas une faute : `t()` retombe sur le français, le formulaire reste lisible.
  console.log(`Non traduits (repli sur le français) : ${nonTraduits.join(', ')}`);
}
if (erreurs.length > 0) {
  console.error(`\n❌ ${erreurs.length} problème(s) :\n- ${erreurs.join('\n- ')}`);
  process.exit(1);
}
console.log('✅ Réglages complets et traduisibles dans toutes les langues.');
