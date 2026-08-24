import { defineModule } from '../../core/module.js';
import { MODULE_NAME, routeConfigSchema, routeDefaultConfig } from './config.js';
import { routeCommands } from './commands.js';
import { routePanel } from './panel.js';
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
  configSchema: routeConfigSchema,
  defaultConfig: routeDefaultConfig,
  configUI: [
    {
      fields: [
        { key: 'cooldownMinutes', label: 'Cooldown (minutes)', type: 'number' },
        { key: 'giveCoins', label: 'Donner des pièces', type: 'boolean' },
        { key: 'giveItems', label: 'Donner des objets', type: 'boolean' },
        { key: 'energyRegenRate', label: 'Régénération énergie (par minute)', type: 'number' },
        { key: 'energyRegenCap', label: 'Plafond de régénération énergie', type: 'number' },
      ],
    },
    {
      key: 'drops',
      label: '🎁 Drops de la Route (barème propre)',
      description:
        'Chances de drop par rareté, propres à la Route et indépendantes de celles des mini-jeux. Sur un événement « marchand », on tire de la plus rare à la plus commune ; seuls les objets « Drop en jeu » peuvent tomber.',
      fields: [
        { key: 'common', label: '% drop — Commun (0-100)', type: 'number' },
        { key: 'rare', label: '% drop — Rare (0-100)', type: 'number' },
        { key: 'epic', label: '% drop — Épique (0-100)', type: 'number' },
        { key: 'legendary', label: '% drop — Légendaire (0-100)', type: 'number' },
      ],
    },
    {
      key: 'shopPrices',
      label: '🧳 Prix boutique (/route boutique)',
      description: "Prix d'achat des provisions, payés avec le solde du module Économie.",
      fields: [
        { key: 'potion', label: '🧪 Potion de soin (+40 PV)', type: 'number' },
        { key: 'tonic', label: '⚡ Tonique d’énergie (+50 ⚡)', type: 'number' },
        { key: 'ration', label: '🍖 Ration de voyage (+15 PV, +20 ⚡)', type: 'number' },
      ],
    },
    {
      key: 'peddlerPrices',
      label: '🪙 Prix de revente (marchand ambulant)',
      description:
        "Prix auxquels l'événement marchand ambulant rachète les provisions des voyageurs.",
      fields: [
        { key: 'potion', label: '🧪 Potion de soin', type: 'number' },
        { key: 'tonic', label: '⚡ Tonique d’énergie', type: 'number' },
        { key: 'ration', label: '🍖 Ration de voyage', type: 'number' },
      ],
    },
  ],
  configPanel: routePanel,
  commands: routeCommands,
  componentHandler: routeComponent,
});
