import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
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
  configUI: () => [
    {
      label: t('modules.economy.ui.g0.label'),
      fields: [
        {
          key: 'currencyName',
          label: t('modules.economy.ui.g0.champs.currencyName.label'),
          type: 'text',
          help: t('modules.economy.ui.g0.champs.currencyName.help'),
        },
        {
          key: 'currencySymbol',
          label: t('modules.economy.ui.g0.champs.currencySymbol.label'),
          type: 'text',
          help: t('modules.economy.ui.g0.champs.currencySymbol.help'),
        },
        {
          key: 'messageMin',
          label: t('modules.economy.ui.g0.champs.messageMin.label'),
          type: 'number',
          help: t('modules.economy.ui.g0.champs.messageMin.help'),
        },
        {
          key: 'messageMax',
          label: t('modules.economy.ui.g0.champs.messageMax.label'),
          type: 'number',
          help: t('modules.economy.ui.g0.champs.messageMax.help'),
        },
        {
          key: 'messageCooldown',
          label: t('modules.economy.ui.g0.champs.messageCooldown.label'),
          type: 'number',
          help: t('modules.economy.ui.g0.champs.messageCooldown.help'),
        },
        {
          key: 'dailyAmount',
          label: t('modules.economy.ui.g0.champs.dailyAmount.label'),
          type: 'number',
          help: t('modules.economy.ui.g0.champs.dailyAmount.help'),
        },
        {
          key: 'voiceEnabled',
          label: t('modules.economy.ui.g0.champs.voiceEnabled.label'),
          type: 'boolean',
          help: t('modules.economy.ui.g0.champs.voiceEnabled.help'),
        },
        {
          key: 'voicePerMinute',
          label: t('modules.economy.ui.g0.champs.voicePerMinute.label'),
          type: 'number',
          help: t('modules.economy.ui.g0.champs.voicePerMinute.help'),
        },
        {
          key: 'ignoredChannelIds',
          label: t('modules.economy.ui.g0.champs.ignoredChannelIds.label'),
          type: 'channels',
          help: t('modules.economy.ui.g0.champs.ignoredChannelIds.help'),
        },
        {
          key: 'ignoredRoleIds',
          label: t('modules.economy.ui.g0.champs.ignoredRoleIds.label'),
          type: 'roles',
          help: t('modules.economy.ui.g0.champs.ignoredRoleIds.help'),
        },
        {
          key: 'leaderboardChannelId',
          label: t('modules.economy.ui.g0.champs.leaderboardChannelId.label'),
          type: 'channel',
          help: t('modules.economy.ui.g0.champs.leaderboardChannelId.help'),
        },
      ],
    },
    {
      label: t('modules.economy.ui.g1.label'),
      description: t('modules.economy.ui.g1.description'),
      fields: [
        {
          key: 'shops',
          label: t('modules.economy.ui.g1.champs.shops.label'),
          type: 'list',
          help: t('modules.economy.ui.g1.champs.shops.help'),
          idKey: 'id',
          addLabel: t('modules.economy.ui.g1.champs.shops.addLabel'),
          item: [
            {
              key: 'name',
              label: t('modules.economy.ui.g1.champs.shops.item.name.label'),
              type: 'text',
            },
            {
              key: 'bannerUrl',
              label: t('modules.economy.ui.g1.champs.shops.item.bannerUrl.label'),
              type: 'text',
            },
            {
              key: 'items',
              label: t('modules.economy.ui.g1.champs.shops.item.items.label'),
              type: 'list',
              addLabel: t('modules.economy.ui.g1.champs.shops.item.items.addLabel'),
              item: [
                {
                  key: 'roleId',
                  label: t('modules.economy.ui.g1.champs.shops.item.items.item.roleId.label'),
                  type: 'role',
                },
                {
                  key: 'price',
                  label: t('modules.economy.ui.g1.champs.shops.item.items.item.price.label'),
                  type: 'number',
                },
                {
                  key: 'stock',
                  label: t('modules.economy.ui.g1.champs.shops.item.items.item.stock.label'),
                  type: 'number',
                  default: -1,
                },
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
