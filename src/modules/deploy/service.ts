import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MessageFlags, Routes } from 'discord.js';
import { env } from '../../core/env.js';
import type { BotContext } from '../../core/module.js';
import { notifyUptimeMaintenance } from '../../core/uptime.js';

/** Fichier de demande de mise a jour, surveille par l'updater hote. */
export const REQUEST_FILE = join(env.DEPLOY_DIR, 'deploy.request');
/** Fichier de resultat, ecrit par l'updater hote apres execution. */
export const RESULT_FILE = join(env.DEPLOY_DIR, 'deploy.result');
/** Etat courant de l'updater hote, affiche par /maj. */
export const STATUS_FILE = join(env.DEPLOY_DIR, 'deploy.status');
/** Interaction a notifier quand le bot revient apres une demande /maj. */
export const NOTIFY_FILE = join(env.DEPLOY_DIR, 'deploy.notify');
/**
 * Journal que l'updater hote alimente PENDANT la mise a jour.
 *
 * Le fichier de resultat n'arrive qu'a la fin : sans ce journal, une mise a
 * jour est une minute de silence, et un build qui echoue ne se lit qu'apres
 * coup. L'updater le supprime en terminant - son absence dit donc « rien en
 * cours ».
 */
export const LOG_FILE = join(env.DEPLOY_DIR, '.deploy.log.tmp');

const RESULT_WAIT_MS = 90_000;
const RESULT_POLL_MS = 3_000;
const REQUEST_PICKUP_WAIT_MS = 25_000;
const UPDATE_RESULT_WAIT_MS = 210_000;
const RESTART_GRACE_MS = 35_000;

/**
 * Mode de reconstruction demande a l updater hote.
 *
 * - `full` : `docker compose up -d --build --force-recreate` — tous les
 *   conteneurs du projet sont recrees, le bot redemarre a coup sur. C est le
 *   comportement historique de `/maj`, et celui applique quand le champ est
 *   absent (une demande ecrite par une ancienne version du bot, ou lue par un
 *   updater hote qui ignore encore ce champ).
 * - `cache` : `docker compose up -d --build bot` — Docker reutilise ses
 *   couches, seul le service `bot` est vise, et Compose ne recree le conteneur
 *   que si l image a vraiment change. Une mise a jour sans changement ne
 *   coupe donc pas le bot.
 *
 * Dans les deux cas le cache de couches Docker sert : la difference est le
 * `--force-recreate` (et le fait de ne pas rebalayer flaresolverr/lavalink).
 */
export type DeployMode = 'full' | 'cache';

/** Mode applique quand rien n est demande : l historique, sans surprise. */
export const DEFAULT_DEPLOY_MODE: DeployMode = 'full';

/** Filtre une valeur venue de l exterieur (bouton, API web) vers un mode sur. */
export function toDeployMode(value: unknown): DeployMode {
  return value === 'cache' ? 'cache' : DEFAULT_DEPLOY_MODE;
}

/** La commande `/maj` est-elle activee (un proprietaire est configure) ? */
export function deployEnabled(): boolean {
  return Boolean(env.BOT_OWNER_ID);
}

/** L'utilisateur est-il le proprietaire autorise ? */
export function isOwner(userId: string): boolean {
  return deployEnabled() && userId === env.BOT_OWNER_ID;
}

/** La mise a jour automatique nocturne est-elle activee (`FORCE_UPDATE`) ? */
export function autoUpdateEnabled(): boolean {
  return env.FORCE_UPDATE;
}

/** Branche recuperee par la mise a jour automatique (`FORCE_UPDATE_BRANCH`). */
export function autoUpdateBranch(): string {
  return env.FORCE_UPDATE_BRANCH.trim() || 'main';
}

/**
 * Une demande de mise a jour attend-elle deja d etre prise en charge ? Sert a
 * ne pas empiler les demandes automatiques quand aucun updater hote ne tourne.
 */
export async function hasPendingRequest(): Promise<boolean> {
  return fileExists(REQUEST_FILE);
}

export interface DeployRestartNotificationInput {
  applicationId: string;
  token: string;
  guildId?: string | null;
  channelId?: string | null;
}

