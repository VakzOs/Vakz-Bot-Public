import { defineModule } from '../../core/module.js';
import { MODULE_NAME, verificationConfigSchema, verificationDefaultConfig } from './config.js';
import { verificationPanel } from './panel.js';
import { verificationComponent } from './component.js';

/**
 * Module « Vérification » : porte d'entrée anti-bot. Un message publié dans un
 * salon d'accueil propose un bouton « Se vérifier » qui, selon la méthode
 * choisie, attribue directement le **rôle vérifié** (simple clic) ou impose un
 * **captcha image** à recopier avant de l'accorder. Le rôle vérifié débloque
 * l'accès au reste du serveur (à combiner avec les permissions de salons).
 * Configuration via `/config` ; aucune donnée persistée (le rôle fait foi).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.verification.label',
  descriptionKey: 'modules.verification.description',
  configSchema: verificationConfigSchema,
  defaultConfig: verificationDefaultConfig,
  configUI: [
    {
      label: '🔐 Vérification',
      description: 'Après modification, republie le panneau depuis Discord (/config).',
      fields: [
        { key: 'channelId', label: 'Salon de vérification', type: 'channel' },
        { key: 'roleId', label: 'Rôle attribué une fois vérifié', type: 'role' },
        {
          key: 'method',
          label: 'Méthode',
          type: 'select',
          options: [
            { value: 'button', label: 'Simple bouton' },
            { value: 'captcha', label: 'Captcha image' },
          ],
        },
        { key: 'title', label: 'Titre', type: 'text' },
        { key: 'content', label: 'Contenu', type: 'textarea' },
        { key: 'buttonLabel', label: 'Libellé du bouton', type: 'text' },
        { key: 'logChannelId', label: 'Salon des logs', type: 'channel' },
      ],
    },
  ],
  configPanel: verificationPanel,
  componentHandler: verificationComponent,
});
