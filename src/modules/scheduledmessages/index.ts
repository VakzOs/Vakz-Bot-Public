import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { scheduledmessagesActions } from './actions.js';
import {
  MODULE_NAME,
  type ScheduledmessagesConfig,
  scheduledmessagesConfigSchema,
  scheduledmessagesDefaultConfig,
  updateScheduledmessagesConfig,
} from './config.js';
import { primeNewMessages } from './service.js';
import { scheduledmessagesTask } from './task.js';

/**
 * Module « Messages récurrents » : publie automatiquement des messages (texte ou
 * embed) dans un salon selon une cadence — quotidienne, hebdomadaire ou toutes
 * les N heures. Une tâche vérifie chaque minute les échéances. Les heures sont
 * exprimées dans le fuseau du bot (`TZ`). Configuration via le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.scheduledmessages.label',
  descriptionKey: 'modules.scheduledmessages.description',
  category: 'operations',
  emoji: '\u{1F4C5}',
  configSchema: scheduledmessagesConfigSchema,
  defaultConfig: scheduledmessagesDefaultConfig,
  configUI: () => [
    {
      label: t('modules.scheduledmessages.ui.g0.label'),
      description: t('modules.scheduledmessages.ui.g0.description'),
      fields: [
        {
          key: 'messages',
          label: t('modules.scheduledmessages.ui.g0.champs.messages.label'),
          type: 'list',
          help: t('modules.scheduledmessages.ui.g0.champs.messages.help'),
          idKey: 'id',
          addLabel: t('modules.scheduledmessages.ui.g0.champs.messages.addLabel'),
          item: [
            {
              key: 'channelId',
              label: t('modules.scheduledmessages.ui.g0.champs.messages.item.channelId.label'),
              type: 'channel',
            },
            {
              key: 'content',
              label: t('modules.scheduledmessages.ui.g0.champs.messages.item.content.label'),
              type: 'textarea',
            },
            {
              key: 'asEmbed',
              label: t('modules.scheduledmessages.ui.g0.champs.messages.item.asEmbed.label'),
              type: 'boolean',
            },
            {
              key: 'schedule.type',
              label: t('modules.scheduledmessages.ui.g0.champs.messages.item.schedule.type.label'),
              type: 'select',
              default: 'daily',
              options: [
                {
                  value: 'daily',
                  label: t(
                    'modules.scheduledmessages.ui.g0.champs.messages.item.schedule.type.opt.daily.label',
                  ),
                },
                {
                  value: 'weekly',
                  label: t(
                    'modules.scheduledmessages.ui.g0.champs.messages.item.schedule.type.opt.weekly.label',
                  ),
                },
                {
                  value: 'interval',
                  label: t(
                    'modules.scheduledmessages.ui.g0.champs.messages.item.schedule.type.opt.interval.label',
                  ),
                },
              ],
            },
            {
              key: 'schedule.time',
              label: t('modules.scheduledmessages.ui.g0.champs.messages.item.schedule.time.label'),
              type: 'text',
              default: '12:00',
              placeholder: t(
                'modules.scheduledmessages.ui.g0.champs.messages.item.schedule.time.placeholder',
              ),
            },
            {
              key: 'schedule.weekday',
              label: t(
                'modules.scheduledmessages.ui.g0.champs.messages.item.schedule.weekday.label',
              ),
              type: 'number',
              default: 1,
            },
            {
              key: 'schedule.hours',
              label: t('modules.scheduledmessages.ui.g0.champs.messages.item.schedule.hours.label'),
              type: 'number',
              default: 24,
            },
          ],
        },
      ],
    },
  ],
  actions: scheduledmessagesActions,
  tasks: [scheduledmessagesTask],
  async onConfigSaved(ctx, guildId, config, previous) {
    const messages = primeNewMessages(
      config as ScheduledmessagesConfig,
      previous as ScheduledmessagesConfig,
    );
    if (messages) await updateScheduledmessagesConfig(ctx, guildId, { messages });
  },
});
