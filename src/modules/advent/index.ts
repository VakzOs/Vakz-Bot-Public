import { defineModule } from '../../core/module.js';
import { adventActions } from './actions.js';
import { MODULE_NAME, adventConfigSchema, adventDefaultConfig } from './config.js';
import { advent } from './commands.js';
import { adventAnnounceTask } from './task.js';

/**
 * Module « Calendrier de l'Avent » (saisonnier) : du 1er au 24 décembre, chaque
 * membre ouvre une porte par jour via `/avent ouvrir` et gagne des pièces et/ou
 * un objet configurés par jour (repli sur des pièces par défaut). `/avent
 * calendrier` affiche la progression. Annonce quotidienne optionnelle.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.advent.label',
  descriptionKey: 'modules.advent.description',
  category: 'engagement',
  emoji: '\u{1F384}',
  configSchema: adventConfigSchema,
  defaultConfig: adventDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'announceChannelId', label: 'Salon des annonces', type: 'channel' },
        { key: 'defaultCoins', label: 'Pièces par défaut par jour', type: 'number' },
        { key: 'testMode', label: 'Mode test (ouvre toutes les cases)', type: 'boolean' },
      ],
    },
    {
      label: '🎁 Récompenses jour par jour',
      description:
        'Une ligne par porte à personnaliser. Les jours absents de la liste offrent les pièces par défaut.',
      fields: [
        {
          key: 'rewards',
          label: 'Portes personnalisées',
          type: 'list',
          addLabel: 'Ajouter un jour',
          item: [
            { key: 'day', label: 'Jour (1 à 25)', type: 'number', default: 1 },
            { key: 'coins', label: 'Pièces offertes', type: 'number' },
            {
              key: 'items',
              label: 'Objets offerts',
              type: 'tags',
              help: 'Identifiants d’objets du catalogue, un par puce.',
            },
            { key: 'itemQty', label: 'Quantité par objet', type: 'number', default: 1 },
            { key: 'message', label: 'Message d’ouverture', type: 'textarea' },
            { key: 'link', label: 'Lien offert (bouton)', type: 'text' },
          ],
        },
      ],
    },
  ],
  actions: adventActions,
  commands: [advent],
  tasks: [adventAnnounceTask],
});
