import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, starboardConfigSchema, starboardDefaultConfig } from './config.js';
import { onReactionAdd, onReactionRemove } from './events.js';

/**
 * Module « Starboard » : un message qui reçoit assez d'étoiles (⭐ par défaut)
 * est republié dans un salon dédié, avec son auteur, son contenu, son image et
 * un lien vers l'original. Le compteur se met à jour en temps réel ; sous le
 * seuil, la republication est retirée. Configuration via le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.starboard.label',
  descriptionKey: 'modules.starboard.description',
  category: 'engagement',
  emoji: '\u{2B50}',
  configSchema: starboardConfigSchema,
  defaultConfig: starboardDefaultConfig,
  configUI: () => [
    {
      label: t('modules.starboard.ui.g0.label'),
      description: t('modules.starboard.ui.g0.description'),
      fields: [
        {
          key: 'channelId',
          label: t('modules.starboard.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.starboard.ui.g0.champs.channelId.help'),
        },
        {
          key: 'emoji',
          label: t('modules.starboard.ui.g0.champs.emoji.label'),
          type: 'text',
          help: t('modules.starboard.ui.g0.champs.emoji.help'),
        },
        {
          key: 'threshold',
          label: t('modules.starboard.ui.g0.champs.threshold.label'),
          type: 'number',
          help: t('modules.starboard.ui.g0.champs.threshold.help'),
        },
        {
          key: 'ignoreBots',
          label: t('modules.starboard.ui.g0.champs.ignoreBots.label'),
          type: 'boolean',
          help: t('modules.starboard.ui.g0.champs.ignoreBots.help'),
        },
      ],
    },
  ],
  events: [onReactionAdd, onReactionRemove],
});
