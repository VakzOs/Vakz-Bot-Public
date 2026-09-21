import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, tempvoiceConfigSchema, tempvoiceDefaultConfig } from './config.js';
import { voc } from './commands.js';
import { tempvoiceComponent } from './component.js';
import { onVoiceStateUpdate } from './events.js';
import { tempvoiceCleanupTask } from './task.js';
import { cleanupOrphans } from './service.js';

/**
 * Module « Salons vocaux temporaires » (join-to-create) : un membre rejoint un
 * salon générateur (hub) et le bot lui crée un salon vocal personnel qu'il pilote
 * via un panneau (renommer, limite, verrouiller, cacher, membres…). Le salon est
 * supprimé automatiquement dès qu'il se vide.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.tempvoice.label',
  descriptionKey: 'modules.tempvoice.description',
  category: 'operations',
  emoji: '\u{1F399}\u{FE0F}',
  configSchema: tempvoiceConfigSchema,
  defaultConfig: tempvoiceDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'showControlPanel',
          label: t('modules.tempvoice.ui.g0.champs.showControlPanel.label'),
          type: 'boolean',
          help: t('modules.tempvoice.ui.g0.champs.showControlPanel.help'),
        },
      ],
    },
    {
      label: t('modules.tempvoice.ui.g1.label'),
      description: t('modules.tempvoice.ui.g1.description'),
      fields: [
        {
          key: 'hubs',
          label: t('modules.tempvoice.ui.g1.champs.hubs.label'),
          type: 'list',
          help: t('modules.tempvoice.ui.g1.champs.hubs.help'),
          addLabel: t('modules.tempvoice.ui.g1.champs.hubs.addLabel'),
          item: [
            {
              key: 'channelId',
              label: t('modules.tempvoice.ui.g1.champs.hubs.item.channelId.label'),
              type: 'voiceChannel',
            },
            {
              key: 'categoryId',
              label: t('modules.tempvoice.ui.g1.champs.hubs.item.categoryId.label'),
              type: 'category',
            },
            {
              key: 'nameTemplate',
              label: t('modules.tempvoice.ui.g1.champs.hubs.item.nameTemplate.label'),
              type: 'text',
              help: t('modules.tempvoice.ui.g1.champs.hubs.item.nameTemplate.help'),
            },
            {
              key: 'userLimit',
              label: t('modules.tempvoice.ui.g1.champs.hubs.item.userLimit.label'),
              type: 'number',
            },
            {
              key: 'lockedByDefault',
              label: t('modules.tempvoice.ui.g1.champs.hubs.item.lockedByDefault.label'),
              type: 'boolean',
            },
            {
              key: 'inheritPermissions',
              label: t('modules.tempvoice.ui.g1.champs.hubs.item.inheritPermissions.label'),
              type: 'boolean',
            },
          ],
        },
      ],
    },
  ],
  componentHandler: tempvoiceComponent,
  commands: [voc],
  events: [onVoiceStateUpdate],
  tasks: [tempvoiceCleanupTask],
  async onLoad(ctx) {
    await cleanupOrphans(ctx);
  },
});
