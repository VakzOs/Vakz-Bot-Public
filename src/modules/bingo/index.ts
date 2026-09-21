import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
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
  category: 'fun',
  emoji: '\u{1F3B0}',
  configSchema: bingoConfigSchema,
  defaultConfig: bingoDefaultConfig,
  configUI: () => [
    {
      fields: [
        {
          key: 'defaultMode',
          label: t('modules.bingo.ui.g0.champs.defaultMode.label'),
          type: 'select',
          help: t('modules.bingo.ui.g0.champs.defaultMode.help'),
          options: [
            { value: 'line', label: t('modules.bingo.ui.g0.champs.defaultMode.opt.line.label') },
            { value: 'full', label: t('modules.bingo.ui.g0.champs.defaultMode.opt.full.label') },
          ],
        },
      ],
    },
  ],
  commands: bingoCommands,
  componentHandler: bingoComponent,
});
