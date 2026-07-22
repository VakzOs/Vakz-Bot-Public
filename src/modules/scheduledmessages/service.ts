import { EmbedBuilder, type Guild } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { Colors } from '../../lib/embeds.js';
import {
  MODULE_NAME,
  type Schedule,
  type ScheduledMessage,
  getScheduledmessagesConfig,
  updateScheduledmessagesConfig,
} from './config.js';

/** `lastPosted` initial d'un message selon sa cadence (voir isDue). */
export function initialLastPosted(schedule: Schedule): number {
  // Intervalle : on part de « maintenant » pour ne pas poster immédiatement.
  // Quotidien / hebdo : 0 → postera au prochain créneau correspondant.
  return schedule.type === 'interval' ? Date.now() : 0;
}

/** Détermine si un message doit être envoyé à l'instant `now`. */
export function isDue(message: ScheduledMessage, now: Date): boolean {
  const schedule = message.schedule;

  if (schedule.type === 'interval') {
    return now.getTime() - message.lastPosted >= schedule.hours * 3_600_000;
  }

  const [hour, minute] = schedule.time.split(':').map((part) => Number.parseInt(part, 10));
  if (now.getHours() !== hour || now.getMinutes() !== minute) return false;
  if (schedule.type === 'weekly' && now.getDay() !== schedule.weekday) return false;
  // Garde-fou anti-doublon (deux ticks dans la même minute, ou redémarrage).
  return now.getTime() - message.lastPosted > 60_000;
}

/** Envoie un message programmé dans son salon. Renvoie `false` en cas d'échec. */
async function post(ctx: BotContext, guild: Guild, message: ScheduledMessage): Promise<boolean> {
  const channel = await guild.channels.fetch(message.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  try {
    if (message.asEmbed) {
      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setDescription(message.content.slice(0, 4000));
      await channel.send({ embeds: [embed], allowedMentions: { parse: ['users', 'roles'] } });
    } else {
      await channel.send({
        content: message.content.slice(0, 2000),
        allowedMentions: { parse: ['users', 'roles', 'everyone'] },
      });
    }
    return true;
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId: guild.id, message: message.id },
      'Envoi de message programmé échoué',
    );
    return false;
  }
}

/** Envoie immédiatement un message (bouton « Envoyer maintenant »). */
export async function sendNow(
  ctx: BotContext,
  guild: Guild,
  message: ScheduledMessage,
): Promise<boolean> {
  return post(ctx, guild, message);
}

/**
 * Passe en revue tous les serveurs où le module est activé et envoie les
 * messages arrivés à échéance, en mettant à jour leur `lastPosted`.
 */
export async function runScheduledMessages(ctx: BotContext): Promise<void> {
  const rows = await ctx.db.moduleConfig
    .findMany({ where: { module: MODULE_NAME, enabled: true } })
    .catch(() => []);
  const now = new Date();

  for (const row of rows) {
    const guild = ctx.client.guilds.cache.get(row.guildId);
    if (!guild) continue;

    const config = await getScheduledmessagesConfig(ctx, row.guildId);
    if (config.messages.length === 0) continue;

    let changed = false;
    for (const message of config.messages) {
      if (!isDue(message, now)) continue;
      await post(ctx, guild, message);
      message.lastPosted = now.getTime();
      changed = true;
    }
    if (changed) {
      await updateScheduledmessagesConfig(ctx, row.guildId, { messages: config.messages });
    }
  }
}
