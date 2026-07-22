import { defineModule } from '../../core/module.js';
import { MODULE_NAME, logsConfigSchema, logsDefaultConfig } from './config.js';
import { clear } from './commands.js';
import { logsComponent } from './component.js';
import { logsPanel } from './panel.js';
import {
  onChannelCreate,
  onChannelDelete,
  onChannelUpdate,
  onGuildMemberAdd,
  onGuildMemberRemove,
  onMessageBulkDelete,
  onMessageCreate,
  onMessageDelete,
  onMessageUpdate,
  onRoleCreate,
  onRoleDelete,
  onRoleUpdate,
} from './events.js';
import { snapshotPruneTask } from './task.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.logs.label',
  descriptionKey: 'modules.logs.description',
  configSchema: logsConfigSchema,
  defaultConfig: logsDefaultConfig,
  configUI: [
    {
      fields: [
        {
          key: 'logChannelId',
          label: 'Salon des logs',
          type: 'channel',
          help: 'Où sont publiés les journaux du serveur.',
        },
        { key: 'messages', label: 'Journaliser les messages', type: 'boolean' },
        { key: 'members', label: 'Journaliser les membres (arrivées/départs)', type: 'boolean' },
        { key: 'channels', label: 'Journaliser les salons', type: 'boolean' },
        { key: 'roles', label: 'Journaliser les rôles', type: 'boolean' },
        { key: 'moderation', label: 'Journaliser la modération', type: 'boolean' },
      ],
    },
  ],
  configPanel: logsPanel,
  componentHandler: logsComponent,
  commands: [clear],
  events: [
    onMessageCreate,
    onMessageDelete,
    onMessageBulkDelete,
    onMessageUpdate,
    onGuildMemberAdd,
    onGuildMemberRemove,
    onChannelCreate,
    onChannelDelete,
    onChannelUpdate,
    onRoleCreate,
    onRoleDelete,
    onRoleUpdate,
  ],
  tasks: [snapshotPruneTask],
});
