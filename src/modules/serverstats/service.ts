import type { Guild } from 'discord.js';
import type { BotContext, TaskReport } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import {
  type CounterType,
  MODULE_NAME,
  type ServerCounter,
  getServerstatsConfig,
} from './config.js';
import { useGuildLocale } from '../../core/guild-locale.js';

/** Types nécessitant le cache complet des membres. */
const MEMBER_TYPES: CounterType[] = ['humans', 'bots', 'role'];

/** Gabarit par défaut suggéré pour un type de compteur (contient `{count}`). */
export function defaultTemplateFor(type: CounterType): string {
  return t(`modules.serverstats.default.${type}`);
}

/** Calcule la valeur d'un compteur selon l'état courant du serveur. */
export function computeValue(guild: Guild, counter: ServerCounter): number {
  switch (counter.type) {
    case 'members':
      return guild.memberCount;
    case 'humans':
      return guild.members.cache.filter((member) => !member.user.bot).size;
    case 'bots':
      return guild.members.cache.filter((member) => member.user.bot).size;
    case 'boosts':
      return guild.premiumSubscriptionCount ?? 0;
    case 'roles':
      return Math.max(0, guild.roles.cache.size - 1);
    case 'channels':
      return guild.channels.cache.size;
    case 'role':
      return counter.roleId ? (guild.roles.cache.get(counter.roleId)?.members.size ?? 0) : 0;
    default:
      return 0;
  }
}

/** Nom de salon final : `template` avec `{count}` remplacé (borné à 100). */
export function formatName(counter: ServerCounter, value: number): string {
  return counter.template
    .replace('{count}', value.toLocaleString(t('langue.format')))
    .slice(0, 100);
}

/**
 * Renommages en attente : Discord limite à 2 renommages / 10 min par salon.
 * Au-delà, discord.js met la requête en file pendant plusieurs minutes — on ne
 * garde donc qu'UN renommage en vol par salon (les tentatives intermédiaires
 * sont sautées, la tâche périodique réalignera le nom de toute façon).
 */
const pendingRenames = new Set<string>();

/**
 * Met à jour le nom d'un salon-compteur (rien si le nom n'a pas changé).
 *
 * Rend `false` quand le renommage a été tenté et refusé — c'est la seule chose
 * que la tâche rapporte : réaligner les noms est son travail normal, l'échec
 * est l'évènement.
 */
export async function updateCounter(
  ctx: BotContext,
  guild: Guild,
  counter: ServerCounter,
): Promise<boolean> {
  if (!counter.channelId) return true;
  const channel =
    guild.channels.cache.get(counter.channelId) ??
    (await guild.channels.fetch(counter.channelId).catch(() => null));
  if (!channel) return true;
  const name = formatName(counter, computeValue(guild, counter));
  if (channel.name === name) return true;
  if (pendingRenames.has(channel.id)) return true;

  pendingRenames.add(channel.id);
  try {
    await channel.setName(name);
    return true;
  } catch (error) {
    // Un compteur qui ne bouge plus (permission « Gérer les salons » retirée)
    // était parfaitement muet : le salon gardait son ancien nombre et rien
    // n'expliquait pourquoi. Le rate limit, lui, se rattrape au passage suivant.
    ctx.logger.warn(
      { err: error, guildId: guild.id, channelId: channel.id, compteur: counter.type },
      'Salon-compteur non renommé',
    );
    return false;
  } finally {
    pendingRenames.delete(channel.id);
  }
}

/**
 * Rafraîchit un seul compteur immédiatement, à partir du cache (aucun fetch
 * global des membres : on évite d'empiler des requêtes gateway lors de réglages
 * rapides depuis le dashboard). La tâche périodique reste, elle, autoritaire et
 * récupère les membres pour un décompte exact.
 */
export async function refreshCounter(
  ctx: BotContext,
  guild: Guild,
  counter: ServerCounter,
): Promise<void> {
  await updateCounter(ctx, guild, counter);
}

/**
 * Met à jour tous les compteurs d'un serveur (récupère les membres si besoin).
 * Rend le nombre de renommages refusés.
 */
export async function updateGuildCounters(ctx: BotContext, guild: Guild): Promise<number> {
  const config = await getServerstatsConfig(ctx, guild.id);
  if (config.counters.length === 0) return 0;

  if (config.counters.some((counter) => MEMBER_TYPES.includes(counter.type))) {
    await guild.members.fetch().catch(() => undefined);
  }
  let echecs = 0;
  for (const counter of config.counters) {
    if (!(await updateCounter(ctx, guild, counter))) echecs += 1;
  }
  return echecs;
}

/** Met à jour les compteurs de tous les serveurs où le module est activé. */
export async function updateAllGuilds(ctx: BotContext): Promise<TaskReport> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);
  let echecs = 0;
  for (const row of rows) {
    const guild = ctx.client.guilds.cache.get(row.guildId);
    if (!guild) continue;
    // Les gabarits de compteurs passent par `t()` : un serveur en anglais doit
    // voir ses salons nommés en anglais.
    await useGuildLocale(row.guildId);
    echecs += await updateGuildCounters(ctx, guild);
  }
  // Rien n'est rapporté quand tout s'est bien passé : réaligner les noms toutes
  // les dix minutes est le travail normal de la tâche, pas une nouvelle.
  return { echecs };
}
