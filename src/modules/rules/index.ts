import { defineModule } from '../../core/module.js';
import { MODULE_NAME, rulesConfigSchema, rulesDefaultConfig } from './config.js';
import { rulesPanel } from './panel.js';
import { rulesComponent } from './component.js';

/**
 * Module « Règlement » : publie le règlement du serveur dans un salon avec un
 * bouton d'acceptation qui attribue un rôle d'accès. Chaque acceptation est
 * enregistrée (table `RuleAcceptance`) avec sa version, ce qui permet de
 * demander une re-validation quand le règlement évolue. Configuration via
 * `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.rules.label',
  descriptionKey: 'modules.rules.description',
  configSchema: rulesConfigSchema,
  defaultConfig: rulesDefaultConfig,
  configUI: [
    {
      label: '📜 Règlement',
      description: 'Après modification, republie le règlement depuis Discord (/config).',
      fields: [
        { key: 'channelId', label: 'Salon du règlement', type: 'channel' },
        { key: 'roleId', label: 'Rôle d’accès (à l’acceptation)', type: 'role' },
        { key: 'title', label: 'Titre', type: 'text' },
        { key: 'content', label: 'Contenu du règlement', type: 'textarea' },
        { key: 'buttonLabel', label: 'Libellé du bouton d’acceptation', type: 'text' },
        { key: 'logChannelId', label: 'Salon des logs d’acceptation', type: 'channel' },
      ],
    },
  ],
  configPanel: rulesPanel,
  componentHandler: rulesComponent,
});
