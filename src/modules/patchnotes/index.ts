import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { patchnotesActions } from './actions.js';
import { PATCH_SOURCES, patchCategoryLabel } from './catalog.js';
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
  configUI: () => [
    {
      label: t('modules.patchnotes.ui.g0.label'),
      description: t('modules.patchnotes.ui.g0.description'),
      fields: [
        {
          key: 'subscriptions',
          label: t('modules.patchnotes.ui.g0.champs.subscriptions.label'),
          type: 'list',
          help: t('modules.patchnotes.ui.g0.champs.subscriptions.help'),
          idKey: 'id',
          addLabel: t('modules.patchnotes.ui.g0.champs.subscriptions.addLabel'),
          item: [
            {
              key: 'sourceId',
              label: t('modules.patchnotes.ui.g0.champs.subscriptions.item.sourceId.label'),
              type: 'select',
              options: PATCH_SOURCES.map((source) => ({
                value: source.id,
                label: `${patchCategoryLabel(source.category)} · ${source.name}`,
              })),
            },
            {
              key: 'channelId',
              label: t('modules.patchnotes.ui.g0.champs.subscriptions.item.channelId.label'),
              type: 'channel',
            },
            {
              key: 'roleId',
              label: t('modules.patchnotes.ui.g0.champs.subscriptions.item.roleId.label'),
              type: 'role',
              help: t('modules.patchnotes.ui.g0.champs.subscriptions.item.roleId.help'),
            },
          ],
        },
      ],
    },
  ],
  actions: patchnotesActions,
  tasks: [patchnotesTask],
});
