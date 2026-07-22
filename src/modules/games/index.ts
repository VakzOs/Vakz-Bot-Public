import { defineModule } from '../../core/module.js';
import { MODULE_NAME } from './service.js';
import { gamesCommands } from './commands.js';
import { gamesComponent } from './component.js';

/**
 * Module « Jeux » : des mini-jeux fun — dés dédiés (`/d4` … `/d100`), `/boule8`,
 * `/pileouface`, `/choisir`, `/pfc` (pierre-feuille-ciseaux, contre le bot ou en
 * défiant un membre) et `/morpion` (contre le bot avec IA imbattable, ou contre
 * un membre). Les résultats de `/pfc` et `/morpion` sont comptabilisés et
 * consultables via `/statsjeux`. Activable via `/config`, aucun réglage.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.games.label',
  descriptionKey: 'modules.games.description',
  commands: gamesCommands,
  componentHandler: gamesComponent,
});
