import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, verificationConfigSchema, verificationDefaultConfig } from './config.js';
import { verificationComponent } from './component.js';
import { publishVerification } from './service.js';
import type { VerificationConfig } from './config.js';

/**
 * Module « Vérification » : porte d'entrée anti-bot. Un message publié dans un
 * salon d'accueil propose un bouton « Se vérifier » qui, selon la méthode
 * choisie, attribue directement le **rôle vérifié** (simple clic) ou impose un
 * **captcha image** à recopier avant de l'accorder. Le rôle vérifié débloque
 * l'accès au reste du serveur (à combiner avec les permissions de salons).
 * Configuration via le dashboard ; aucune donnée persistée (le rôle fait foi).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.verification.label',
  descriptionKey: 'modules.verification.description',
  publishPanel: (guild, config) => publishVerification(guild, config as VerificationConfig),
  category: 'security',
  emoji: '\u{2705}',
  configSchema: verificationConfigSchema,
  defaultConfig: verificationDefaultConfig,
  configUI: () => [
    {
      label: t('modules.verification.ui.g0.label'),
      description: t('modules.verification.ui.g0.description'),
      fields: [
        {
          key: 'channelId',
          label: t('modules.verification.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.verification.ui.g0.champs.channelId.help'),
        },
        {
          key: 'roleId',
          label: t('modules.verification.ui.g0.champs.roleId.label'),
          type: 'role',
          help: t('modules.verification.ui.g0.champs.roleId.help'),
        },
        {
          key: 'method',
          label: t('modules.verification.ui.g0.champs.method.label'),
          type: 'select',
          help: t('modules.verification.ui.g0.champs.method.help'),
          options: [
            {
              value: 'button',
              label: t('modules.verification.ui.g0.champs.method.opt.button.label'),
            },
            {
              value: 'captcha',
              label: t('modules.verification.ui.g0.champs.method.opt.captcha.label'),
            },
          ],
        },
        {
          key: 'title',
          label: t('modules.verification.ui.g0.champs.title.label'),
          type: 'text',
          help: t('modules.verification.ui.g0.champs.title.help'),
        },
        {
          key: 'content',
          label: t('modules.verification.ui.g0.champs.content.label'),
          type: 'textarea',
          help: t('modules.verification.ui.g0.champs.content.help'),
        },
        {
          key: 'buttonLabel',
          label: t('modules.verification.ui.g0.champs.buttonLabel.label'),
          type: 'text',
          help: t('modules.verification.ui.g0.champs.buttonLabel.help'),
        },
        {
          key: 'logChannelId',
          label: t('modules.verification.ui.g0.champs.logChannelId.label'),
          type: 'channel',
          help: t('modules.verification.ui.g0.champs.logChannelId.help'),
        },
      ],
    },
  ],
  componentHandler: verificationComponent,
});
