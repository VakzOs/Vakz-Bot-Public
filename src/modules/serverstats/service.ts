import type { Guild } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import {
  type CounterType,
  MODULE_NAME,
  type ServerCounter,
  getServerstatsConfig,
} from './config.js';

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
  return counter.template.replace('{count}', value.toLocaleString('fr-FR')).slice(0, 100);
}

/**
 * Renommages en attente : Discord limite à 2 renommages / 10 min par salon.
 * Au-delà, discord.js met la requête en file pendant plusieurs minutes — on ne
 * garde donc qu'UN renommage en vol par salon (les tentatives intermédiaires
 * sont sautées, la tâche périodique réalignera le nom de toute façon).
 */
const pendingRenames = new Set<string>();

/** Met à jour le nom d'un salon-compteur (rien si le nom n'a pas changé). */
export async function updateCounter(
  ctx: BotContext,
  guild: Guild,
  counter: ServerCounter,
): Promise<void> {
  if (!counter.channelId) return;
  const channel =
    guild.channels.cache.get(counter.channelId) ??
    (await guild.channels.fetch(counter.channelId).catch(() => null));
  if (!channel) return;
  const name = formatName(counter, computeValue(guild, counter));
  if (channel.name === name) return;
  if (pendingRenames.has(channel.id)) return;

  pendingRenames.add(channel.id);
  try {
    await channel.setName(name);
  } catch {
    // Ignoré : permissions manquantes ou rate limit — la tâche périodique réessaiera.
  } finally {
    pendingRenames.delete(channel.id);
  }
}

/**
 * Rafraîchit un seul compteur immédiatement, à partir du cache (aucun fetch
 * global des membres : on évite d'empiler des requêtes gateway lors de réglages
 * rapides depuis `/config`). La tâche périodique reste, elle, autoritaire et
 * récupère les membres pour un décompte exact.
 */
export async function refreshCounter(
  ctx: BotContext,
  guild: Guild,
  counter: ServerCounter,
): Promise<void> {
  await updateCounter(ctx, guild, counter);
}

/** Met à jour tous les compteurs d'un serveur (récupère les membres si besoin). */
export async function updateGuildCounters(ctx: BotContext, guild: Guild): Promise<void> {
  const config = await getServerstatsConfig(ctx, guild.id);
  if (config.counters.length === 0) return;

  if (config.counters.some((counter) => MEMBER_TYPES.includes(counter.type))) {
    await guild.members.fetch().catch(() => undefined);
  }
  for (const counter of config.counters) {
    await updateCounter(ctx, guild, counter);
  }
}

/** Met à jour les compteurs de tous les serveurs où le module est activé. */
export async function updateAllGuilds(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);
  for (const row of rows) {
    const guild = ctx.client.guilds.cache.get(row.guildId);
    if (guild) await updateGuildCounters(ctx, guild);
  }
}
