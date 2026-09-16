import type { ModuleAction } from '../../core/module.js';
import { getRemindersConfig } from './config.js';
import { createReminder, nextWeeklyOccurrence } from './service.js';

const MINUTES_IN_DAY = 24 * 60;

/** Programme un rappel ponctuel ou hebdomadaire depuis le dashboard. */
const create: ModuleAction = {
  id: 'create',
  label: 'Programmer un rappel',
  style: 'primary',
  fields: [
    {
      key: 'repeatKind',
      label: 'Cadence',
      type: 'select',
      options: [
        { value: 'once', label: 'Une seule fois' },
        { value: 'weekly', label: 'Chaque semaine' },
      ],
    },
    {
      key: 'targetKind',
      label: 'Destinataire',
      type: 'select',
      options: [
        { value: 'user', label: 'Un membre' },
        { value: 'role', label: 'Un rôle' },
      ],
    },
    {
      key: 'targetId',
      label: 'Identifiant du membre / rôle',
      type: 'text',
      help: 'Snowflake Discord de la personne ou du rôle à notifier.',
    },
    {
      key: 'channelId',
      label: 'Salon de rappel',
      type: 'channel',
      help: 'Laisse vide pour envoyer en message privé (destinataire « membre » uniquement).',
    },
    { key: 'message', label: 'Message', type: 'textarea' },
    {
      key: 'delayMinutes',
      label: 'Dans combien de minutes ? (cadence « une seule fois »)',
      type: 'number',
      default: 60,
    },
    {
      key: 'weeklyDay',
      label: 'Jour (1 = lundi … 7 = dimanche, cadence hebdomadaire)',
      type: 'number',
      default: 1,
    },
    { key: 'weeklyHour', label: 'Heure (0-23, cadence hebdomadaire)', type: 'number', default: 9 },
    {
      key: 'weeklyMinute',
      label: 'Minute (0-59, cadence hebdomadaire)',
      type: 'number',
      default: 0,
    },
  ],
  async run({ ctx, guildId, input }) {
    const num = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;

    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message) return { ok: false, message: 'Le message est obligatoire.' };

    const targetKind = input.targetKind === 'role' ? 'role' : 'user';
    const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
    if (!/^\d{5,25}$/.test(targetId)) {
      return { ok: false, message: 'Identifiant de destinataire invalide.' };
    }

    const channelId =
      typeof input.channelId === 'string' && input.channelId ? input.channelId : null;
    // Un rôle ne peut pas recevoir de message privé : il lui faut un salon.
    if (!channelId && targetKind === 'role') {
      return { ok: false, message: 'Un rappel de rôle doit viser un salon.' };
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
        return { ok: false, message: `Délai hors limites (1 à ${maxDelay} minutes).` };
      }
      dueAt = new Date(Date.now() + delay * 60_000);
    }

    const deliverInDm = !channelId;
    if (deliverInDm && !config.allowDm) {
      return { ok: false, message: 'Les rappels en message privé sont désactivés.' };
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
    return { ok: true, message: `Rappel programmé pour le ${dueAt.toLocaleString('fr-FR')}.` };
  },
};

export const remindersActions: ModuleAction[] = [create];
