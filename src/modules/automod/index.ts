import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { automodActions } from './actions.js';
import { automodConfigSchema, automodDefaultConfig, MODULE_NAME } from './config.js';
import { onMessage } from './events.js';

export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.automod.label',
  descriptionKey: 'modules.automod.description',
  category: 'security',
  emoji: '\u{1F6E1}\u{FE0F}',
  configSchema: automodConfigSchema,
  defaultConfig: automodDefaultConfig,
  configUI: () => [
    {
      label: t('modules.automod.ui.g0.label'),
      description: t('modules.automod.ui.g0.description'),
      fields: [
        {
          key: 'logChannelId',
          label: t('modules.automod.ui.g0.champs.logChannelId.label'),
          type: 'channel',
          help: t('modules.automod.ui.g0.champs.logChannelId.help'),
        },
        {
          key: 'ignoredChannelIds',
          label: t('modules.automod.ui.g0.champs.ignoredChannelIds.label'),
          type: 'channels',
          help: t('modules.automod.ui.g0.champs.ignoredChannelIds.help'),
        },
        {
          key: 'ignoredRoleIds',
          label: t('modules.automod.ui.g0.champs.ignoredRoleIds.label'),
          type: 'roles',
          help: t('modules.automod.ui.g0.champs.ignoredRoleIds.help'),
        },
      ],
    },
    {
      key: 'spam',
      label: t('modules.automod.ui.spam.label'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.automod.ui.spam.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.automod.ui.spam.champs.enabled.help'),
        },
        {
          key: 'action',
          label: t('modules.automod.ui.spam.champs.action.label'),
          type: 'select',
          help: t('modules.automod.ui.spam.champs.action.help'),
          options: [
            { value: 'delete', label: t('modules.automod.ui.spam.champs.action.opt.delete.label') },
            { value: 'warn', label: t('modules.automod.ui.spam.champs.action.opt.warn.label') },
            {
              value: 'timeout',
              label: t('modules.automod.ui.spam.champs.action.opt.timeout.label'),
            },
            { value: 'kick', label: t('modules.automod.ui.spam.champs.action.opt.kick.label') },
            { value: 'ban', label: t('modules.automod.ui.spam.champs.action.opt.ban.label') },
          ],
        },
        {
          key: 'maxMessages',
          label: t('modules.automod.ui.spam.champs.maxMessages.label'),
          type: 'number',
          help: t('modules.automod.ui.spam.champs.maxMessages.help'),
        },
        {
          key: 'windowSeconds',
          label: t('modules.automod.ui.spam.champs.windowSeconds.label'),
          type: 'number',
          help: t('modules.automod.ui.spam.champs.windowSeconds.help'),
        },
        {
          key: 'timeoutMinutes',
          label: t('modules.automod.ui.spam.champs.timeoutMinutes.label'),
          type: 'number',
          help: t('modules.automod.ui.spam.champs.timeoutMinutes.help'),
        },
      ],
    },
    {
      key: 'invites',
      label: t('modules.automod.ui.invites.label'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.automod.ui.invites.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.automod.ui.invites.champs.enabled.help'),
        },
        {
          key: 'action',
          label: t('modules.automod.ui.invites.champs.action.label'),
          type: 'select',
          help: t('modules.automod.ui.invites.champs.action.help'),
          options: [
            {
              value: 'delete',
              label: t('modules.automod.ui.invites.champs.action.opt.delete.label'),
            },
            { value: 'warn', label: t('modules.automod.ui.invites.champs.action.opt.warn.label') },
            {
              value: 'timeout',
              label: t('modules.automod.ui.invites.champs.action.opt.timeout.label'),
            },
            { value: 'kick', label: t('modules.automod.ui.invites.champs.action.opt.kick.label') },
            { value: 'ban', label: t('modules.automod.ui.invites.champs.action.opt.ban.label') },
          ],
        },
      ],
    },
    {
      key: 'mentions',
      label: t('modules.automod.ui.mentions.label'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.automod.ui.mentions.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.automod.ui.mentions.champs.enabled.help'),
        },
        {
          key: 'action',
          label: t('modules.automod.ui.mentions.champs.action.label'),
          type: 'select',
          help: t('modules.automod.ui.mentions.champs.action.help'),
          options: [
            {
              value: 'delete',
              label: t('modules.automod.ui.mentions.champs.action.opt.delete.label'),
            },
            { value: 'warn', label: t('modules.automod.ui.mentions.champs.action.opt.warn.label') },
            {
              value: 'timeout',
              label: t('modules.automod.ui.mentions.champs.action.opt.timeout.label'),
            },
            { value: 'kick', label: t('modules.automod.ui.mentions.champs.action.opt.kick.label') },
            { value: 'ban', label: t('modules.automod.ui.mentions.champs.action.opt.ban.label') },
          ],
        },
        {
          key: 'maxMentions',
          label: t('modules.automod.ui.mentions.champs.maxMentions.label'),
          type: 'number',
          help: t('modules.automod.ui.mentions.champs.maxMentions.help'),
        },
        {
          key: 'timeoutMinutes',
          label: t('modules.automod.ui.mentions.champs.timeoutMinutes.label'),
          type: 'number',
          help: t('modules.automod.ui.mentions.champs.timeoutMinutes.help'),
        },
      ],
    },
    {
      key: 'caps',
      label: t('modules.automod.ui.caps.label'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.automod.ui.caps.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.automod.ui.caps.champs.enabled.help'),
        },
        {
          key: 'action',
          label: t('modules.automod.ui.caps.champs.action.label'),
          type: 'select',
          help: t('modules.automod.ui.caps.champs.action.help'),
          options: [
            { value: 'delete', label: t('modules.automod.ui.caps.champs.action.opt.delete.label') },
            { value: 'warn', label: t('modules.automod.ui.caps.champs.action.opt.warn.label') },
            {
              value: 'timeout',
              label: t('modules.automod.ui.caps.champs.action.opt.timeout.label'),
            },
            { value: 'kick', label: t('modules.automod.ui.caps.champs.action.opt.kick.label') },
            { value: 'ban', label: t('modules.automod.ui.caps.champs.action.opt.ban.label') },
          ],
        },
        {
          key: 'minLength',
          label: t('modules.automod.ui.caps.champs.minLength.label'),
          type: 'number',
          help: t('modules.automod.ui.caps.champs.minLength.help'),
        },
        {
          key: 'percent',
          label: t('modules.automod.ui.caps.champs.percent.label'),
          type: 'number',
          help: t('modules.automod.ui.caps.champs.percent.help'),
        },
      ],
    },
  ],
  actions: automodActions,
  events: [onMessage],
});
