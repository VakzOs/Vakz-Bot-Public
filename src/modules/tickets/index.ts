import { defineModule } from '../../core/module.js';
import { MODULE_NAME, ticketsConfigSchema, ticketsDefaultConfig } from './config.js';
import { ticketsPanel } from './panel.js';
import { ticketsComponent } from './component.js';
import { onChannelDelete } from './events.js';

/**
 * Module « Tickets » : un panneau publié propose un bouton « Ouvrir un ticket »
 * qui crée, selon le mode choisi, un salon privé (dans une catégorie) ou un fil
 * privé entre le membre et le staff. Le nom suit un format configurable
 * (`{type}`, `{number}`, `{count}`, `{user}`, `{id}`). Le ticket se ferme via un
 * bouton, ce qui archive puis supprime le salon/fil. Configuration via `/config`.
 * Le bot a besoin de « Gérer les salons » (mode salon) ou « Créer des fils
 * privés » (mode fil).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.tickets.label',
  descriptionKey: 'modules.tickets.description',
  configSchema: ticketsConfigSchema,
  defaultConfig: ticketsDefaultConfig,
  configUI: [
    {
      label: '⚙️ Général',
      description:
        'Après modification, republie le panneau depuis Discord (/config) pour rafraîchir les boutons.',
      fields: [
        { key: 'title', label: 'Titre du panneau', type: 'text' },
        { key: 'description', label: 'Description du panneau', type: 'textarea' },
        {
          key: 'panelChannelId',
          label: 'Salon du panneau',
          type: 'channel',
          help: 'Où le panneau « Ouvrir un ticket » est publié.',
        },
        {
          key: 'mode',
          label: 'Type de ticket',
          type: 'select',
          options: [
            { value: 'channel', label: 'Salon privé (catégorie)' },
            { value: 'thread', label: 'Fil privé' },
          ],
        },
        {
          key: 'categoryId',
          label: 'Catégorie des salons (mode salon)',
          type: 'category',
        },
        { key: 'archiveChannelId', label: 'Salon d’archivage des transcripts', type: 'channel' },
        {
          key: 'nameFormat',
          label: 'Format du nom',
          type: 'text',
          help: 'Variables : {type}, {number}, {count}, {user}, {id}.',
        },
        {
          key: 'maxOpen',
          label: 'Tickets ouverts simultanés / membre',
          type: 'number',
          help: 'Entre 1 et 10.',
        },
      ],
    },
    {
      label: '🎫 Types de tickets',
      description: 'Chaque type = un bouton du panneau, avec ses rôles autorisés à voir/prendre.',
      fields: [
        {
          key: 'types',
          label: 'Types',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un type',
          item: [
            { key: 'label', label: 'Libellé du bouton', type: 'text' },
            { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '🎫' },
            {
              key: 'prefix',
              label: 'Préfixe des salons',
              type: 'text',
              placeholder: 'sup',
              help: 'Ex. « sup » → sup-0001. Vide = type-pseudo.',
            },
            { key: 'roleIds', label: 'Rôles autorisés', type: 'roles' },
          ],
        },
      ],
    },
  ],
  configPanel: ticketsPanel,
  componentHandler: ticketsComponent,
  events: [onChannelDelete],
});
