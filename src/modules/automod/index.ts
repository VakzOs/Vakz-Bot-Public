import { defineModule } from '../../core/module.js';
import { automodConfigSchema, automodDefaultConfig, MODULE_NAME } from './config.js';
import { onMessage } from './events.js';
import { automodPanel } from './panel.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.automod.label',
  descriptionKey: 'modules.automod.description',
  configSchema: automodConfigSchema,
  defaultConfig: automodDefaultConfig,
  configUI: [
    {
      label: '⚙️ Général',
      description:
        'Listes de mots/domaines autorisés et honeypot : édition détaillée sur Discord via /config.',
      fields: [
        { key: 'logChannelId', label: 'Salon des logs automod', type: 'channel' },
        { key: 'ignoredChannelIds', label: 'Salons ignorés', type: 'channels' },
        { key: 'ignoredRoleIds', label: 'Rôles ignorés', type: 'roles' },
      ],
    },
    {
      key: 'spam',
      label: '🚫 Anti-spam',
      fields: [
        { key: 'enabled', label: 'Activer', type: 'boolean' },
        {
          key: 'action',
          label: 'Sanction',
          type: 'select',
          options: [
            { value: 'delete', label: 'Supprimer' },
            { value: 'warn', label: 'Avertir' },
            { value: 'timeout', label: 'Timeout' },
            { value: 'kick', label: 'Expulser' },
            { value: 'ban', label: 'Bannir' },
          ],
        },
        { key: 'maxMessages', label: 'Messages max', type: 'number' },
        { key: 'windowSeconds', label: 'Fenêtre (s)', type: 'number' },
        { key: 'timeoutMinutes', label: 'Timeout (min)', type: 'number' },
      ],
    },
    {
      key: 'invites',
      label: '🔗 Anti-invitations Discord',
      fields: [
        { key: 'enabled', label: 'Activer', type: 'boolean' },
        {
          key: 'action',
          label: 'Sanction',
          type: 'select',
          options: [
            { value: 'delete', label: 'Supprimer' },
            { value: 'warn', label: 'Avertir' },
            { value: 'timeout', label: 'Timeout' },
            { value: 'kick', label: 'Expulser' },
            { value: 'ban', label: 'Bannir' },
          ],
        },
      ],
    },
    {
      key: 'mentions',
      label: '📢 Anti-mentions massives',
      fields: [
        { key: 'enabled', label: 'Activer', type: 'boolean' },
        {
          key: 'action',
          label: 'Sanction',
          type: 'select',
          options: [
            { value: 'delete', label: 'Supprimer' },
            { value: 'warn', label: 'Avertir' },
            { value: 'timeout', label: 'Timeout' },
            { value: 'kick', label: 'Expulser' },
            { value: 'ban', label: 'Bannir' },
          ],
        },
        { key: 'maxMentions', label: 'Mentions max', type: 'number' },
        { key: 'timeoutMinutes', label: 'Timeout (min)', type: 'number' },
      ],
    },
    {
      key: 'caps',
      label: '🔠 Anti-majuscules',
      fields: [
        { key: 'enabled', label: 'Activer', type: 'boolean' },
        {
          key: 'action',
          label: 'Sanction',
          type: 'select',
          options: [
            { value: 'delete', label: 'Supprimer' },
            { value: 'warn', label: 'Avertir' },
            { value: 'timeout', label: 'Timeout' },
            { value: 'kick', label: 'Expulser' },
            { value: 'ban', label: 'Bannir' },
          ],
        },
        { key: 'minLength', label: 'Longueur minimale du message', type: 'number' },
        { key: 'percent', label: '% de majuscules déclencheur', type: 'number' },
      ],
    },
  ],
  configPanel: automodPanel,
  events: [onMessage],
});
