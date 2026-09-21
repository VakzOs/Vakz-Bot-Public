import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../core/env.js';
import { moduleVisual, type CategoryId } from '../../core/module-catalog.js';
import type { BotContext, BotModule } from '../../core/module.js';

/**
 * Publication vers le miroir public — la moitié « bot » de `sync-public.sh`.
 *
 * Le script publie l'état courant du dépôt privé en un commit snapshot, en
 * sautant les chemins listés dans `EXCLUDES`. Cette liste vivait dans une
 * variable d'environnement : intenable dès qu'on ajoute régulièrement des
 * modules à ne pas partager. Elle vit désormais en base, éditable depuis le
 * dashboard, et le bot se contente d'écrire une demande que l'hôte exécute —
 * exactement la mécanique de `/maj` (voir `service.ts`), pour la même raison :
 * le bot est dans un conteneur, il ne pousse pas sur GitHub.
 */

/**
 * Les deux dépôts publiables. Le bot et le dashboard sont deux dépôts séparés,
 * avec deux miroirs : une fonctionnalité retirée du bot dont la page reste sur
 * le site donne un écran qui ne peut pas fonctionner. Les deux vont ensemble.
 */
export const SYNC_TARGETS = ['bot', 'site'] as const;
export type SyncTarget = (typeof SYNC_TARGETS)[number];

export function toSyncTarget(value: unknown): SyncTarget {
  return value === 'site' ? 'site' : 'bot';
}

/** Fonctionnalités (noms de modules) à ne publier NULLE PART, en JSON. */
const FEATURES_KEY = 'syncPublic.features';

/**
 * Chemins libres par dépôt — ce qui n'appartient à aucune fonctionnalité.
 *
 * La clé du bot est l'ancienne : une instance déjà réglée garde sa liste, et
 * ce qu'elle contenait de dossiers de modules devient une fonctionnalité
 * cochée à la première lecture (voir `getFeatures`).
 */
const EXTRAS_KEYS: Record<SyncTarget, string> = {
  bot: 'syncPublic.excludes',
  site: 'syncPublic.extras.site',
};

/** Demande de publication, surveillée par l'hôte (unit systemd `.path`). */
export const SYNC_REQUEST_FILE = join(env.DEPLOY_DIR, 'sync.request');
/** État courant de la publication, écrit par l'hôte. */
export const SYNC_STATUS_FILE = join(env.DEPLOY_DIR, 'sync.status');
/** Résultat de la dernière publication, écrit par l'hôte. */
export const SYNC_RESULT_FILE = join(env.DEPLOY_DIR, 'sync.result');
/**
 * Socle d'exclusions rapporté par l'hôte (`ALWAYS_EXCLUDES` de
 * `sync-public.sh`). Le bot ne peut pas le deviner : ce réglage vit sur
 * l'hôte, et le recopier ici créerait une seconde vérité qui dériverait.
 */
export const SYNC_BASELINE_FILE = join(env.DEPLOY_DIR, 'sync.baseline');
/** Journal alimenté PENDANT la publication ; absent = rien en cours. */
export const SYNC_LOG_FILE = join(env.DEPLOY_DIR, '.sync.log.tmp');

/**
 * Plafonds de la liste. Rien de sacré, mais une liste sans bornes finit en
 * charge utile de plusieurs kilo-octets recopiée dans chaque demande.
 */
const MAX_PATTERNS = 200;
const MAX_PATTERN_LENGTH = 200;

/**
 * Un motif d'exclusion finit en `rsync --exclude=<motif>` sur l'hôte, dans un
 * script qui tourne en root. On le traite donc comme le champ `branch` de
 * `/maj` : jamais de confiance, et la même parade — pas de tiret initial, qui
 * ferait lire le motif comme une OPTION et non comme une valeur.
 *
 * Refusés aussi : les chemins absolus et les `..`, qui feraient sortir
 * l'exclusion de l'arborescence copiée, et `.git`, que le script exclut déjà
 * et dont la présence ici ne pourrait que semer le doute.
 */
