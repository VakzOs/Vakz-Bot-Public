import { defineModule } from '../../core/module.js';
import { MODULE_NAME, itemsConfigSchema, itemsDefaultConfig } from './config.js';
import { itemsCommands } from './commands.js';
import { tempNicknameTask } from './tempnick.js';
import { itemsRoutes } from './routes.js';

/**
 * Module « Objets & inventaires » : catalogue d'objets par serveur, achat avec
 * la monnaie du serveur, utilisation (rôle-récompense optionnel), échange entre
 * membres et gestion administrative. Catalogue géré depuis le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.items.label',
  descriptionKey: 'modules.items.description',
  webPaths: ['app/dashboard/[guildId]/catalogue'],
  httpRoutes: itemsRoutes,
  category: 'fun',
  emoji: '\u{1F392}',
  configSchema: itemsConfigSchema,
  defaultConfig: itemsDefaultConfig,
  configUI: [
    {
      description: 'La création des objets se fait dans l’onglet « Catalogue » du serveur.',
      fields: [
        {
          key: 'tradingEnabled',
          label: 'Autoriser l’échange d’objets entre membres',
          type: 'boolean',
        },
      ],
    },
    {
      key: 'drops',
      label: '🎁 Butin dans les mini-jeux',
      description:
        'Fait tomber des objets « droppable » à la fin des mini-jeux (PFC, morpion, bataille navale), avec un pourcentage par rareté. On tire de la plus rare à la plus commune.',
      fields: [
        { key: 'enabled', label: 'Activer les drops', type: 'boolean' },
        {
          key: 'on',
          label: 'Quand tirer un drop',
          type: 'select',
          options: [
            { value: 'win', label: 'Victoire seulement' },
            { value: 'winDraw', label: 'Victoire et égalité' },
            { value: 'any', label: 'Chaque partie (peu importe l’issue)' },
          ],
        },
        { key: 'common', label: '% drop — Commun (0-100)', type: 'number' },
        { key: 'rare', label: '% drop — Rare (0-100)', type: 'number' },
        { key: 'epic', label: '% drop — Épique (0-100)', type: 'number' },
        { key: 'legendary', label: '% drop — Légendaire (0-100)', type: 'number' },
      ],
    },
    {
      key: 'sell',
      label: '🗑️ Vente rapide au serveur',
      description:
        'Permet à un membre de vendre un objet au serveur via /vendre : l’objet est détruit et le membre reçoit un pourcentage de son prix boutique.',
      fields: [
        { key: 'enabled', label: 'Activer la vente rapide (/vendre)', type: 'boolean' },
        { key: 'percent', label: '% du prix reversé à la vente (0-100)', type: 'number' },
      ],
    },
  ],
  commands: itemsCommands,
  tasks: [tempNicknameTask],
});
