import type { BotContext, ScheduledTask } from '../../core/module.js';
import { MODULE_NAME } from './config.js';
import { endGiveaway } from './service.js';

async function drawDueGiveaways(ctx: BotContext): Promise<void> {
  const due = await ctx.db.giveaway.findMany({
    where: { status: 'active', endsAt: { lte: new Date() } },
    take: 25,
  });
  for (const giveaway of due) {
    if (!(await ctx.config.isEnabled(giveaway.guildId, MODULE_NAME))) continue;
    const guild = ctx.client.guilds.cache.get(giveaway.guildId);
    if (!guild) continue;
    await endGiveaway(ctx, guild, giveaway);
  }
}

/** Vérifie chaque minute les tirages arrivés à échéance et les clôture. */
export const giveawayTask: ScheduledTask = {
  name: 'draw',
  cron: '* * * * *',
  execute: drawDueGiveaways,
};
