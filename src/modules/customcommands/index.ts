import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, customcommandsConfigSchema, customcommandsDefaultConfig } from './config.js';
import { onMessage } from './events.js';

/**
 * Module « Commandes personnalisées » : des auto-réponses déclenchées par le
 * contenu des messages. Un admin définit un déclencheur (contient / exact /
 * commence / finit par), une réponse (texte ou embed avec variables
 * `{user} {username} {server} {channel}`), éventuellement limitée à un salon,
 * avec un délai anti-spam et la suppression du message déclencheur.
 * Configuration via le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.customcommands.label',
  descriptionKey: 'modules.customcommands.description',
  category: 'engagement',
  emoji: '\u{1F5E3}\u{FE0F}',
  configSchema: customcommandsConfigSchema,
  defaultConfig: customcommandsDefaultConfig,
  configUI: () => [
    {
      label: t('modules.customcommands.ui.g0.label'),
      fields: [
        {
          key: 'commands',
          label: t('modules.customcommands.ui.g0.champs.commands.label'),
          type: 'list',
          help: t('modules.customcommands.ui.g0.champs.commands.help'),
          idKey: 'id',
          addLabel: t('modules.customcommands.ui.g0.champs.commands.addLabel'),
          item: [
            {
              key: 'trigger',
              label: t('modules.customcommands.ui.g0.champs.commands.item.trigger.label'),
              type: 'text',
            },
            {
              key: 'match',
              label: t('modules.customcommands.ui.g0.champs.commands.item.match.label'),
              type: 'select',
              options: [
                {
                  value: 'contains',
                  label: t(
                    'modules.customcommands.ui.g0.champs.commands.item.match.opt.contains.label',
                  ),
                },
                {
                  value: 'exact',
                  label: t(
                    'modules.customcommands.ui.g0.champs.commands.item.match.opt.exact.label',
                  ),
                },
                {
                  value: 'startsWith',
                  label: t(
                    'modules.customcommands.ui.g0.champs.commands.item.match.opt.startsWith.label',
                  ),
                },
                {
                  value: 'endsWith',
                  label: t(
                    'modules.customcommands.ui.g0.champs.commands.item.match.opt.endsWith.label',
                  ),
                },
              ],
            },
            {
              key: 'response',
              label: t('modules.customcommands.ui.g0.champs.commands.item.response.label'),
              type: 'textarea',
            },
            {
              key: 'asEmbed',
              label: t('modules.customcommands.ui.g0.champs.commands.item.asEmbed.label'),
              type: 'boolean',
            },
            {
              key: 'channelId',
              label: t('modules.customcommands.ui.g0.champs.commands.item.channelId.label'),
              type: 'channel',
            },
            {
              key: 'deleteTrigger',
              label: t('modules.customcommands.ui.g0.champs.commands.item.deleteTrigger.label'),
              type: 'boolean',
            },
            {
              key: 'cooldown',
              label: t('modules.customcommands.ui.g0.champs.commands.item.cooldown.label'),
              type: 'number',
            },
          ],
        },
      ],
    },
  ],
  events: [onMessage],
});
