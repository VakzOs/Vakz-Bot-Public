import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, routeConfigSchema, routeDefaultConfig } from './config.js';
import { routeCommands } from './commands.js';
import { routeComponent } from './shop.js';

/**
 * Module « Route de l'Infini » : une aventure solo façon DraftBot. `/route
 * avancer` déclenche un événement aléatoire (trésor, monstre, tempête…) qui
 * modifie les points de vie, l'énergie, la distance et les pièces du voyageur.
 * Les pièces alimentent l'économie et les objets trouvés l'inventaire.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.route.label',
  descriptionKey: 'modules.route.description',
  category: 'fun',
  emoji: '\u{1F9ED}',
  configSchema: routeConfigSchema,
  defaultConfig: routeDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'cooldownMinutes',
          label: t('modules.route.ui.g0.champs.cooldownMinutes.label'),
          type: 'number',
          help: t('modules.route.ui.g0.champs.cooldownMinutes.help'),
        },
        {
          key: 'giveCoins',
          label: t('modules.route.ui.g0.champs.giveCoins.label'),
          type: 'boolean',
          help: t('modules.route.ui.g0.champs.giveCoins.help'),
        },
        {
          key: 'giveItems',
          label: t('modules.route.ui.g0.champs.giveItems.label'),
          type: 'boolean',
          help: t('modules.route.ui.g0.champs.giveItems.help'),
        },
        {
          key: 'energyRegenRate',
          label: t('modules.route.ui.g0.champs.energyRegenRate.label'),
          type: 'number',
          help: t('modules.route.ui.g0.champs.energyRegenRate.help'),
        },
        {
          key: 'energyRegenCap',
          label: t('modules.route.ui.g0.champs.energyRegenCap.label'),
          type: 'number',
          help: t('modules.route.ui.g0.champs.energyRegenCap.help'),
        },
      ],
    },
    {
      label: t('modules.route.ui.g1.label'),
      description: t('modules.route.ui.g1.description'),
      fields: [
        {
          key: 'missedGiftTaunt',
          label: t('modules.route.ui.g1.champs.missedGiftTaunt.label'),
          type: 'boolean',
          help: t('modules.route.ui.g1.champs.missedGiftTaunt.help'),
        },
        {
          key: 'missedGiftMessages',
          label: t('modules.route.ui.g1.champs.missedGiftMessages.label'),
          type: 'textarea',
          help: t('modules.route.ui.g1.champs.missedGiftMessages.help'),
          placeholder: t('modules.route.ui.g1.champs.missedGiftMessages.placeholder'),
        },
      ],
    },
    {
      key: 'drops',
      label: t('modules.route.ui.drops.label'),
      description: t('modules.route.ui.drops.description'),
      fields: [
        {
          key: 'common',
          label: t('modules.route.ui.drops.champs.common.label'),
          type: 'number',
          help: t('modules.route.ui.drops.champs.common.help'),
        },
        {
          key: 'rare',
          label: t('modules.route.ui.drops.champs.rare.label'),
          type: 'number',
          help: t('modules.route.ui.drops.champs.rare.help'),
        },
        {
          key: 'epic',
          label: t('modules.route.ui.drops.champs.epic.label'),
          type: 'number',
          help: t('modules.route.ui.drops.champs.epic.help'),
        },
        {
          key: 'legendary',
          label: t('modules.route.ui.drops.champs.legendary.label'),
          type: 'number',
          help: t('modules.route.ui.drops.champs.legendary.help'),
        },
      ],
    },
    {
      key: 'shopPrices',
      label: t('modules.route.ui.shopPrices.label'),
      description: t('modules.route.ui.shopPrices.description'),
      fields: [
        {
          key: 'potion',
          label: t('modules.route.ui.shopPrices.champs.potion.label'),
          type: 'number',
          help: t('modules.route.ui.shopPrices.champs.potion.help'),
        },
        {
          key: 'tonic',
          label: t('modules.route.ui.shopPrices.champs.tonic.label'),
          type: 'number',
          help: t('modules.route.ui.shopPrices.champs.tonic.help'),
        },
        {
          key: 'ration',
          label: t('modules.route.ui.shopPrices.champs.ration.label'),
          type: 'number',
          help: t('modules.route.ui.shopPrices.champs.ration.help'),
        },
      ],
    },
    {
      key: 'peddlerPrices',
      label: t('modules.route.ui.peddlerPrices.label'),
      description: t('modules.route.ui.peddlerPrices.description'),
      fields: [
        {
          key: 'potion',
          label: t('modules.route.ui.peddlerPrices.champs.potion.label'),
          type: 'number',
          help: t('modules.route.ui.peddlerPrices.champs.potion.help'),
        },
        {
          key: 'tonic',
          label: t('modules.route.ui.peddlerPrices.champs.tonic.label'),
          type: 'number',
          help: t('modules.route.ui.peddlerPrices.champs.tonic.help'),
        },
        {
          key: 'ration',
          label: t('modules.route.ui.peddlerPrices.champs.ration.label'),
          type: 'number',
          help: t('modules.route.ui.peddlerPrices.champs.ration.help'),
        },
      ],
    },
  ],
  commands: routeCommands,
  componentHandler: routeComponent,
});
