import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, rulesConfigSchema, rulesDefaultConfig } from './config.js';
import { rulesComponent } from './component.js';
import { publishRules } from './service.js';
import type { RulesConfig } from './config.js';

/**
 * Module « Règlement » : publie le règlement du serveur dans un salon avec un
 * bouton d'acceptation qui attribue un rôle d'accès. Chaque acceptation est
 * enregistrée (table `RuleAcceptance`) avec sa version, ce qui permet de
 * demander une re-validation quand le règlement évolue. Configuration via
 * le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.rules.label',
  descriptionKey: 'modules.rules.description',
  publishPanel: (guild, config) => publishRules(guild, config as RulesConfig),
  category: 'security',
  emoji: '\u{1F4D8}',
  configSchema: rulesConfigSchema,
  defaultConfig: rulesDefaultConfig,
  configUI: () => [
    {
      label: t('modules.rules.ui.g0.label'),
      description: t('modules.rules.ui.g0.description'),
      fields: [
        {
          key: 'channelId',
          label: t('modules.rules.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.rules.ui.g0.champs.channelId.help'),
        },
        {
          key: 'roleId',
          label: t('modules.rules.ui.g0.champs.roleId.label'),
          type: 'role',
          help: t('modules.rules.ui.g0.champs.roleId.help'),
        },
        {
          key: 'title',
          label: t('modules.rules.ui.g0.champs.title.label'),
          type: 'text',
          help: t('modules.rules.ui.g0.champs.title.help'),
        },
        {
          key: 'content',
          label: t('modules.rules.ui.g0.champs.content.label'),
          type: 'textarea',
          help: t('modules.rules.ui.g0.champs.content.help'),
        },
        {
          key: 'buttonLabel',
          label: t('modules.rules.ui.g0.champs.buttonLabel.label'),
          type: 'text',
          help: t('modules.rules.ui.g0.champs.buttonLabel.help'),
        },
        {
          key: 'logChannelId',
          label: t('modules.rules.ui.g0.champs.logChannelId.label'),
          type: 'channel',
          help: t('modules.rules.ui.g0.champs.logChannelId.help'),
        },
      ],
    },
  ],
  componentHandler: rulesComponent,
});