export interface DeployRestartNotification extends DeployRestartNotificationInput {
  requestedBy: string;
  requestedAt: string;
  /** Mode demande : en `cache`, une absence de redemarrage est NORMALE. */
  mode?: DeployMode;
}

export interface DeployStatus {
  phase?: string;
  state?: string;
  message?: string;
  branch?: string;
  updatedAt?: string;
  requestedAt?: string;
  requestedBy?: string;
  commit?: string;
  mode?: string;
  log?: string;
}

/** Ecrit la demande de mise a jour (l'updater hote prend le relais). */
export async function requestDeploy(
  userId: string,
  notification?: DeployRestartNotificationInput,
  branch?: string,
  mode: DeployMode = DEFAULT_DEPLOY_MODE,
): Promise<string> {
  await mkdir(dirname(REQUEST_FILE), { recursive: true });
  const requestedAt = new Date().toISOString();

  if (notification) {
    await writeNotification({ ...notification, requestedBy: userId, requestedAt, mode }).catch(
      () => undefined,
    );
  }

  try {
    // `mode` est toujours ecrit, meme a sa valeur par defaut : un updater hote
    // qui ne connait pas encore le champ l ignore et reprend son comportement
    // historique, qui est justement `full`.
    const payload = JSON.stringify({
      requestedBy: userId,
      requestedAt,
      mode,
      ...(branch ? { branch } : {}),
    });
    await writeStatus({
      phase: 'requested',
      state: 'pending',
      message: 'Demande ecrite par le bot, attente de l updater hote.',
      branch,
      mode,
      requestedBy: userId,
      requestedAt,
    }).catch(() => undefined);
    await writeFile(REQUEST_FILE, payload + '\n', 'utf8');
    // Prévient Uptime Kuma qu'une maintenance (mise à jour) démarre.
    await notifyUptimeMaintenance('🛠️ Maintenance : mise à jour en cours').catch(() => undefined);
    return requestedAt;
  } catch (error) {
    if (notification) await clearNotification();
    throw error;
  }
}

/**
 * Ecrit une demande de mise a jour AUTOMATIQUE (nocturne, `FORCE_UPDATE`).
 *
 * Deux differences avec `/maj` : aucune interaction Discord a notifier, et le
 * drapeau `skipIfUpToDate` demande a l updater hote de ne RIEN reconstruire si
 * le depot est deja aligne sur `origin/<branche>` — sans lui, chaque nuit
 * rebuild l image et redemarre le bot pour rien.
 */
export async function requestAutoUpdate(branch: string): Promise<string> {
  await mkdir(dirname(REQUEST_FILE), { recursive: true });
  const requestedAt = new Date().toISOString();
  const payload = JSON.stringify({
    requestedBy: 'auto',
    requestedAt,
    branch,
    auto: true,
    skipIfUpToDate: true,
  });
  await writeStatus({
    phase: 'requested',
    state: 'pending',
    message: 'Mise a jour automatique (FORCE_UPDATE), attente de l updater hote.',
    branch,
    requestedBy: 'auto',
    requestedAt,
  }).catch(() => undefined);
  await writeFile(REQUEST_FILE, payload + '\n', 'utf8');
  // Comme pour /maj : previent Uptime Kuma qu une maintenance peut demarrer.
  await notifyUptimeMaintenance('🛠️ Maintenance : mise à jour automatique').catch(() => undefined);
  return requestedAt;
}

export interface DeployResult {
  status: 'success' | 'failure' | string;
  finishedAt?: string;
  branch?: string;
  requestedBranch?: string;
  repoDir?: string;
  beforeCommit?: string;
  commit?: string;
  mode?: string;
  log?: string;
}

/** Lit le dernier resultat de deploiement ecrit par l'updater hote, s'il existe. */
export async function readResult(): Promise<DeployResult | null> {
  try {
    const raw = await readFile(RESULT_FILE, 'utf8');
    return JSON.parse(raw) as DeployResult;
  } catch {
    return null;
  }
}

/**
 * Fin du journal de la mise a jour en cours, s'il y en a une.
 *
 * On ne renvoie que la fin : c'est la partie qui dit ou on en est, et un build
 * Docker complet n'a pas a traverser l'API a chaque interrogation du dashboard.
 */
