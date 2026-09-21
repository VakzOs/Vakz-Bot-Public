import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { interactiveMessagesActions } from './actions.js';
import {
  MODULE_NAME,
  interactiveMessagesConfigSchema,
  interactiveMessagesDefaultConfig,
} from './config.js';
import { interactiveMessagesComponent } from './component.js';

/**
 * Module « Messages interactifs » : compose des embeds réutilisables (titre,
 * description, couleur) publiés dans un salon, accompagnés de boutons de rôle
 * (clic = ajout/retrait du rôle) et de boutons lien. Tout se configure via le
 * dashboard ; aucune table dédiée (config JSON par serveur).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.interactivemessages.label',
  descriptionKey: 'modules.interactivemessages.description',
  category: 'community',
  emoji: '\u{1F9E9}',
  configSchema: interactiveMessagesConfigSchema,
  defaultConfig: interactiveMessagesDefaultConfig,
  configUI: () => [
    {
      label: t('modules.interactivemessages.ui.g0.label'),
      description: t('modules.interactivemessages.ui.g0.description'),
      fields: [
        {
          key: 'panels',
          label: t('modules.interactivemessages.ui.g0.champs.panels.label'),
          type: 'list',
          help: t('modules.interactivemessages.ui.g0.champs.panels.help'),
          idKey: 'id',
          addLabel: t('modules.interactivemessages.ui.g0.champs.panels.addLabel'),
          item: [
            {
              key: 'name',
              label: t('modules.interactivemessages.ui.g0.champs.panels.item.name.label'),
              type: 'text',
            },
            {
              key: 'channelId',
              label: t('modules.interactivemessages.ui.g0.champs.panels.item.channelId.label'),
              type: 'channel',
            },
            {
              key: 'title',
              label: t('modules.interactivemessages.ui.g0.champs.panels.item.title.label'),
              type: 'text',
            },
            {
              key: 'description',
              label: t('modules.interactivemessages.ui.g0.champs.panels.item.description.label'),
              type: 'textarea',
            },
            {
              key: 'buttons',
              label: t('modules.interactivemessages.ui.g0.champs.panels.item.buttons.label'),
              type: 'list',
              idKey: 'id',
              addLabel: t('modules.interactivemessages.ui.g0.champs.panels.item.buttons.addLabel'),
              item: [
                {
                  key: 'type',
                  label: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.type.label',
                  ),
                  type: 'select',
                  default: 'role',
                  options: [
                    {
                      value: 'role',
                      label: t(
                        'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.type.opt.role.label',
                      ),
                    },
                    {
                      value: 'link',
                      label: t(
                        'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.type.opt.link.label',
                      ),
                    },
                  ],
                },
                {
                  key: 'label',
                  label: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.label.label',
                  ),
                  type: 'text',
                },
                {
                  key: 'emoji',
                  label: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.emoji.label',
                  ),
                  type: 'text',
                },
                {
                  key: 'roleId',
                  label: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.roleId.label',
                  ),
                  type: 'role',
                },
                {
                  key: 'url',
                  label: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.url.label',
                  ),
                  type: 'text',
                  placeholder: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.url.placeholder',
                  ),
                },
                {
                  key: 'style',
                  label: t(
                    'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.style.label',
                  ),
                  type: 'select',
                  default: 'secondary',
                  options: [
                    {
                      value: 'primary',
                      label: t(
                        'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.style.opt.primary.label',
                      ),
                    },
                    {
                      value: 'secondary',
                      label: t(
                        'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.style.opt.secondary.label',
                      ),
                    },
                    {
                      value: 'success',
                      label: t(
                        'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.style.opt.success.label',
                      ),
                    },
                    {
                      value: 'danger',
                      label: t(
                        'modules.interactivemessages.ui.g0.champs.panels.item.buttons.item.style.opt.danger.label',
                      ),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  actions: interactiveMessagesActions,
  componentHandler: interactiveMessagesComponent,
});
