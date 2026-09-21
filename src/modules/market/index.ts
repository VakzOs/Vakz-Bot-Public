import { defineModule } from '../../core/module.js';
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
  configUI: [
    {
      description:
        'Marché entre membres via /hdv. La mise en vente séquestre les objets jusqu’à l’achat ou l’annulation.',
      fields: [
        { key: 'taxPercent', label: 'Taxe serveur prélevée au vendeur (0-100 %)', type: 'number' },
        { key: 'maxListingsPerUser', label: 'Annonces actives max par membre', type: 'number' },
        { key: 'minPrice', label: 'Prix unitaire minimum absolu d’une annonce', type: 'number' },
        {
          key: 'minPricePercent',
          label: 'Prix minimum en % du prix boutique de l’objet (0-100)',
          type: 'number',
        },
      ],
    },
  ],
  componentHandler: marketComponent,
  commands: [hdv],
});
