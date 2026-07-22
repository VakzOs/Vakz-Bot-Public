import type { ScheduledTask } from '../../core/module.js';
import { env } from '../../core/env.js';
import { MODULE_NAME, getBirthdaysConfig } from './config.js';
import { nowInTz, runBirthdaysForGuild } from './service.js';

/**
 * Tâche minutée : chaque minute, on annonce les anniversaires des serveurs dont
 * l'heure ET la minute d'annonce configurées correspondent à l'instant courant
 * (dans le fuseau du bot).
 */
export const birthdayTask: ScheduledTask = {
  name: 'announce',
  cron: '* * * * *',
  async execute(ctx) {
    const { hour, minute, day, month } = nowInTz(env.TZ);
    const rows = await ctx.db.moduleConfig.findMany({
      where: { module: MODULE_NAME, enabled: true },
    });
    for (const row of rows) {
      const config = await getBirthdaysConfig(ctx, row.guildId);
      if (config.announceHour !== hour || config.announceMinute !== minute) continue;
      await runBirthdaysForGuild(ctx, row.guildId, config, day, month);
    }
  },
};
