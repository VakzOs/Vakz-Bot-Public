import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, levelsConfigSchema, levelsDefaultConfig } from './config.js';
import { classement, rang } from './commands.js';
import { onMessage } from './events.js';
import { leaderboardTask, voiceXpTask } from './task.js';

/**
 * Module « Niveaux » : gain d'XP par message (avec cooldown anti-spam), courbe
 * de niveaux, annonce de passage de niveau, rôles récompense, `/rang` et
 * `/classement`. Configuration via le dashboard.
 *
 * Nécessite l'intent `GuildMessages` (non privilégié, contenu non lu).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.levels.label',
  descriptionKey: 'modules.levels.description',
  category: 'engagement',
  emoji: '\u{1F4C8}',
  configSchema: levelsConfigSchema,
  defaultConfig: levelsDefaultConfig,
  configUI: () => [
    {
      label: t('modules.levels.ui.g0.label'),
      description: t('modules.levels.ui.g0.description'),
      fields: [
        {
          key: 'xpMin',
          label: t('modules.levels.ui.g0.champs.xpMin.label'),
          type: 'number',
          help: t('modules.levels.ui.g0.champs.xpMin.help'),
        },
        {
          key: 'xpMax',
          label: t('modules.levels.ui.g0.champs.xpMax.label'),
          type: 'number',
          help: t('modules.levels.ui.g0.champs.xpMax.help'),
        },
        {
          key: 'cooldown',
          label: t('modules.levels.ui.g0.champs.cooldown.label'),
          type: 'number',
          help: t('modules.levels.ui.g0.champs.cooldown.help'),
        },
        {
          key: 'maxLevel',
          label: t('modules.levels.ui.g0.champs.maxLevel.label'),
          type: 'number',
          help: t('modules.levels.ui.g0.champs.maxLevel.help'),
        },
        {
          key: 'ignoredChannelIds',
          label: t('modules.levels.ui.g0.champs.ignoredChannelIds.label'),
          type: 'channels',
          help: t('modules.levels.ui.g0.champs.ignoredChannelIds.help'),
        },
        {
          key: 'ignoredRoleIds',
          label: t('modules.levels.ui.g0.champs.ignoredRoleIds.label'),
          type: 'roles',
          help: t('modules.levels.ui.g0.champs.ignoredRoleIds.help'),
        },
        {
          key: 'boosterRoleIds',
          label: t('modules.levels.ui.g0.champs.boosterRoleIds.label'),
          type: 'roles',
          help: t('modules.levels.ui.g0.champs.boosterRoleIds.help'),
        },
        {
          key: 'boosterMultiplier',
          label: t('modules.levels.ui.g0.champs.boosterMultiplier.label'),
          type: 'number',
          help: t('modules.levels.ui.g0.champs.boosterMultiplier.help'),
        },
        {
          key: 'voiceEnabled',
          label: t('modules.levels.ui.g0.champs.voiceEnabled.label'),
          type: 'boolean',
          help: t('modules.levels.ui.g0.champs.voiceEnabled.help'),
        },
        {
          key: 'voiceXpPerMinute',
          label: t('modules.levels.ui.g0.champs.voiceXpPerMinute.label'),
          type: 'number',
          help: t('modules.levels.ui.g0.champs.voiceXpPerMinute.help'),
        },
        {
          key: 'leaderboardChannelId',
          label: t('modules.levels.ui.g0.champs.leaderboardChannelId.label'),
          type: 'channel',
          help: t('modules.levels.ui.g0.champs.leaderboardChannelId.help'),
        },
      ],
    },
    {
      label: t('modules.levels.ui.g1.label'),
      description: t('modules.levels.ui.g1.description'),
      fields: [
        {
          key: 'rewards',
          label: t('modules.levels.ui.g1.champs.rewards.label'),
          type: 'list',
          help: t('modules.levels.ui.g1.champs.rewards.help'),
          addLabel: t('modules.levels.ui.g1.champs.rewards.addLabel'),
          item: [
            {
              key: 'level',
              label: t('modules.levels.ui.g1.champs.rewards.item.level.label'),
              type: 'number',
              default: 1,
            },
            {
              key: 'roleId',
              label: t('modules.levels.ui.g1.champs.rewards.item.roleId.label'),
              type: 'role',
            },
          ],
        },
      ],
    },
    {
      key: 'announce',
      label: t('modules.levels.ui.announce.label'),
      description: t('modules.levels.ui.announce.description'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.levels.ui.announce.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.levels.ui.announce.champs.enabled.help'),
        },
        {
          key: 'channelId',
          label: t('modules.levels.ui.announce.champs.channelId.label'),
          type: 'channel',
          help: t('modules.levels.ui.announce.champs.channelId.help'),
        },
        {
          key: 'message',
          label: t('modules.levels.ui.announce.champs.message.label'),
          type: 'textarea',
          help: t('modules.levels.ui.announce.champs.message.help'),
        },
      ],
    },
  ],
  commands: [rang, classement],
  events: [onMessage],
  tasks: [voiceXpTask, leaderboardTask],
});