export async function readRunningLog(maxChars = 8000): Promise<string | null> {
  try {
    const raw = await readFile(LOG_FILE, 'utf8');
    const log = raw.slice(-maxChars);
    return log.trim() ? log : null;
  } catch {
    return null;
  }
}

/** Lit l'etat courant de l'updater hote, s'il existe. */
export async function readStatus(): Promise<DeployStatus | null> {
  try {
    const raw = await readFile(STATUS_FILE, 'utf8');
    return JSON.parse(raw) as DeployStatus;
  } catch {
    return null;
  }
}

async function writeStatus(status: DeployStatus): Promise<void> {
  await writeFile(
    STATUS_FILE,
    JSON.stringify({ ...status, updatedAt: status.updatedAt ?? new Date().toISOString() }) + '\n',
    'utf8',
  );
}

async function writeNotification(notification: DeployRestartNotification): Promise<void> {
  await writeFile(NOTIFY_FILE, JSON.stringify(notification) + '\n', 'utf8');
}

async function readNotification(): Promise<DeployRestartNotification | null> {
  try {
    const raw = await readFile(NOTIFY_FILE, 'utf8');
    const data = JSON.parse(raw) as Partial<DeployRestartNotification>;
    if (!data.applicationId || !data.token || !data.requestedBy || !data.requestedAt) return null;
    return {
      applicationId: data.applicationId,
      token: data.token,
      requestedBy: data.requestedBy,
      requestedAt: data.requestedAt,
      mode: toDeployMode(data.mode),
      guildId: data.guildId ?? null,
      channelId: data.channelId ?? null,
    };
  } catch {
    return null;
  }
}

