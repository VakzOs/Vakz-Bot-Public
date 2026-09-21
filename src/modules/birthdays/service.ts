import { PermissionFlagsBits } from 'discord.js';
import { env } from '../../core/env.js';
import type { BotContext } from '../../core/module.js';
import type { BirthdaysConfig } from './config.js';

// Jours max par mois (février : 29 autorisé sans connaître l'année).
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isValidDate(day: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  const max = MONTH_DAYS[month - 1] ?? 31;
  return day >= 1 && day <= max;
}

/** Heure/minute/jour/mois/année courants dans un fuseau donné. */
export function nowInTz(tz: string): {
  hour: number;
  minute: number;
  day: number;
  month: number;
  year: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    hour: get('hour') % 24,
    minute: get('minute'),
    day: get('day'),
    month: get('month'),
    year: get('year'),
  };
}

/** Nombre de jours avant le prochain anniversaire (0 = aujourd'hui). */
export function daysUntil(day: number, month: number, tz: string): number {
  const now = nowInTz(tz);
  const today = Date.UTC(now.year, now.month - 1, now.day);
  let next = Date.UTC(now.year, month - 1, day);
  if (next < today) next = Date.UTC(now.year + 1, month - 1, day);
  return Math.round((next - today) / 86_400_000);
}

export interface BirthdayRow {
  userId: string;
  day: number;
  month: number;
  year: number | null;
}

export async function setBirthday(
  ctx: BotContext,
  guildId: string,
  userId: string,
  day: number,
  month: number,
  year: number | null,
): Promise<void> {
  await ctx.db.birthday.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: { day, month, year },
    create: { guildId, userId, day, month, year },
  });
}

export async function removeBirthday(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<void> {
  await ctx.db.birthday.deleteMany({ where: { guildId, userId } });
}

export async function getBirthday(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<BirthdayRow | null> {
  return ctx.db.birthday.findUnique({ where: { guildId_userId: { guildId, userId } } });
}

export async function getUpcoming(
  ctx: BotContext,
  guildId: string,
  tz: string,
  limit = 10,
): Promise<(BirthdayRow & { in: number })[]> {
  const all = await ctx.db.birthday.findMany({ where: { guildId } });
  return all
    .map((row) => ({ ...row, in: daysUntil(row.day, row.month, tz) }))
    .sort((a, b) => a.in - b.in)
    .slice(0, limit);
}

/** Exécute l'annonce d'anniversaire du jour pour un serveur (rôle + message). */
export async function runBirthdaysForGuild(
  ctx: BotContext,
  guildId: string,
  config: BirthdaysConfig,
  day: number,
  month: number,
): Promise<void> {
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) return;

  const todays = await ctx.db.birthday.findMany({ where: { guildId, day, month } });
  const todayIds = new Set(todays.map((row) => row.userId));

  if (config.roleId) {
    const role = guild.roles.cache.get(config.roleId);
    const me = guild.members.me;
    if (
      role &&
      me &&
      me.permissions.has(PermissionFlagsBits.ManageRoles) &&
      role.position < me.roles.highest.position
    ) {
      // Retire le rôle aux membres dont ce n'est plus l'anniversaire.
      for (const member of role.members.values()) {
        if (!todayIds.has(member.id)) await member.roles.remove(role).catch(() => undefined);
      }
      // Attribue le rôle aux membres du jour.
      for (const row of todays) {
        const member = await guild.members.fetch(row.userId).catch(() => null);
        if (member && !member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => undefined);
        }
      }
    }
  }

  if (config.channelId && todays.length > 0) {
    const channel = await guild.channels.fetch(config.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      const currentYear = nowInTz(env.TZ).year;
      for (const row of todays) {
        const age = row.year ? String(currentYear - row.year) : '';
        const content = config.message
          .replaceAll('{mention}', `<@${row.userId}>`)
          .replaceAll('{age}', age);
        await channel
          .send({ content, allowedMentions: { users: [row.userId] } })
          .catch(() => undefined);
      }
    }
  }
}
