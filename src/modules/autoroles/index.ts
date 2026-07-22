import { defineModule } from '../../core/module.js';
import { MODULE_NAME, autorolesConfigSchema, autorolesDefaultConfig } from './config.js';
import { autorolesPanel } from './panel.js';
import { onMemberAdd, onVoiceStateUpdate } from './events.js';

/**
 * Module « Rôles automatiques » : attribue des rôles à l'arrivée d'un membre
 * (liste pour les humains, liste séparée pour les bots) et un « rôle en vocal »
 * tant qu'un membre est connecté à un salon vocal. Configuration via le panneau
 * `/config`. Réutilise les intents GuildMembers et GuildVoiceStates (déjà actifs).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.autoroles.label',
  descriptionKey: 'modules.autoroles.description',
  configSchema: autorolesConfigSchema,
  defaultConfig: autorolesDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'roleIds', label: 'Rôles attribués aux membres à l’arrivée', type: 'roles' },
        { key: 'botRoleIds', label: 'Rôles attribués aux bots', type: 'roles' },
        { key: 'voiceRoleIds', label: 'Rôles pendant la présence en vocal', type: 'roles' },
      ],
    },
  ],
  configPanel: autorolesPanel,
  events: [onMemberAdd, onVoiceStateUpdate],
});
