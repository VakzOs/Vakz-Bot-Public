import { defineModule } from '../../core/module.js';
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
  configUI: [
    {
      label: '🧩 Messages interactifs',
      description: 'Après modification, republie le message avec l’action « Publier un message ».',
      fields: [
        {
          key: 'panels',
          label: 'Messages',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un message',
          item: [
            { key: 'name', label: 'Nom (interne)', type: 'text' },
            { key: 'channelId', label: 'Salon de publication', type: 'channel' },
            { key: 'title', label: 'Titre de l’embed', type: 'text' },
            { key: 'description', label: 'Description de l’embed', type: 'textarea' },
            {
              key: 'buttons',
              label: 'Boutons',
              type: 'list',
              idKey: 'id',
              addLabel: 'Ajouter un bouton',
              item: [
                {
                  key: 'type',
                  label: 'Type',
                  type: 'select',
                  default: 'role',
                  options: [
                    { value: 'role', label: 'Rôle (ajout/retrait au clic)' },
                    { value: 'link', label: 'Lien (ouvre une URL)' },
                  ],
                },
                { key: 'label', label: 'Texte du bouton', type: 'text' },
                { key: 'emoji', label: 'Emoji', type: 'text' },
                { key: 'roleId', label: 'Rôle (si type « Rôle »)', type: 'role' },
                {
                  key: 'url',
                  label: 'URL (si type « Lien »)',
                  type: 'text',
                  placeholder: 'https://…',
                },
                {
                  key: 'style',
                  label: 'Style',
                  type: 'select',
                  default: 'secondary',
                  options: [
                    { value: 'primary', label: 'Bleu' },
                    { value: 'secondary', label: 'Gris' },
                    { value: 'success', label: 'Vert' },
                    { value: 'danger', label: 'Rouge' },
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