async function clearNotification(): Promise<void> {
  await rm(NOTIFY_FILE, { force: true }).catch(() => undefined);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function isFreshResult(result: DeployResult | null, requestedAt: string): boolean {
  if (!result?.finishedAt) return false;
  const finished = new Date(result.finishedAt).getTime();
  const requested = new Date(requestedAt).getTime();
  return Number.isFinite(finished) && Number.isFinite(requested) && finished >= requested - 5_000;
}

async function waitForResult(
  requestedAt: string,
  waitMs = RESULT_WAIT_MS,
): Promise<DeployResult | null> {
  const endAt = Date.now() + waitMs;
  let latest = await readResult();
  while (!isFreshResult(latest, requestedAt) && Date.now() < endAt) {
    await delay(RESULT_POLL_MS);
    latest = await readResult();
  }
  return isFreshResult(latest, requestedAt) ? latest : null;
}

function statusSummary(ctx: BotContext, status: DeployStatus | null): string {
  if (!status) return ctx.t('modules.deploy.statusUnknown');
  const phase = status.phase ?? status.state ?? 'unknown';
  const message = status.message ? ' - ' + status.message : '';
  const when = status.updatedAt
    ? ' <t:' + Math.floor(new Date(status.updatedAt).getTime() / 1000) + ':R>'
    : '';
  return '`' + phase + '`' + message + when;
}

function logBlock(log: string | undefined): string {
  if (!log) return '';
  return '\n```log\n' + log.slice(-900).replace(/```/g, "'''") + '\n```';
}

function shortCommit(commit: string | undefined): string {
  return commit && commit !== 'unknown' ? commit.slice(0, 8) : 'unknown';
}

function resultDetails(result: DeployResult): string {
  const lines = [
    `Branche demandee : \`${result.requestedBranch ?? 'unknown'}\``,
    `Branche active : \`${result.branch ?? 'unknown'}\``,
    `Commit avant : \`${shortCommit(result.beforeCommit)}\``,
    `Commit apres : \`${shortCommit(result.commit)}\``,
  ];
  if (result.repoDir) lines.push(`Repo : \`${result.repoDir}\``);
  return lines.join('\n');
}

function restartMessage(ctx: BotContext, result: DeployResult | null): string {
  if (!result) return ctx.t('modules.deploy.restartedNoResult');
  const icon =
    result.status === 'success'
      ? '\u2705'
      : result.status === 'failure'
        ? '\u26A0\uFE0F'
        : '\u2139\uFE0F';
  const commit = ' `' + shortCommit(result.commit) + '`';
  return `${ctx.t('modules.deploy.restarted', { icon, status: result.status, commit })}\n${resultDetails(result)}${logBlock(result.log)}`;
}
async function postEphemeralFollowUp(
  ctx: BotContext,
  notification: DeployRestartNotification,
  content: string,
): Promise<void> {
  await ctx.client.rest.post(Routes.webhook(notification.applicationId, notification.token), {
    body: { content: content.slice(0, 1900), flags: MessageFlags.Ephemeral },
  });
}

/** Surveille la demande tant que l'ancien process est vivant, pour signaler les blocages. */
export function watchDeployProgress(
  ctx: BotContext,
  notification: DeployRestartNotification,
): void {
  void monitorDeployProgress(ctx, notification);
}

async function monitorDeployProgress(
  ctx: BotContext,
  notification: DeployRestartNotification,
): Promise<void> {
  await delay(REQUEST_PICKUP_WAIT_MS);

  if (await fileExists(REQUEST_FILE)) {
    const status = await readStatus();
    await postEphemeralFollowUp(
      ctx,
      notification,
      ctx.t('modules.deploy.requestNotPicked', { status: statusSummary(ctx, status) }),
    ).catch((error) => ctx.logger.warn({ err: error }, 'Impossible de notifier /maj non pris'));
  }

  const result = await waitForResult(notification.requestedAt, UPDATE_RESULT_WAIT_MS);
  if (!result) {
    const status = await readStatus();
    await postEphemeralFollowUp(
      ctx,
      notification,
      ctx.t('modules.deploy.updateTimeout', {
        seconds: Math.round(UPDATE_RESULT_WAIT_MS / 1000),
        status: statusSummary(ctx, status),
      }),
    ).catch((error) => ctx.logger.warn({ err: error }, 'Impossible de notifier /maj timeout'));
    return;
  }

  if (result.status === 'failure') {
    const status = await readStatus();
    await postEphemeralFollowUp(
      ctx,
      notification,
      ctx.t('modules.deploy.updateFailed', { status: statusSummary(ctx, status) }) +
        logBlock(result.log),
    ).catch((error) => ctx.logger.warn({ err: error }, 'Impossible de notifier /maj failure'));
    await clearNotification();
    return;
  }

  await delay(RESTART_GRACE_MS);
  // Mode rapide : Compose ne recree le conteneur que si l image a change. Ne
  // pas avoir redemarre est donc le resultat NORMAL d une mise a jour sans
  // changement — le crier en avertissement ferait chercher une panne absente.
  const finished =
    notification.mode === 'cache'
      ? ctx.t('modules.deploy.updateFinishedCache', {
          status: result.status,
          commit: shortCommit(result.commit),
        })
      : ctx.t('modules.deploy.updateFinishedNoRestart', {
          seconds: Math.round(RESTART_GRACE_MS / 1000),
          status: result.status,
          commit: shortCommit(result.commit),
        });
  await postEphemeralFollowUp(ctx, notification, finished).catch((error) =>
    ctx.logger.warn({ err: error }, 'Impossible de notifier /maj sans reboot'),
  );
  await clearNotification();
}

/**
 * Apres un redemarrage declenche par /maj, envoie un follow-up ephemere sur
 * l'interaction originale. Le token Discord expire vite ; en cas d'echec, on
 * supprime quand meme la notification pour eviter les retries infinis.
 */
export async function notifyPendingDeployRestart(ctx: BotContext): Promise<void> {
  const notification = await readNotification();
  if (!notification) return;

  const result = await waitForResult(notification.requestedAt);
  try {
    await postEphemeralFollowUp(ctx, notification, restartMessage(ctx, result));
    ctx.logger.info(
      {
        userId: notification.requestedBy,
        guildId: notification.guildId,
        channelId: notification.channelId,
        status: result?.status ?? 'unknown',
      },
      'Notification post-redemarrage /maj envoyee',
    );
  } catch (error) {
    ctx.logger.warn(
      { err: error, userId: notification.requestedBy },
      'Impossible d envoyer la notification post-redemarrage /maj',
    );
  } finally {
    await clearNotification();
  }
}
