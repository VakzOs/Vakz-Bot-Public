/**
 * Vérification de la configuration du linter (`npm run check:lint`).
 *
 * Le dépôt n'a pas de suite de tests, et `npm run lint` ne dit rien de plus que
 * « rien à signaler » — ce qui est exactement ce qu'il dirait si la moitié des
 * règles avaient cessé de s'appliquer. Ce script sème donc des violations
 * connues et exige qu'oxlint les retrouve, une par une.
 *
 * Il ne garde pas une lubie : oxlint IGNORE SILENCIEUSEMENT un nom de règle
 * qu'il ne connaît pas. Une faute de frappe dans `.oxlintrc.json`, un nom
 * renommé par une version, une option qui cesse d'être lue — rien de tout cela
 * ne fait échouer quoi que ce soit. Seul un cas qui devait être signalé et qui
 * ne l'est plus le montre.
 *
 * D'où aussi les cas TOLÉRÉS (`attendu: []`) : ils prouvent qu'une option est
 * réellement appliquée, et pas que le défaut du linter donne le même résultat
 * par hasard.
 *
 * Il ne touche à rien : tout vit dans un dossier temporaire, à une exception
 * près — l'exception `no-console` sous `scripts/` ne se vérifie que depuis un
 * chemin qui correspond au motif, donc depuis ce dossier-ci. Ce fichier-là est
 * retiré quoi qu'il arrive.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const oxlint = join(racine, 'node_modules', '.bin', 'oxlint');

interface Cas {
  /** Nom du fichier semé. */
  fichier: string;
  /** Le code qui doit (ou ne doit pas) déclencher quelque chose. */
  code: string;
  /** Règles attendues, sous la forme `plugin(regle)`. Vide = rien ne doit sortir. */
  attendu: string[];
  /** Ce que le cas éprouve, affiché tel quel. */
  quoi: string;
}

const CAS: Cas[] = [
  {
    fichier: 'any.ts',
    quoi: 'un `any` explicite est refusé',
    code: 'export function f(x: any): string {\n  return String(x);\n}\n',
    attendu: ['typescript(no-explicit-any)'],
  },
  {
    fichier: 'inutilisee.ts',
    quoi: 'une variable inutilisée est signalée',
    code: 'export function f(garde: number): number {\n  const inutile = 42;\n  return garde;\n}\n',
    attendu: ['eslint(no-unused-vars)'],
  },
  {
    fichier: 'souligne.ts',
    quoi: 'un paramètre préfixé `_` est TOLÉRÉ (preuve que argsIgnorePattern est lu)',
    code: 'export function f(garde: number, _ignore: number): number {\n  return garde;\n}\n',
    attendu: [],
  },
  {
    fichier: 'import-type.ts',
    quoi: 'un import servant uniquement de type doit être un import de type',
    code: "import { Buffer } from 'node:buffer';\n\nexport function taille(b: Buffer): number {\n  return b.length;\n}\n",
    attendu: ['typescript(consistent-type-imports)'],
  },
  {
    fichier: 'console.ts',
    quoi: '`console` est signalé hors de scripts/',
    code: 'export function t(): void {\n  console.log("x");\n}\n',
    attendu: ['eslint(no-console)'],
  },
  {
    fichier: 'egalite.ts',
    quoi: '`==` est refusé',
    code: 'export function eg(a: unknown, b: unknown): boolean {\n  return a == b;\n}\n',
    attendu: ['eslint(eqeqeq)'],
  },
  {
    fichier: 'affectation-morte.ts',
    quoi: 'une affectation jamais relue est signalée (elle a trouvé 3 vrais cas)',
    code: "export function choisir(): string {\n  let v = 'premier';\n  v = 'second';\n  return v;\n}\n",
    attendu: ['eslint(no-useless-assignment)'],
  },
  {
    fichier: 'as-const.ts',
    quoi: 'un littéral retypé passe par `as const`',
    code: "export let mode: 'strict' = 'strict';\n",
    attendu: ['eslint(prefer-const)', 'typescript(prefer-as-const)'],
  },
];

/** Lance oxlint et rend les règles déclenchées, par fichier. */
function analyser(chemin: string): Map<string, Set<string>> {
  let sortie: string;
  try {
    sortie = execFileSync(oxlint, ['-c', join(racine, '.oxlintrc.json'), chemin], {
      cwd: racine,
      encoding: 'utf8',
    });
  } catch (error) {
    // oxlint sort en erreur dès qu'il signale quelque chose : c'est le cas normal ici.
    sortie = String((error as { stdout?: string }).stdout ?? '');
  }
  const par = new Map<string, Set<string>>();
  for (const ligne of sortie.split('\n')) {
    const m = /^(?<f>[^:]+):\d+:\d+: \w+ (?<p>[a-z-]+)\((?<r>[^)]+)\)/u.exec(ligne);
    if (!m?.groups) continue;
    const nom = m.groups['f']!.split('/').pop()!;
    if (!par.has(nom)) par.set(nom, new Set());
    par.get(nom)!.add(`${m.groups['p']}(${m.groups['r']})`);
  }
  return par;
}

const dossier = mkdtempSync(join(tmpdir(), 'vakz-lint-check-'));
const sousScripts = join(racine, 'scripts', '.check-lint-console.ts');
let echecs = 0;

function verifier(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ✔ ${label}`);
  } else {
    echecs += 1;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  for (const cas of CAS) writeFileSync(join(dossier, cas.fichier), cas.code, 'utf8');
  const vus = analyser(dossier);

  console.log('Règles semées :');
  for (const cas of CAS) {
    const trouve = vus.get(cas.fichier) ?? new Set<string>();
    const manquantes = cas.attendu.filter((r) => !trouve.has(r));
    const enTrop = [...trouve].filter((r) => !cas.attendu.includes(r));
    verifier(
      cas.quoi,
      manquantes.length === 0 && enTrop.length === 0,
      [
        manquantes.length ? `jamais signalé : ${manquantes.join(', ')}` : '',
        enTrop.length ? `signalé en trop : ${enTrop.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' ; '),
    );
  }

  // L'exception de scripts/, depuis un chemin qui correspond au motif.
  mkdirSync(dirname(sousScripts), { recursive: true });
  writeFileSync(sousScripts, 'export function t(): void {\n  console.log("x");\n}\n', 'utf8');
  const sous = analyser(sousScripts).get('.check-lint-console.ts') ?? new Set<string>();
  verifier(
    '`console` est toléré sous scripts/ (exception appliquée)',
    !sous.has('eslint(no-console)'),
    'no-console a été signalé alors que scripts/ en est exempté',
  );
} finally {
  rmSync(dossier, { recursive: true, force: true });
  rmSync(sousScripts, { force: true });
}

if (echecs > 0) {
  console.log(`\n✘ ${echecs} règle(s) ne font plus ce qu'on attend d'elles.`);
  process.exit(1);
}
console.log("\n✅ Le linter attrape tout ce qu'on lui demande.");
