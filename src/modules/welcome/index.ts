import { defineModule } from '../../core/module.js';
import { MODULE_NAME, welcomeConfigSchema, welcomeDefaultConfig } from './config.js';
import { welcomePanel } from './panel.js';
import { onMemberAdd, onMemberRemove } from './events.js';

/**
 * Module « Arrivées & départs » : messages de bienvenue et d'au revoir
 * configurables (salon, texte avec variables, embed) par serveur.
 *
 * Toute la configuration se fait via le panneau interactif de `/config`
 * (sélecteurs de salon, boutons, modal de message). Nécessite l'intent
 * privilégié `GuildMembers` (Server Members Intent).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.welcome.label',
  descriptionKey: 'modules.welcome.description',
  configSchema: welcomeConfigSchema,
  defaultConfig: welcomeDefaultConfig,
  configUI: [
    {
      key: 'welcome',
      label: '👋 Message de bienvenue',
      description:
        'Variables : {mention}, {username}, {server}, {count}. Envoyé à l’arrivée d’un membre.',
      fields: [
        { key: 'enabled', label: 'Activer le message de bienvenue', type: 'boolean' },
        { key: 'channelId', label: 'Salon', type: 'channel' },
        { key: 'message', label: 'Message', type: 'textarea' },
        { key: 'embed', label: 'Afficher en embed', type: 'boolean' },
        { key: 'footer', label: 'Pied de page (embed)', type: 'text' },
        { key: 'card', label: 'Carte-image (avatar + nom)', type: 'boolean' },
        {
          key: 'cardBackground',
          label: 'Image de fond de la carte (URL)',
          type: 'text',
          placeholder: 'https://…',
        },
      ],
    },
    {
      key: 'leave',
      label: '🚪 Message d’au revoir',
      description: 'Variables : {username}, {server}. Envoyé au départ d’un membre.',
      fields: [
        { key: 'enabled', label: 'Activer le message d’au revoir', type: 'boolean' },
        { key: 'channelId', label: 'Salon', type: 'channel' },
        { key: 'message', label: 'Message', type: 'textarea' },
        { key: 'embed', label: 'Afficher en embed', type: 'boolean' },
        { key: 'footer', label: 'Pied de page (embed)', type: 'text' },
        { key: 'card', label: 'Carte-image (avatar + nom)', type: 'boolean' },
        {
          key: 'cardBackground',
          label: 'Image de fond de la carte (URL)',
          type: 'text',
          placeholder: 'https://…',
        },
      ],
    },
  ],
  configPanel: welcomePanel,
  events: [onMemberAdd, onMemberRemove],
});
