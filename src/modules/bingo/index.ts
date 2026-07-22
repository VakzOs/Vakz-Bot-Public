import { defineModule } from '../../core/module.js';
import { MODULE_NAME, bingoConfigSchema, bingoDefaultConfig } from './config.js';
import { bingoCommands, bingoComponent } from './commands.js';

/**
 * Module « Bingo » : une partie par serveur. Le staff démarre (`/bingo
 * demarrer`), les membres prennent un carton (`/bingo rejoindre`), le staff
 * tire les numéros (`/bingo tirer`) ; le bot détecte la ligne ou le carton
 * plein gagnant. Grille 5×5 (1-75), centre libre, carton rendu en image.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.bingo.label',
  descriptionKey: 'modules.bingo.description',
  configSchema: bingoConfigSchema,
  defaultConfig: bingoDefaultConfig,
  configUI: [
    {
      fields: [
        {
          key: 'defaultMode',
          label: 'Mode de victoire par défaut',
          type: 'select',
          options: [
            { value: 'line', label: 'Une ligne' },
            { value: 'full', label: 'Grille complète' },
          ],
        },
      ],
    },
  ],
  commands: bingoCommands,
  componentHandler: bingoComponent,
});
