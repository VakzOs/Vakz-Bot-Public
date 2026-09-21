import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, marketConfigSchema, marketDefaultConfig } from './config.js';
import { hdv } from './commands.js';
import { marketComponent } from './component.js';

/**
 * Module « Hôtel des ventes » : les membres mettent des objets en vente à leur
 * prix, visibles de tous (`/hdv parcourir`), et s'achètent entre eux. Les objets
 * mis en vente sont séquestrés (retirés de l'inventaire) jusqu'à l'achat ou
 * l'annulation. Taxe serveur, plafond d'annonces et prix minimum réglables.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.market.label',
  descriptionKey: 'modules.market.description',
  category: 'fun',
  emoji: '\u{1F3EA}',
  configSchema: marketConfigSchema,
  defaultConfig: marketDefaultConfig,
  configUI: () => [
    {
      description: t('modules.market.ui.g0.description'),
      fields: [
        {
          key: 'taxPercent',
          label: t('modules.market.ui.g0.champs.taxPercent.label'),
          type: 'number',
          help: t('modules.market.ui.g0.champs.taxPercent.help'),
        },
        {
          key: 'maxListingsPerUser',
          label: t('modules.market.ui.g0.champs.maxListingsPerUser.label'),
          type: 'number',
          help: t('modules.market.ui.g0.champs.maxListingsPerUser.help'),
        },
        {
          key: 'minPrice',
          label: t('modules.market.ui.g0.champs.minPrice.label'),
          type: 'number',
          help: t('modules.market.ui.g0.champs.minPrice.help'),
        },
        {
          key: 'minPricePercent',
          label: t('modules.market.ui.g0.champs.minPricePercent.label'),
          type: 'number',
          help: t('modules.market.ui.g0.champs.minPricePercent.help'),
        },
      ],
    },
  ],
  componentHandler: marketComponent,
  commands: [hdv],
});
