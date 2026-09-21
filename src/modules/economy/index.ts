import { defineModule } from '../../core/module.js';
import { MODULE_NAME, economyConfigSchema, economyDefaultConfig } from './config.js';
import { boutique, economyComponent } from './shop.js';
import { argentAdmin, daily, payer, riches, solde } from './commands.js';
import { onMessage } from './events.js';
import { leaderboardTask, voiceMoneyTask } from './task.js';

/**
 * Module « Économie » : monnaie virtuelle par serveur, gains par message et
 * récompense quotidienne, transferts, classement, boutique de rôles et gestion
 * administrative des soldes. Configuration via le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.economy.label',
  descriptionKey: 'modules.economy.description',
  category: 'engagement',
  emoji: '\u{1FA99}',
  configSchema: economyConfigSchema,
  defaultConfig: economyDefaultConfig,
  configUI: [
    {
      label: '💰 Général',
      fields: [
        { key: 'currencyName', label: 'Nom de la monnaie', type: 'text' },
        { key: 'currencySymbol', label: 'Symbole de la monnaie', type: 'text' },
        { key: 'messageMin', label: 'Gain minimum par message', type: 'number' },
        { key: 'messageMax', label: 'Gain maximum par message', type: 'number' },
        { key: 'messageCooldown', label: 'Cooldown entre gains (s)', type: 'number' },
        { key: 'dailyAmount', label: 'Montant de la commande /daily', type: 'number' },
        { key: 'voiceEnabled', label: 'Gains en vocal', type: 'boolean' },
        { key: 'voicePerMinute', label: 'Gain par minute en vocal', type: 'number' },
        { key: 'ignoredChannelIds', label: 'Salons ignorés', type: 'channels' },
        { key: 'ignoredRoleIds', label: 'Rôles ignorés', type: 'roles' },
        { key: 'leaderboardChannelId', label: 'Salon du classement', type: 'channel' },
      ],
    },
    {
      label: '🏪 Boutiques de rôles',
      description: 'Chaque boutique vend des rôles contre la monnaie du serveur.',
      fields: [
        {
          key: 'shops',
          label: 'Boutiques',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter une boutique',
          item: [
            { key: 'name', label: 'Nom de la boutique', type: 'text' },
            { key: 'bannerUrl', label: 'Bannière (URL)', type: 'text' },
            {
              key: 'items',
              label: 'Rôles en vente',
              type: 'list',
              addLabel: 'Ajouter un rôle',
              item: [
                { key: 'roleId', label: 'Rôle', type: 'role' },
                { key: 'price', label: 'Prix', type: 'number' },
                { key: 'stock', label: 'Stock (-1 = illimité)', type: 'number', default: -1 },
              ],
            },
          ],
        },
      ],
    },
  ],
  componentHandler: economyComponent,
  commands: [solde, daily, payer, riches, boutique, argentAdmin],
  events: [onMessage],
  tasks: [voiceMoneyTask, leaderboardTask],
});
