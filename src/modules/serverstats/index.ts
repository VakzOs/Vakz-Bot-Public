import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { serverstatsActions } from './actions.js';
import {
  COUNTER_TYPES,
  counterTypeLabel,
  MODULE_NAME,
  type ServerstatsConfig,
  serverstatsConfigSchema,
  serverstatsDefaultConfig,
  updateServerstatsConfig,
} from './config.js';
import { serverstatsTask } from './task.js';
import { defaultTemplateFor, updateAllGuilds } from './service.js';

/**
 * Module « Compteurs de serveur » : des salons vocaux dont le nom affiche une
 * statistique (membres, humains, bots, boosts, rôles, salons, ou membres d'un
 * rôle) et se met à jour toutes les 10 minutes.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.serverstats.label',
  descriptionKey: 'modules.serverstats.description',
  category: 'operations',
  emoji: '\u{1F4CA}',
  configSchema: serverstatsConfigSchema,
  defaultConfig: serverstatsDefaultConfig,
  configUI: () => [
    {
      label: t('modules.serverstats.ui.g0.label'),
      description: t('modules.serverstats.ui.g0.description'),
      fields: [
        {
          key: 'counters',
          label: t('modules.serverstats.ui.g0.champs.counters.label'),
          type: 'list',
          help: t('modules.serverstats.ui.g0.champs.counters.help'),
          idKey: 'id',
          addLabel: t('modules.serverstats.ui.g0.champs.counters.addLabel'),
          item: [
            {
              key: 'channelId',
              label: t('modules.serverstats.ui.g0.champs.counters.item.channelId.label'),
              type: 'voiceChannel',
            },
            {
              key: 'type',
              label: t('modules.serverstats.ui.g0.champs.counters.item.type.label'),
              type: 'select',
              options: COUNTER_TYPES.map((type) => ({
                value: type,
                label: counterTypeLabel(type),
              })),
            },
            {
              key: 'roleId',
              label: t('modules.serverstats.ui.g0.champs.counters.item.roleId.label'),
              type: 'role',
            },
            {
              key: 'template',
              label: t('modules.serverstats.ui.g0.champs.counters.item.template.label'),
              type: 'text',
              default: '{count}',
              help: t('modules.serverstats.ui.g0.champs.counters.item.template.help'),
            },
          ],
        },
      ],
    },
  ],
  actions: serverstatsActions,
  tasks: [serverstatsTask],
  async onConfigSaved(ctx, guildId, config, previous) {
    // Un compteur tout juste créé garde le modèle générique « {count} » : on lui
    // pose le libellé localisé de son type (« 👥 Membres : {count} »).
    const next = config as ServerstatsConfig;
    const known = new Set((previous as ServerstatsConfig).counters.map((c) => c.id));
    let changed = false;
    const counters = next.counters.map((counter) => {
      if (known.has(counter.id) || counter.template !== '{count}') return counter;
      changed = true;
      return { ...counter, template: defaultTemplateFor(counter.type) };
    });
    if (changed) await updateServerstatsConfig(ctx, guildId, { counters });
  },
  async onLoad(ctx) {
    await updateAllGuilds(ctx);
  },
});
