import type { ScheduledTask } from '../../core/module.js';
import { env } from '../../core/env.js';
import { MODULE_NAME, getBirthdaysConfig } from './config.js';
import { nowInTz, runBirthdaysForGuild } from './service.js';
import { useGuildLocale } from '../../core/guild-locale.js';

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
    const total = { annonces: 0, roles: 0, echecs: 0 };
    for (const row of rows) {
      const config = await getBirthdaysConfig(ctx, row.guildId);
      if (config.announceHour !== hour || config.announceMinute !== minute) continue;
      // Une tâche parcourt les serveurs : le message d'anniversaire sort dans
      // la langue de celui qu'il concerne, pas dans celle du bot.
      await useGuildLocale(row.guildId);
      const report = await runBirthdaysForGuild(ctx, row.guildId, config, day, month);
      total.annonces += report.annonces ?? 0;
      total.roles += report.roles ?? 0;
      total.echecs += report.echecs ?? 0;
    }
    // La tâche tourne à la minute et ne trouve son heure qu'une fois par jour
    // et par serveur : elle ne parle donc que ce jour-là, et dit ce qu'elle a
    // annoncé.
    return total;
  },
};
