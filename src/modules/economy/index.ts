import { defineModule } from '../../core/module.js';
import { MODULE_NAME, economyConfigSchema, economyDefaultConfig } from './config.js';
import { economyPanel } from './panel.js';
import { boutique, economyComponent } from './shop.js';
import { daily, eco, payer, riches, solde } from './commands.js';
import { onMessage } from './events.js';
import { leaderboardTask, voiceMoneyTask } from './task.js';

/**
 * Module « Économie » : monnaie virtuelle par serveur, gains par message et
 * récompense quotidienne, transferts, classement, boutique de rôles et gestion
 * administrative des soldes. Configuration via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.economy.label',
  descriptionKey: 'modules.economy.description',
  configSchema: economyConfigSchema,
  defaultConfig: economyDefaultConfig,
  configUI: [
    {
      label: '💰 Général',
      description: 'Les boutiques et objets de rôle restent éditables sur Discord via /config.',
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
  ],
  configPanel: economyPanel,
  componentHandler: economyComponent,
  commands: [solde, daily, payer, riches, boutique, eco],
  events: [onMessage],
  tasks: [voiceMoneyTask, leaderboardTask],
});
