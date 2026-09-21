import type { ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getRemindersConfig } from './config.js';
import { createReminder, nextWeeklyOccurrence } from './service.js';

const MINUTES_IN_DAY = 24 * 60;

/** Programme un rappel ponctuel ou hebdomadaire depuis le dashboard. */
const create = (): ModuleAction => ({
  id: 'create',
  label: t('modules.reminders.actions.create.label'),
  style: 'primary',
  fields: [
    {
      key: 'repeatKind',
      label: t('modules.reminders.actions.create.champs.repeatKind.label'),
      type: 'select',
      options: [
        { value: 'once', label: t('modules.reminders.actions.create.champs.repeatKind.opt.once') },
        {
          value: 'weekly',
          label: t('modules.reminders.actions.create.champs.repeatKind.opt.weekly'),
        },
      ],
    },
    {
      key: 'targetKind',
      label: t('modules.reminders.actions.create.champs.targetKind.label'),
      type: 'select',
      options: [
        { value: 'user', label: t('modules.reminders.actions.create.champs.targetKind.opt.user') },
        { value: 'role', label: t('modules.reminders.actions.create.champs.targetKind.opt.role') },
      ],
    },
    {
      key: 'targetId',
      label: t('modules.reminders.actions.create.champs.targetId.label'),
      type: 'text',
      help: t('modules.reminders.actions.create.champs.targetId.help'),
    },
    {
      key: 'channelId',
      label: t('modules.reminders.actions.create.champs.channelId.label'),
      type: 'channel',
      help: t('modules.reminders.actions.create.champs.channelId.help'),
    },
    {
      key: 'message',
      label: t('modules.reminders.actions.create.champs.message'),
      type: 'textarea',
    },
    {
      key: 'delayMinutes',
      label: t('modules.reminders.actions.create.champs.delayMinutes'),
      type: 'number',
      default: 60,
    },
    {
      key: 'weeklyDay',
      label: t('modules.reminders.actions.create.champs.weeklyDay'),
      type: 'number',
      default: 1,
    },
    {
      key: 'weeklyHour',
      label: t('modules.reminders.actions.create.champs.weeklyHour'),
      type: 'number',
      default: 9,
    },
    {
      key: 'weeklyMinute',
      label: t('modules.reminders.actions.create.champs.weeklyMinute'),
      type: 'number',
      default: 0,
    },
  ],
  async run({ ctx, guildId, input }) {
    const num = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;

    const msg = (key: string, vars?: Record<string, string | number>) =>
      t(`modules.reminders.actions.create.msg.${key}`, vars);
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message) return { ok: false, message: msg('needMessage') };

    const targetKind = input.targetKind === 'role' ? 'role' : 'user';
    const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
    if (!/^\d{5,25}$/.test(targetId)) {
      return { ok: false, message: msg('badTarget') };
    }

    const channelId =
      typeof input.channelId === 'string' && input.channelId ? input.channelId : null;
    // Un rôle ne peut pas recevoir de message privé : il lui faut un salon.
    if (!channelId && targetKind === 'role') {
      return { ok: false, message: msg('roleNeedsChannel') };
    }

    const config = await getRemindersConfig(ctx, guildId);
    const repeatKind = input.repeatKind === 'weekly' ? 'weekly' : 'once';

    let dueAt: Date;
    let repeatDay: number | null = null;
    let repeatHour: number | null = null;
    let repeatMinute: number | null = null;

    if (repeatKind === 'weekly') {
      repeatDay = Math.min(7, Math.max(1, num(input.weeklyDay, 1)));
      repeatHour = Math.min(23, Math.max(0, num(input.weeklyHour, 9)));
      repeatMinute = Math.min(59, Math.max(0, num(input.weeklyMinute, 0)));
      dueAt = nextWeeklyOccurrence(repeatDay, repeatHour, repeatMinute);
    } else {
      const delay = num(input.delayMinutes, 0);
      const maxDelay = config.maxDelayDays * MINUTES_IN_DAY;
      if (delay < 1 || delay > maxDelay) {
        return { ok: false, message: msg('delayOutOfRange', { max: maxDelay }) };
      }
      dueAt = new Date(Date.now() + delay * 60_000);
    }

    const deliverInDm = !channelId;
    if (deliverInDm && !config.allowDm) {
      return { ok: false, message: msg('dmDisabled') };
    }

    await createReminder(ctx, {
      guildId,
      channelId,
      targetKind,
      targetId,
      message,
      dueAt,
      deliverInDm,
      repeatKind,
      repeatDay,
      repeatHour,
      repeatMinute,
    });
    return { ok: true, message: msg('done', { date: dueAt.toLocaleString(t('langue.format')) }) };
  },
});

export const remindersActions = (): ModuleAction[] => [create()];
