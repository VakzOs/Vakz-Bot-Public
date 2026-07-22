import { defineModule } from '../../core/module.js';
import { MODULE_NAME, levelsConfigSchema, levelsDefaultConfig } from './config.js';
import { levelsPanel } from './panel.js';
import { classement, rang } from './commands.js';
import { onMessage } from './events.js';
import { leaderboardTask, voiceXpTask } from './task.js';

/**
 * Module « Niveaux » : gain d'XP par message (avec cooldown anti-spam), courbe
 * de niveaux, annonce de passage de niveau, rôles récompense, `/rang` et
 * `/classement`. Configuration via le panneau `/config`.
 *
 * Nécessite l'intent `GuildMessages` (non privilégié, contenu non lu).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.levels.label',
  descriptionKey: 'modules.levels.description',
  configSchema: levelsConfigSchema,
  defaultConfig: levelsDefaultConfig,
  configUI: [
    {
      label: '⚙️ Gain d’XP',
      description: 'Les récompenses de rôle par niveau restent éditables sur Discord via /config.',
      fields: [
        { key: 'xpMin', label: 'XP minimum par message', type: 'number' },
        { key: 'xpMax', label: 'XP maximum par message', type: 'number' },
        { key: 'cooldown', label: 'Cooldown entre gains (s)', type: 'number' },
        { key: 'maxLevel', label: 'Niveau maximum (0 = illimité)', type: 'number' },
        { key: 'ignoredChannelIds', label: 'Salons ignorés', type: 'channels' },
        { key: 'ignoredRoleIds', label: 'Rôles ignorés', type: 'roles' },
        { key: 'boosterRoleIds', label: 'Rôles avec bonus d’XP', type: 'roles' },
        { key: 'boosterMultiplier', label: 'Multiplicateur du bonus', type: 'number' },
        { key: 'voiceEnabled', label: 'XP en vocal', type: 'boolean' },
        { key: 'voiceXpPerMinute', label: 'XP par minute en vocal', type: 'number' },
        { key: 'leaderboardChannelId', label: 'Salon du classement', type: 'channel' },
      ],
    },
    {
      key: 'announce',
      label: '📣 Annonce de passage de niveau',
      fields: [
        { key: 'enabled', label: 'Activer l’annonce', type: 'boolean' },
        {
          key: 'channelId',
          label: 'Salon (vide = salon du message)',
          type: 'channel',
        },
        {
          key: 'message',
          label: 'Message',
          type: 'textarea',
          help: 'Variables : {mention}, {level}.',
        },
      ],
    },
  ],
  configPanel: levelsPanel,
  commands: [rang, classement],
  events: [onMessage],
  tasks: [voiceXpTask, leaderboardTask],
});