export function isValidExcludePattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return false;
  if (pattern.startsWith('-')) return false;
  if (pattern.startsWith('/')) return false;
  if (pattern.split('/').includes('..')) return false;
  if (pattern === '.git' || pattern.startsWith('.git/')) return false;
  // Jeu de caractères strict : de quoi désigner un fichier, un dossier ou un
  // motif simple, et rien qui ressemble à de la syntaxe de shell.
  //
  // `*` et `?` restent des JOKERS (`docs/*.md`), mais les crochets sont pris au
  // pied de la lettre : les routes Next.js du dashboard en sont pleines
  // (`app/dashboard/[guildId]/…`), et pour rsync `[guildId]` serait une classe
  // de caractères qui ne correspondrait jamais au dossier réel. L'hôte n'échappe
  // donc QUE les crochets (voir `escape_pattern` dans `sync-public.sh`).
  return /^[A-Za-z0-9._*?[\]/-]+$/.test(pattern);
}

/** Lit un tableau de chaînes stocké en JSON. Tout le reste vaut liste vide. */
async function readStringList(ctx: BotContext, key: string): Promise<string[]> {
  const row = await ctx.db.appSetting.findUnique({ where: { key } });
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

async function writeStringList(ctx: BotContext, key: string, values: string[]): Promise<void> {
  const value = JSON.stringify(values);
  await ctx.db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/**
 * Les fonctionnalités exclues, par nom de module.
 *
 * Reprise de l'ancienne liste de chemins : une instance réglée avant
 * l'existence des fonctionnalités y a des `src/modules/<nom>`, qui doivent
 * ressortir ici comme des cases cochées — sinon l'écran montrerait une case
 * vide pour quelque chose qui est bel et bien exclu.
 */
export async function getFeatures(ctx: BotContext, modules: BotModule[]): Promise<string[]> {
  const stored = await readStringList(ctx, FEATURES_KEY);
  const known = new Set(modules.filter((m) => !m.internal).map((m) => m.name));
  if (stored.length > 0) return stored.filter((name) => known.has(name)).sort();

  const legacy = await readStringList(ctx, EXTRAS_KEYS.bot);
  const byPath = new Map([...known].map((name) => [modulePath(name), name]));
  return legacy
    .map((path) => byPath.get(path))
    .filter((name): name is string => Boolean(name))
    .sort();
}

/** Enregistre les fonctionnalités exclues. Les inconnues sont écartées. */
export async function setFeatures(
  ctx: BotContext,
  modules: BotModule[],
  names: string[],
): Promise<string[]> {
  const known = new Set(modules.filter((m) => !m.internal).map((m) => m.name));
  const kept = [...new Set(names.filter((name) => known.has(name)))].sort();
  await writeStringList(ctx, FEATURES_KEY, kept);
  return kept;
}

/**
 * Les chemins libres d'un dépôt : ce qui n'appartient à aucune fonctionnalité.
 *
 * On filtre à la LECTURE aussi : la valeur vient de la base, qu'une version
 * antérieure — ou une main humaine — a pu remplir autrement. Un motif douteux
 * ne doit pas atteindre l'hôte parce qu'il a été écrit avant ce contrôle.
 */
export async function getExtras(
  ctx: BotContext,
  target: SyncTarget,
  modules: BotModule[],
): Promise<string[]> {
  const stored = normalize(await readStringList(ctx, EXTRAS_KEYS[target]));
  if (target !== 'bot') return stored;
  // Côté bot, l'ancienne clé mélangeait dossiers de modules et chemins libres.
  // Les premiers sont devenus des fonctionnalités : les laisser ici les
  // exclurait deux fois, et surtout les rendrait impossibles à décocher.
  const modulePaths = new Set(modules.filter((m) => !m.internal).map((m) => modulePath(m.name)));
  return stored.filter((path) => !modulePaths.has(path));
}

/** Enregistre les chemins libres d'un dépôt et renvoie ce qui a été retenu. */
export async function setExtras(
  ctx: BotContext,
  target: SyncTarget,
  patterns: string[],
): Promise<string[]> {
  const kept = normalize(patterns);
  await writeStringList(ctx, EXTRAS_KEYS[target], kept);
  return kept;
}

/** Valide, déduplique et ordonne — pour que deux listes égales se ressemblent. */
function normalize(patterns: string[]): string[] {
  const kept = new Set<string>();
  for (const raw of patterns) {
    const pattern = raw.trim().replace(/\/+$/, '');
    if (isValidExcludePattern(pattern)) kept.add(pattern);
    if (kept.size >= MAX_PATTERNS) break;
  }
  return [...kept].sort();
}

/** Le chemin du dossier d'un module dans le dépôt, tel qu'on l'exclurait. */
export function modulePath(name: string): string {
  return `src/modules/${name}`;
}

export interface PublishableModule {
  name: string;
  category: CategoryId;
  emoji: string;
  /** La fonctionnalité est-elle exclue des DEUX miroirs ? */
  excluded: boolean;
  /**
   * Chemins du dépôt du BOT qu'occupe cette fonctionnalité — déduits du code,
   * jamais tenus à la main : dossier du module, fichiers qui l'importent de
   * l'extérieur, schéma et migrations Prisma à son nom.
   */
  botPaths: string[];
  /**
   * Chemins du dépôt du SITE — déclarés par le module (`webPaths`).
   *
   * Ceux-là ne se déduisent pas : le bot ne lit pas le dépôt du dashboard. Une
   * page laissée sur le site public alors que le module n'est plus dans le bot
   * donne un écran qui ne peut pas fonctionner, d'où l'intérêt de les nommer.
   */
  webPaths: string[];
  /**
   * Le cœur importe-t-il ce module en dur ? Si oui, l'exclure casse la
   * compilation du dépôt public — tant que le couplage n'est pas défait.
   */
  coreBound: boolean;
  /** Modules qui importent celui-ci : ils devraient partir avec lui. */
  requiredBy: string[];
}

/** La racine du dépôt : `src/` et `dist/` sont tous deux à un cran dessous. */
function repoRoot(): string {
  return join(sourceRoot(), '..');
}

/**
 * Les fichiers Prisma d'un module : `prisma/schema/<nom>.prisma` et les
 * migrations dont le nom, après l'horodatage, est le sien.
 *
 * On lit l'arborescence plutôt que de deviner : une migration absente du
 * disque n'a pas à figurer dans une liste d'exclusions, et une liste écrite à
 * la main serait fausse à la migration suivante.
 */
async function prismaPathsFor(name: string): Promise<string[]> {
  const found: string[] = [];
  const schema = join(repoRoot(), 'prisma', 'schema', `${name}.prisma`);
  if (await exists(schema)) found.push(`prisma/schema/${name}.prisma`);

  // `<horodatage>_<nom>` ou `<horodatage>_<nom>_<suite>`, et rien d'autre :
  // sans cette borne, un module au nom court emporterait les migrations des
  // autres.
  const pattern = new RegExp(`^\\d+_${name}(_|$)`);
  try {
    // Les migrations vivent DANS le dossier de schéma : c'est là que Prisma
    // les cherche quand le schéma est un dossier (voir `prisma/schema/`).
    const entries = await readdir(join(repoRoot(), 'prisma', 'schema', 'migrations'), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory() && pattern.test(entry.name)) {
        found.push(`prisma/schema/migrations/${entry.name}`);
      }
    }
  } catch {
    // Pas de dossier de migrations : rien à exclure.
  }
  return found.sort();
}

/**
 * Les fichiers de langue d'un module : `locales/<langue>/<nom>.json`.
 *
 * Sans eux, exclure une fonctionnalité laisserait tout son texte utilisateur
 * dans le miroir public — pour un jeu, c'est plus parlant que son schéma.
 */
/**
 * La fiche d'un module : `docs/modules/<nom>.md`.
 *
 * Le README ne peut pas perdre une ligne à la publication — on ne retire pas un
 * morceau de fichier. Un module dont le mode d'emploi resterait en ligne ne
 * serait caché qu'à moitié : le texte en dit souvent plus que le code.
 *
 * Chemin rendu SANS vérifier qu'il existe, contrairement au schéma et aux
 * locales. Le bot tourne dans une image qui ne contient QUE ce dont il a besoin
 * à l'exécution : `prisma/` et `locales/` y sont, `docs/` n'y est pas. Le test
 * d'existence répondait donc toujours « non » en production, et la fiche était
 * publiée alors que le module ne l'était pas — silencieusement, puisqu'une
 * exclusion en moins ne se voit pas.
 *
 * Exclure un chemin absent ne coûte rien : rsync ignore un motif qui ne
 * correspond à aucun fichier.
 */
function docPathFor(name: string): string[] {
  return [`docs/modules/${name}.md`];
}

async function localePathsFor(name: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const locales = await readdir(join(repoRoot(), 'locales'), { withFileTypes: true });
    for (const entry of locales) {
      if (!entry.isDirectory()) continue;
      if (await exists(join(repoRoot(), 'locales', entry.name, `${name}.json`))) {
        found.push(`locales/${entry.name}/${name}.json`);
      }
    }
  } catch {
    // Pas de dossier par langue : disposition d'un seul fichier, rien à retirer.
  }
  return found.sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * L'inventaire que le dashboard affiche : une fonctionnalité par ligne, avec
 * ce qu'elle occupe dans chacun des deux dépôts et ce qu'une exclusion
 * coûterait.
 *
 * Le vrai filet reste la construction du snapshot avant publication, côté
 * hôte : elle, elle ne se trompe pas. Mais découvrir qu'une case à cocher
 * casse le dépôt public APRÈS avoir cliqué, c'est une mauvaise interface.
 */
export async function listPublishableModules(
  ctx: BotContext,
  modules: BotModule[],
): Promise<PublishableModule[]> {
  const features = new Set(await getFeatures(ctx, modules));
  const usage = await moduleUsage();
  const listed = modules.filter((m) => !m.internal);
  const rows = await Promise.all(
    listed.map(async (m) => {
      const visual = moduleVisual(m);
      const botPaths = [
        modulePath(m.name),
        ...(usage.files.get(m.name) ?? []),
        ...(await prismaPathsFor(m.name)),
        ...(await localePathsFor(m.name)),
        ...docPathFor(m.name),
      ];
      return {
        name: m.name,
        category: visual.category,
        emoji: visual.emoji,
        excluded: features.has(m.name),
        botPaths: [...new Set(botPaths)].filter(isValidExcludePattern).sort(),
        webPaths: [...new Set(m.webPaths ?? [])].filter(isValidExcludePattern).sort(),
        coreBound: usage.core.has(m.name),
        requiredBy: [...(usage.modules.get(m.name) ?? [])].sort(),
      };
    }),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * La liste d'exclusions effective d'un dépôt : les chemins des fonctionnalités
 * cochées, plus les chemins libres de ce dépôt.
 *
 * Calculée ici et pas dans le navigateur : c'est elle qui part à l'hôte, et le
 * dashboard demande « publie », il ne dicte pas ce qu'on retire.
 */
export async function resolveExcludes(
  ctx: BotContext,
  modules: BotModule[],
  target: SyncTarget,
): Promise<string[]> {
  const rows = await listPublishableModules(ctx, modules);
  const fromFeatures = rows
    .filter((row) => row.excluded)
    .flatMap((row) => (target === 'bot' ? row.botPaths : row.webPaths));
  const extras = await getExtras(ctx, target, modules);
  return [...new Set([...fromFeatures, ...extras])].sort();
}

/** Le dossier du code, qu'on tourne en TypeScript (`src/`) ou compilé (`dist/`). */
function sourceRoot(): string {
  // src/modules/deploy/sync.ts -> src   ||   dist/modules/deploy/sync.js -> dist
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

async function readCodeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await readCodeFiles(full)));
    else if (/\.(ts|js|mts|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Qui importe quels modules, dans tout `src/`.
 *
 * On lit le code plutôt que d'entretenir une liste : une liste écrite à la
 * main serait fausse au premier `import` ajouté, et se tromper ici revient à
 * promettre qu'une exclusion est sans risque alors qu'elle casse le build.
 *
 * Trois provenances, parce qu'elles ne se corrigent pas de la même façon :
 *   - `core`    : le cœur nomme le module en dur — il faut défaire le
 *                 couplage (`httpRoutes`, `isAvailable`) avant de l'exclure ;
 *   - `modules` : un autre module l'importe — il part avec lui, et le
 *                 dashboard coche les deux ;
 *   - `files`   : un fichier hors `src/modules/` (un script) l'importe — il
 *                 s'ajoute à la main aux chemins exclus, et rien ne le
 *                 rappellerait sans cette liste.
 */
async function moduleUsage(): Promise<{
  core: Set<string>;
  modules: Map<string, Set<string>>;
  files: Map<string, Set<string>>;
}> {
  const root = sourceRoot();
  const modulesDir = join(root, 'modules');
  const usage = {
    core: new Set<string>(),
    modules: new Map<string, Set<string>>(),
    files: new Map<string, Set<string>>(),
  };

  const add = (map: Map<string, Set<string>>, target: string, importer: string): void => {
    const set = map.get(target) ?? new Set<string>();
    set.add(importer);
    map.set(target, set);
  };

  for (const file of await readCodeFiles(root)) {
    const code = await readFile(file, 'utf8').catch(() => '');
    // `../modules/<nom>/` depuis le cœur ou un script, `../<nom>/` entre
    // modules voisins : les deux formes désignent un module.
    const targets = new Set<string>();
    for (const match of code.matchAll(/from '(?:\.\.\/)+modules\/([a-z0-9-]+)\//g)) {
      if (match[1]) targets.add(match[1]);
    }

    const inModules = file.startsWith(modulesDir + '/');
    const owner = inModules ? file.slice(modulesDir.length + 1).split('/')[0] : undefined;

    if (inModules && owner) {
      for (const match of code.matchAll(/from '\.\.\/([a-z0-9-]+)\//g)) {
        if (match[1]) targets.add(match[1]);
      }
    }

    for (const target of targets) {
      if (target === owner) continue;
      if (owner) add(usage.modules, target, owner);
      else if (file.startsWith(join(root, 'core') + '/')) usage.core.add(target);
      // Le chemin tel qu'on l'écrirait dans la liste d'exclusion : relatif au
      // dépôt, et en `.ts` même quand on lit le `dist/` compilé.
      else add(usage.files, target, 'src/' + file.slice(root.length + 1).replace(/\.js$/, '.ts'));
    }
  }

  return usage;
}

/** Longueur d'un sujet de commit git au-delà de laquelle on tronque. */
const MAX_MESSAGE_LENGTH = 200;

/**
 * Nettoie le message de commit saisi au dashboard.
 *
 * Il finit en `git commit -m` dans un script qui tourne en root. Il y arrive
 * par une variable d'environnement citée, donc rien à injecter — mais on le
 * ramène quand même à ce qu'un sujet de commit doit être : une ligne, sans
 * caractères de contrôle, de longueur raisonnable. Vide = le message
 * automatique, qui reste le défaut.
 */
export function cleanCommitMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Caractère par caractère plutôt qu'une expression régulière : `no-control-regex`
  // interdit celles-ci à raison, et l'exception au linter s'était déjà décalée
  // d'une ligne au premier reformatage — une règle désactivée qui ne protège
  // plus rien est pire que pas de règle du tout.
  const cleaned = [...value]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? ' ' : char;
    })
    .join('');
  return cleaned.trim().slice(0, MAX_MESSAGE_LENGTH);
}

export interface SyncRequestOptions {
  /** Préparer le commit sans pousser : la répétition générale. */
  dryRun: boolean;
  /** Le dépôt visé : celui du bot ou celui du dashboard. */
  target: SyncTarget;
  /** Sujet du commit publié. Vide = le message automatique du script. */
  message?: string;
}

/**
 * Écrit la demande de publication ; l'hôte prend le relais.
 *
 * Les exclusions sont relues EN BASE et jointes ici, jamais reprises du corps
 * de la requête HTTP : le dashboard demande « publie », il ne dicte pas ce
 * qu'on retire. Un appel direct à l'API ne peut donc pas publier une liste
 * choisie par son auteur — et l'hôte revalide de toute façon.
 */
export async function requestSync(
  ctx: BotContext,
  modules: BotModule[],
  userId: string,
  options: SyncRequestOptions,
): Promise<string> {
  const excludes = await resolveExcludes(ctx, modules, options.target);
  const requestedAt = new Date().toISOString();
  await mkdir(dirname(SYNC_REQUEST_FILE), { recursive: true });
  const message = cleanCommitMessage(options.message);
  const payload = JSON.stringify({
    requestedBy: userId,
    requestedAt,
    dryRun: options.dryRun,
    target: options.target,
    excludes,
    ...(message ? { message } : {}),
  });
  await writeStatus({
    phase: 'requested',
    state: 'pending',
    message: options.dryRun
      ? `Répétition générale (${options.target}) demandée, attente de l hôte.`
      : `Publication (${options.target}) demandée, attente de l hôte.`,
    dryRun: options.dryRun,
    target: options.target,
    requestedBy: userId,
    requestedAt,
  }).catch(() => undefined);
  await writeFile(SYNC_REQUEST_FILE, payload + '\n', 'utf8');
  return requestedAt;
}

export interface SyncStatus {
  phase?: string;
  state?: string;
  message?: string;
  dryRun?: boolean;
  /** Le dépôt visé. Absent d'un hôte antérieur : on suppose alors le bot. */
  target?: string;
  updatedAt?: string;
  requestedBy?: string;
  requestedAt?: string;
}

export interface SyncResult {
  status: 'success' | 'failure' | 'nothing_to_do' | string;
  finishedAt?: string;
  dryRun?: boolean;
  /** Le dépôt visé. Absent d'un hôte antérieur : on suppose alors le bot. */
  target?: string;
  commit?: string;
  /** Résumé `git show --stat` de ce qui a été publié. */
  stat?: string;
  log?: string;
}

async function writeStatus(status: SyncStatus): Promise<void> {
  await writeFile(
    SYNC_STATUS_FILE,
    JSON.stringify({ ...status, updatedAt: status.updatedAt ?? new Date().toISOString() }) + '\n',
    'utf8',
  );
}

export async function readSyncStatus(): Promise<SyncStatus | null> {
  return readJsonFile<SyncStatus>(SYNC_STATUS_FILE);
}

export async function readSyncResult(): Promise<SyncResult | null> {
  return readJsonFile<SyncResult>(SYNC_RESULT_FILE);
}

/** Une publication attend-elle déjà d'être prise en charge ? */
export async function hasPendingSync(): Promise<boolean> {
  try {
    await readFile(SYNC_REQUEST_FILE, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Fin du journal de la publication en cours. Comme pour `/maj` : le résultat
 * n'arrive qu'à la fin, et une construction complète du projet est longue.
 */
export async function readSyncLog(maxChars = 8000): Promise<string | null> {
  try {
    const raw = await readFile(SYNC_LOG_FILE, 'utf8');
    const log = raw.slice(-maxChars);
    return log.trim() ? log : null;
  } catch {
    return null;
  }
}

/**
 * Le socle, tel que l'hôte l'a rapporté à sa dernière exécution.
 *
 * `null` tant qu'aucune publication n'a eu lieu — mieux vaut ne rien afficher
 * qu'afficher une valeur devinée, qui serait fausse dès que quelqu'un règle
 * `ALWAYS_EXCLUDES` dans l'unit systemd.
 */
export async function readSyncBaseline(): Promise<string[] | null> {
  try {
    const raw = await readFile(SYNC_BASELINE_FILE, 'utf8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
