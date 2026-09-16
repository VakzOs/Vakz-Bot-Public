import { defineModule } from '../../core/module.js';
import { serverstatsActions } from './actions.js';
import {
  COUNTER_TYPES,
  COUNTER_TYPE_LABELS,
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
  configUI: [
    {
      label: '📊 Compteurs',
      description: 'Chaque compteur renomme un salon vocal avec une statistique du serveur.',
      fields: [
        {
          key: 'counters',
          label: 'Compteurs',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un compteur',
          item: [
            { key: 'channelId', label: 'Salon (vocal)', type: 'voiceChannel' },
            {
              key: 'type',
              label: 'Type',
              type: 'select',
              options: COUNTER_TYPES.map((type) => ({
                value: type,
                label: COUNTER_TYPE_LABELS[type],
              })),
            },
            { key: 'roleId', label: 'Rôle (type « Membres d’un rôle »)', type: 'role' },
            {
              key: 'template',
              label: 'Modèle de nom',
              type: 'text',
              default: '{count}',
              help: '{count} = valeur du compteur.',
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
