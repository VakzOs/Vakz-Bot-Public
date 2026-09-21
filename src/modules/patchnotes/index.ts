import { defineModule } from '../../core/module.js';
import { patchnotesActions } from './actions.js';
import { PATCH_SOURCES } from './catalog.js';
import { MODULE_NAME, patchnotesConfigSchema, patchnotesDefaultConfig } from './config.js';
import { patchnotesTask } from './task.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.patchnotes.label',
  descriptionKey: 'modules.patchnotes.description',
  category: 'operations',
  emoji: '\u{1F4F0}',
  configSchema: patchnotesConfigSchema,
  defaultConfig: patchnotesDefaultConfig,
  configUI: [
    {
      label: 'Abonnements',
      description:
        'Une ligne par jeu ou logiciel suivi : le bot publie chaque nouvelle note de patch dans le salon choisi.',
      fields: [
        {
          key: 'subscriptions',
          label: 'Sources suivies',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter une source',
          item: [
            {
              key: 'sourceId',
              label: 'Source',
              type: 'select',
              options: PATCH_SOURCES.map((source) => ({
                value: source.id,
                label: `${source.category} · ${source.name}`,
              })),
            },
            { key: 'channelId', label: 'Salon de publication', type: 'channel' },
            {
              key: 'roleId',
              label: 'Rôle à mentionner',
              type: 'role',
              help: 'Optionnel : mentionné à chaque nouvelle note.',
            },
          ],
        },
      ],
    },
  ],
  actions: patchnotesActions,
  tasks: [patchnotesTask],
});
