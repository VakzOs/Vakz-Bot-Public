import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, autorolesConfigSchema, autorolesDefaultConfig } from './config.js';
import { onMemberAdd, onVoiceStateUpdate } from './events.js';

/**
 * Module « Rôles automatiques » : attribue des rôles à l'arrivée d'un membre
 * (liste pour les humains, liste séparée pour les bots) et un « rôle en vocal »
 * tant qu'un membre est connecté à un salon vocal. Configuration via le panneau
 * le dashboard. Réutilise les intents GuildMembers et GuildVoiceStates (déjà actifs).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.autoroles.label',
  descriptionKey: 'modules.autoroles.description',
  category: 'community',
  emoji: '\u{1F3F7}\u{FE0F}',
  configSchema: autorolesConfigSchema,
  defaultConfig: autorolesDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'roleIds',
          label: t('modules.autoroles.ui.g0.champs.roleIds.label'),
          type: 'roles',
          help: t('modules.autoroles.ui.g0.champs.roleIds.help'),
        },
        {
          key: 'botRoleIds',
          label: t('modules.autoroles.ui.g0.champs.botRoleIds.label'),
          type: 'roles',
          help: t('modules.autoroles.ui.g0.champs.botRoleIds.help'),
        },
        {
          key: 'voiceRoleIds',
          label: t('modules.autoroles.ui.g0.champs.voiceRoleIds.label'),
          type: 'roles',
          help: t('modules.autoroles.ui.g0.champs.voiceRoleIds.help'),
        },
      ],
    },
  ],
  events: [onMemberAdd, onVoiceStateUpdate],
});
