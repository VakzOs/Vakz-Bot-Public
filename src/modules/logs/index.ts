import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, logsConfigSchema, logsDefaultConfig } from './config.js';
import { clear, invitations } from './commands.js';
import { logsComponent } from './component.js';
import {
  onChannelCreate,
  onChannelDelete,
  onChannelUpdate,
  onGuildCreate,
  onGuildDelete,
  onGuildMemberAdd,
  onGuildMemberRemove,
  onInviteCreate,
  onInviteDelete,
  onMessageBulkDelete,
  onMessageCreate,
  onMessageDelete,
  onMessageUpdate,
  onRoleCreate,
  onRoleDelete,
  onRoleUpdate,
} from './events.js';
import { snapshotPruneTask } from './task.js';
import { warmAllInviteCaches, warmInviteCache } from './invites.js';
import type { LogsConfig } from './config.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.logs.label',
  descriptionKey: 'modules.logs.description',
  category: 'security',
  emoji: '\u{1F4DC}',
  configSchema: logsConfigSchema,
  defaultConfig: logsDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'logChannelId',
          label: t('modules.logs.ui.g0.champs.logChannelId.label'),
          type: 'channel',
          help: t('modules.logs.ui.g0.champs.logChannelId.help'),
        },
        {
          key: 'messages',
          label: t('modules.logs.ui.g0.champs.messages.label'),
          type: 'boolean',
          help: t('modules.logs.ui.g0.champs.messages.help'),
        },
        {
          key: 'members',
          label: t('modules.logs.ui.g0.champs.members.label'),
          type: 'boolean',
          help: t('modules.logs.ui.g0.champs.members.help'),
        },
        {
          key: 'channels',
          label: t('modules.logs.ui.g0.champs.channels.label'),
          type: 'boolean',
          help: t('modules.logs.ui.g0.champs.channels.help'),
        },
        {
          key: 'roles',
          label: t('modules.logs.ui.g0.champs.roles.label'),
          type: 'boolean',
          help: t('modules.logs.ui.g0.champs.roles.help'),
        },
        {
          key: 'moderation',
          label: t('modules.logs.ui.g0.champs.moderation.label'),
          type: 'boolean',
          help: t('modules.logs.ui.g0.champs.moderation.help'),
        },
        {
          key: 'invites',
          label: t('modules.logs.ui.g0.champs.invites.label'),
          type: 'boolean',
          help: t('modules.logs.ui.g0.champs.invites.help'),
        },
      ],
    },
  ],
  componentHandler: logsComponent,
  commands: [clear, invitations],
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
    onInviteCreate,
    onInviteDelete,
    onGuildCreate,
    onGuildDelete,
  ],
  tasks: [snapshotPruneTask],
  async onLoad(ctx) {
    // Les compteurs d'utilisation d'avant la première arrivée : sans eux, il
    // n'y a rien à quoi comparer, et la première personne à entrer après un
    // redémarrage serait « origine inconnue ».
    await warmAllInviteCaches(ctx);
  },
  async onConfigSaved(ctx, guildId, config, previous) {
    // Le suivi qu'on vient d'allumer n'a encore rien vu : sans relevé de
    // départ, la première arrivée serait « origine inconnue », et l'admin
    // conclurait que la case ne fait rien.
    const after = config as LogsConfig;
    const before = previous as LogsConfig;
    if (!after.invites || before.invites) return;
    const guild = ctx.client.guilds.cache.get(guildId);
    if (guild) await warmInviteCache(ctx, guild);
  },
});
