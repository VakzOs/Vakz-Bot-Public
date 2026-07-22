import type { Reminder } from '@prisma/client';
import type { BotContext } from '../../core/module.js';
import { env } from '../../core/env.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME } from './config.js';

const DUE_BATCH_SIZE = 25;
const WEEK_MINUTES = 7 * 24 * 60;

export interface CreateReminderInput {
  guildId: string;
  channelId: string | null;
  targetKind: 'user' | 'role';
  targetId: string;
  message: string;
  dueAt: Date;
  deliverInDm: boolean;
  repeatKind?: 'once' | 'weekly';
  repeatDay?: number | null;
  repeatHour?: number | null;
  repeatMinute?: number | null;
}

export async function createReminder(ctx: BotContext, input: CreateReminderInput): Promise<void> {
  await ctx.db.reminder.create({ data: input });
}

function zonedParts(date: Date, tz: string): { day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday) + 1;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return { day: day || 1, hour, minute };
}

export function nextWeeklyOccurrence(
  day: number,
  hour: number,
  minute: number,
  tz = env.TZ,
  after = new Date(),
): Date {
  const start = new Date(after.getTime() + 60_000);
  start.setSeconds(0, 0);
  for (let offset = 0; offset <= WEEK_MINUTES; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    const parts = zonedParts(candidate, tz);
    if (parts.day === day && parts.hour === hour && parts.minute === minute) return candidate;
  }
  return new Date(start.getTime() + WEEK_MINUTES * 60_000);
}

async function sendReminder(ctx: BotContext, reminder: Reminder): Promise<void> {
  const mention =
    reminder.targetKind === 'role' ? `<@&${reminder.targetId}>` : `<@${reminder.targetId}>`;
  const content = t('modules.reminders.delivery', {
    target: mention,
    text: reminder.message,
  });

  if (!reminder.deliverInDm && reminder.channelId) {
    const guild = ctx.client.guilds.cache.get(reminder.guildId);
    const channel = await guild?.channels.fetch(reminder.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({
        content,
        allowedMentions:
          reminder.targetKind === 'role'
            ? { roles: [reminder.targetId] }
            : { users: [reminder.targetId] },
      });
      return;
    }
  }

  if (reminder.targetKind === 'user') {
    const user = await ctx.client.users.fetch(reminder.targetId).catch(() => null);
    await user?.send({ content }).catch(() => undefined);
  }
}

export async function deliverDueReminders(ctx: BotContext): Promise<void> {
  const now = new Date();
  const reminders = await ctx.db.reminder.findMany({
    where: { dueAt: { lte: now }, deliveredAt: null },
    orderBy: { dueAt: 'asc' },
    take: DUE_BATCH_SIZE,
  });

  for (const reminder of reminders) {
    const enabled = await ctx.config.isEnabled(reminder.guildId, MODULE_NAME);
    if (!enabled) continue;

    if (
      reminder.repeatKind === 'weekly' &&
      reminder.repeatDay !== null &&
      reminder.repeatHour !== null &&
      reminder.repeatMinute !== null
    ) {
      await ctx.db.reminder.update({
        where: { id: reminder.id },
        data: {
          dueAt: nextWeeklyOccurrence(
            reminder.repeatDay,
            reminder.repeatHour,
            reminder.repeatMinute,
            env.TZ,
            now,
          ),
        },
      });
    } else {
      await ctx.db.reminder.update({
        where: { id: reminder.id },
        data: { deliveredAt: now },
      });
    }
    await sendReminder(ctx, reminder);
  }
}
