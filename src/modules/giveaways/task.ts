import type { BotContext, ScheduledTask, TaskReport } from '../../core/module.js';
import { MODULE_NAME } from './config.js';
import { endGiveaway } from './service.js';
import { useGuildLocale } from '../../core/guild-locale.js';

async function drawDueGiveaways(ctx: BotContext): Promise<TaskReport> {
  const due = await ctx.db.giveaway.findMany({
    where: { status: 'active', endsAt: { lte: new Date() } },
    take: 25,
  });
  let tirages = 0;
  let echecs = 0;
  for (const giveaway of due) {
    if (!(await ctx.config.isEnabled(giveaway.guildId, MODULE_NAME))) continue;
    const guild = ctx.client.guilds.cache.get(giveaway.guildId);
    if (!guild) continue;
    // Le tirage se clôt dans la langue du serveur qui l'a lancé.
    await useGuildLocale(giveaway.guildId);
    try {
      await endGiveaway(ctx, guild, giveaway);
      tirages += 1;
    } catch (error) {
      // Un tirage qui échoue bloque toute la fournée s'il remonte : on le note
      // et on passe au suivant. Sans cette ligne, le lot promis n'était jamais
      // remis et rien nulle part ne disait pourquoi.
      echecs += 1;
      ctx.logger.error(
        { err: error, guildId: giveaway.guildId, giveawayId: giveaway.id },
        'Tirage au sort non clôturé',
      );
    }
  }
  return { tirages, echecs };
}

/** Vérifie chaque minute les tirages arrivés à échéance et les clôture. */
export const giveawayTask: ScheduledTask = {
  name: 'draw',
  cron: '* * * * *',
  execute: drawDueGiveaways,
};
