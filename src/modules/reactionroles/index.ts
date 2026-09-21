import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, reactionRolesConfigSchema, reactionRolesDefaultConfig } from './config.js';
import { onReactionAdd, onReactionRemove } from './events.js';
import { publishMenu } from './menu.js';
import type { ReactionRolesConfig } from './config.js';

/**
 * Module « Rôles-réactions » (façon DraftBot) : un embed est publié dans un
 * salon, le bot y pose une réaction par rôle, et réagir attribue le rôle
 * (retirer la réaction le retire). Configuration via le dashboard.
 * Aucune table dédiée (config JSON) ; utilise l'intent Réactions de messages.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.reactionroles.label',
  descriptionKey: 'modules.reactionroles.description',
  publishPanel: (guild, config) => publishMenu(guild, config as ReactionRolesConfig),
  category: 'community',
  emoji: '\u{1F3AD}',
  configSchema: reactionRolesConfigSchema,
  defaultConfig: reactionRolesDefaultConfig,
  configUI: () => [
    {
      label: t('modules.reactionroles.ui.g0.label'),
      description: t('modules.reactionroles.ui.g0.description'),
      fields: [
        {
          key: 'channelId',
          label: t('modules.reactionroles.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.reactionroles.ui.g0.champs.channelId.help'),
        },
        {
          key: 'title',
          label: t('modules.reactionroles.ui.g0.champs.title.label'),
          type: 'text',
          help: t('modules.reactionroles.ui.g0.champs.title.help'),
        },
        {
          key: 'description',
          label: t('modules.reactionroles.ui.g0.champs.description.label'),
          type: 'textarea',
          help: t('modules.reactionroles.ui.g0.champs.description.help'),
        },
      ],
    },
    {
      label: t('modules.reactionroles.ui.g1.label'),
      fields: [
        {
          key: 'roles',
          label: t('modules.reactionroles.ui.g1.champs.roles.label'),
          type: 'list',
          help: t('modules.reactionroles.ui.g1.champs.roles.help'),
          addLabel: t('modules.reactionroles.ui.g1.champs.roles.addLabel'),
          item: [
            {
              key: 'roleId',
              label: t('modules.reactionroles.ui.g1.champs.roles.item.roleId.label'),
              type: 'role',
            },
            {
              key: 'label',
              label: t('modules.reactionroles.ui.g1.champs.roles.item.label.label'),
              type: 'text',
            },
            {
              key: 'emoji',
              label: t('modules.reactionroles.ui.g1.champs.roles.item.emoji.label'),
              type: 'text',
            },
          ],
        },
      ],
    },
  ],
  events: [onReactionAdd, onReactionRemove],
});
