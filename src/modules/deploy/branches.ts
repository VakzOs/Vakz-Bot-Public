import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { env } from '../../core/env.js';
import { REQUEST_FILE } from './service.js';

/**
 * Les branches proposées par `/maj` et par le dashboard.
 *
 * Elles venaient de `DEPLOY_BRANCHES` (`.env`) : ajouter une branche demandait
 * d'éditer le fichier ET de redémarrer le conteneur, pour une liste qui change
 * à chaque branche de travail. On les **récupère** désormais sur le dépôt.
 *
 * C'est l'updater hôte qui les lit (`git ls-remote`) et les dépose dans le
 * dossier partagé : le conteneur du bot n'a ni le dépôt ni les identifiants
 * git, et lui confier un jeton d'accès au dépôt pour cette seule liste serait
 * un secret de plus à garder. Le bot lui demande de rafraîchir en écrivant une
 * demande dans le même fichier que `/maj` — l'unité systemd qui le surveille
 * est déjà installée, il n'y a donc rien à reconfigurer sur l'hôte.
 *
 * `DEPLOY_BRANCHES` ne sert plus que de **repli** tant que rien n'a été
 * récupéré (updater pas encore à jour, hôte injoignable).
 */

/** Fichier écrit par l'updater hôte : les branches vues sur le dépôt distant. */
export const DISCOVERED_FILE = join(env.DEPLOY_DIR, 'deploy.branches');

/** Au-delà, ce n'est plus une liste mais un dépôt entier. */
export const MAX_BRANCHES = 50;

/**
 * Un nom de branche sûr à transmettre à l'updater.
 *
 * Mêmes règles que `validate_branch` côté updater — jeu de caractères strict et
 * pas de tiret initial (une valeur comme `--upload-pack=…` serait lue par git
 * comme une OPTION, vecteur d'exécution de commande connu) — plus l'essentiel
 * de `git check-ref-format`, qu'on ne peut pas appeler faute de git dans
 * l'image.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false;
  if (name.startsWith('-')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return false;
  if (name.includes('..') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return !name.split('/').some((part) => part === '' || part.startsWith('.'));
}

/** Branches déclarées dans `DEPLOY_BRANCHES` (repli sans récupération). */
export function envBranches(): string[] {
  const branches = env.DEPLOY_BRANCHES.split(',')
    .map((branch) => branch.trim())
    .filter(isValidBranchName);
  return branches.length > 0 ? branches : ['main'];
}

/** Nettoie une liste saisie : coupe, écarte l'invalide, déduplique, borne. */
export function sanitizeBranches(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const branches: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const branch = raw.trim();
    if (!isValidBranchName(branch) || seen.has(branch)) continue;
    seen.add(branch);
    branches.push(branch);
    if (branches.length >= MAX_BRANCHES) break;
  }
  return branches;
}

/**
 * Branches découvertes par l'updater hôte.
 *
 * Le fichier n'existe pas tant qu'aucune mise à jour n'a tourné depuis
 * l'installation de l'updater qui l'écrit : absence = pas de découverte, pas
 * une erreur.
 */
export async function discoveredBranches(): Promise<string[]> {
  const raw = await readFile(DISCOVERED_FILE, 'utf8').catch(() => null);
  if (!raw) return [];
  try {
    return sanitizeBranches(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** `main` d'abord, puis par ordre alphabétique : la branche par défaut en tête. */
function order(branches: string[]): string[] {
  return [...branches].sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return a.localeCompare(b, 'en');
  });
}

/**
 * Les branches proposées : celles récupérées sur le dépôt, à défaut celles de
 * `DEPLOY_BRANCHES`. On ne mélange pas les deux : une fois la récupération en
 * place, une valeur oubliée dans le `.env` n'a plus à polluer la liste.
 */
export async function listDeployBranches(): Promise<string[]> {
  const discovered = await discoveredBranches();
  const branches = discovered.length > 0 ? discovered : envBranches();
  return order([...new Set(branches)]).slice(0, MAX_BRANCHES);
}

/** Date de la dernière récupération, pour le dire au dashboard. */
export async function branchesFetchedAt(): Promise<string | null> {
  const info = await stat(DISCOVERED_FILE).catch(() => null);
  return info ? info.mtime.toISOString() : null;
}

/** Combien de temps on attend la réponse de l'updater après une demande. */
const REFRESH_TIMEOUT_MS = 12_000;
const REFRESH_POLL_MS = 400;

/**
 * Demande à l'updater hôte de republier la liste, et attend le fichier.
 *
 * La demande passe par `deploy.request`, comme `/maj` : l'unité systemd qui
 * surveille ce fichier existe déjà. L'updater reconnaît `action: "branches"`,
 * publie la liste et s'arrête là — ni reconstruction, ni redémarrage, ni
 * écrasement du résultat du dernier déploiement.
 *
 * On attend en surveillant la date du fichier plutôt que son contenu : une
 * récupération qui ne trouve aucune branche nouvelle est un succès, pas un
 * silence. Sans updater à l'écoute, on rend la main au bout du délai et on
 * laisse la demande en place — elle sera prise au prochain démarrage.
 */
export async function refreshBranches(requestedBy: string): Promise<{
  ok: boolean;
  branches: string[];
  fetchedAt: string | null;
}> {
  const before = await branchesFetchedAt();
  await mkdir(dirname(REQUEST_FILE), { recursive: true });
  await writeFile(
    REQUEST_FILE,
    JSON.stringify({ action: 'branches', requestedBy, requestedAt: new Date().toISOString() }) +
      '\n',
    'utf8',
  );

  const deadline = Date.now() + REFRESH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(REFRESH_POLL_MS);
    const after = await branchesFetchedAt();
    if (after && after !== before) {
      return { ok: true, branches: await listDeployBranches(), fetchedAt: after };
    }
  }
  return { ok: false, branches: await listDeployBranches(), fetchedAt: before };
}
