import { defineModule } from '../../core/module.js';
import { ping, pingComponent } from './commands/ping.js';
import { config } from './commands/config.js';

/**
 * Module « core » : commandes système toujours disponibles.
 * Marqué `internal` → chargé en permanence et non désactivable via `/config`.
 */
export default defineModule({
  name: 'core',
  labelKey: 'modules.core.label',
  descriptionKey: 'modules.core.description',
  internal: true,
  commands: [ping, config],
  componentHandler: pingComponent,
});
