import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, welcomeConfigSchema, welcomeDefaultConfig } from './config.js';
import { onMemberAdd, onMemberRemove } from './events.js';

/**
 * Module « Arrivées & départs » : messages de bienvenue et d'au revoir
 * configurables (salon, texte avec variables, embed) par serveur.
 *
 * Toute la configuration se fait depuis le dashboard
 * (sélecteurs de salon, boutons, modal de message). Nécessite l'intent
 * privilégié `GuildMembers` (Server Members Intent).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.welcome.label',
  descriptionKey: 'modules.welcome.description',
  category: 'community',
  emoji: '\u{1F44B}',
  configSchema: welcomeConfigSchema,
  defaultConfig: welcomeDefaultConfig,
  configUI: () => [
    {
      key: 'welcome',
      label: t('modules.welcome.ui.welcome.label'),
      description: t('modules.welcome.ui.welcome.description'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.welcome.ui.welcome.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.welcome.ui.welcome.champs.enabled.help'),
        },
        {
          key: 'channelId',
          label: t('modules.welcome.ui.welcome.champs.channelId.label'),
          type: 'channel',
          help: t('modules.welcome.ui.welcome.champs.channelId.help'),
        },
        {
          key: 'message',
          label: t('modules.welcome.ui.welcome.champs.message.label'),
          type: 'textarea',
          help: t('modules.welcome.ui.welcome.champs.message.help'),
        },
        {
          key: 'embed',
          label: t('modules.welcome.ui.welcome.champs.embed.label'),
          type: 'boolean',
          help: t('modules.welcome.ui.welcome.champs.embed.help'),
        },
        {
          key: 'footer',
          label: t('modules.welcome.ui.welcome.champs.footer.label'),
          type: 'text',
          help: t('modules.welcome.ui.welcome.champs.footer.help'),
        },
        {
          key: 'card',
          label: t('modules.welcome.ui.welcome.champs.card.label'),
          type: 'boolean',
          help: t('modules.welcome.ui.welcome.champs.card.help'),
        },
        {
          key: 'cardBackground',
          label: t('modules.welcome.ui.welcome.champs.cardBackground.label'),
          type: 'text',
          help: t('modules.welcome.ui.welcome.champs.cardBackground.help'),
          placeholder: t('modules.welcome.ui.welcome.champs.cardBackground.placeholder'),
        },
      ],
    },
    {
      key: 'leave',
      label: t('modules.welcome.ui.leave.label'),
      description: t('modules.welcome.ui.leave.description'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.welcome.ui.leave.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.welcome.ui.leave.champs.enabled.help'),
        },
        {
          key: 'channelId',
          label: t('modules.welcome.ui.leave.champs.channelId.label'),
          type: 'channel',
          help: t('modules.welcome.ui.leave.champs.channelId.help'),
        },
        {
          key: 'message',
          label: t('modules.welcome.ui.leave.champs.message.label'),
          type: 'textarea',
          help: t('modules.welcome.ui.leave.champs.message.help'),
        },
        {
          key: 'embed',
          label: t('modules.welcome.ui.leave.champs.embed.label'),
          type: 'boolean',
          help: t('modules.welcome.ui.leave.champs.embed.help'),
        },
        {
          key: 'footer',
          label: t('modules.welcome.ui.leave.champs.footer.label'),
          type: 'text',
          help: t('modules.welcome.ui.leave.champs.footer.help'),
        },
        {
          key: 'card',
          label: t('modules.welcome.ui.leave.champs.card.label'),
          type: 'boolean',
          help: t('modules.welcome.ui.leave.champs.card.help'),
        },
        {
          key: 'cardBackground',
          label: t('modules.welcome.ui.leave.champs.cardBackground.label'),
          type: 'text',
          help: t('modules.welcome.ui.leave.champs.cardBackground.help'),
          placeholder: t('modules.welcome.ui.leave.champs.cardBackground.placeholder'),
        },
      ],
    },
  ],
  events: [onMemberAdd, onMemberRemove],
});
