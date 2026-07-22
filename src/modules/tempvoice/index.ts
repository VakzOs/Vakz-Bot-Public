import { defineModule } from '../../core/module.js';
import { MODULE_NAME, tempvoiceConfigSchema, tempvoiceDefaultConfig } from './config.js';
import { voc } from './commands.js';
import { tempvoiceComponent } from './component.js';
import { onVoiceStateUpdate } from './events.js';
import { tempvoicePanel } from './panel.js';
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
  configSchema: tempvoiceConfigSchema,
  defaultConfig: tempvoiceDefaultConfig,
  configUI: [
    {
      fields: [
        {
          key: 'showControlPanel',
          label: 'Afficher le panneau de contrôle dans les salons créés',
          type: 'boolean',
        },
      ],
    },
    {
      label: '🔊 Hubs (salons créateurs)',
      description: 'Rejoindre un hub crée automatiquement un salon vocal temporaire.',
      fields: [
        {
          key: 'hubs',
          label: 'Hubs',
          type: 'list',
          addLabel: 'Ajouter un hub',
          item: [
            { key: 'channelId', label: 'Salon créateur (vocal)', type: 'voiceChannel' },
            { key: 'categoryId', label: 'Catégorie des salons créés', type: 'category' },
            {
              key: 'nameTemplate',
              label: 'Modèle de nom',
              type: 'text',
              help: 'Ex. « Salon de {user} ».',
            },
            { key: 'userLimit', label: 'Limite d’utilisateurs (0 = aucune)', type: 'number' },
            { key: 'lockedByDefault', label: 'Verrouillé par défaut', type: 'boolean' },
            { key: 'inheritPermissions', label: 'Hériter des permissions du hub', type: 'boolean' },
          ],
        },
      ],
    },
  ],
  configPanel: tempvoicePanel,
  componentHandler: tempvoiceComponent,
  commands: [voc],
  events: [onVoiceStateUpdate],
  tasks: [tempvoiceCleanupTask],
  async onLoad(ctx) {
    await cleanupOrphans(ctx);
  },
});
