import { defineModule } from '../../core/module.js';
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
  configUI: [
    {
      label: '⚙️ Panneau',
      description: 'Après modification, republie le panneau avec le bouton « Publier ».',
      fields: [
        { key: 'channelId', label: 'Salon du panneau', type: 'channel' },
        { key: 'title', label: 'Titre', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
      ],
    },
    {
      label: '🎭 Rôles proposés',
      fields: [
        {
          key: 'roles',
          label: 'Rôles',
          type: 'list',
          addLabel: 'Ajouter un rôle',
          item: [
            { key: 'roleId', label: 'Rôle', type: 'role' },
            { key: 'label', label: 'Libellé du bouton', type: 'text' },
            { key: 'emoji', label: 'Emoji', type: 'text' },
          ],
        },
      ],
    },
  ],
  events: [onReactionAdd, onReactionRemove],
});
