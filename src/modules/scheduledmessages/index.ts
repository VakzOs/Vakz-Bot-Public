import { defineModule } from '../../core/module.js';
import {
  MODULE_NAME,
  scheduledmessagesConfigSchema,
  scheduledmessagesDefaultConfig,
} from './config.js';
import { scheduledmessagesPanel } from './panel.js';
import { scheduledmessagesTask } from './task.js';

/**
 * Module « Messages récurrents » : publie automatiquement des messages (texte ou
 * embed) dans un salon selon une cadence — quotidienne, hebdomadaire ou toutes
 * les N heures. Une tâche vérifie chaque minute les échéances. Les heures sont
 * exprimées dans le fuseau du bot (`TZ`). Configuration via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.scheduledmessages.label',
  descriptionKey: 'modules.scheduledmessages.description',
  configSchema: scheduledmessagesConfigSchema,
  defaultConfig: scheduledmessagesDefaultConfig,
  configUI: [
    {
      label: '🔁 Messages récurrents',
      description: 'Heures dans le fuseau du bot (Europe/Paris).',
      fields: [
        {
          key: 'messages',
          label: 'Messages',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un message',
          item: [
            { key: 'channelId', label: 'Salon', type: 'channel' },
            { key: 'content', label: 'Contenu', type: 'textarea' },
            { key: 'asEmbed', label: 'En embed', type: 'boolean' },
            {
              key: 'schedule.type',
              label: 'Cadence',
              type: 'select',
              default: 'daily',
              options: [
                { value: 'daily', label: 'Tous les jours' },
                { value: 'weekly', label: 'Chaque semaine' },
                { value: 'interval', label: 'Toutes les X heures' },
              ],
            },
            {
              key: 'schedule.time',
              label: 'Heure (HH:MM) — quotidien / hebdo',
              type: 'text',
              default: '12:00',
              placeholder: '12:00',
            },
            {
              key: 'schedule.weekday',
              label: 'Jour — hebdo (0 = dimanche … 6 = samedi)',
              type: 'number',
              default: 1,
            },
            {
              key: 'schedule.hours',
              label: 'Intervalle en heures — type « toutes les X heures »',
              type: 'number',
              default: 24,
            },
          ],
        },
      ],
    },
  ],
  configPanel: scheduledmessagesPanel,
  tasks: [scheduledmessagesTask],
});
