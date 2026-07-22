import { defineModule } from '../../core/module.js';
import { sauvegarde } from './commands.js';

/**
 * Module « Sauvegarde / export config » : outil système permettant d'exporter
 * toute la configuration des modules d'un serveur dans un fichier JSON, puis de
 * la réimporter (backup avant refonte, ou migration vers un autre serveur).
 *
 * Marqué `internal` → toujours disponible pour les administrateurs, sans réglage
 * propre à activer. Ne sauvegarde jamais les modules système eux-mêmes.
 */
export default defineModule({
  name: 'configbackup',
  labelKey: 'modules.configbackup.label',
  descriptionKey: 'modules.configbackup.description',
  internal: true,
  commands: [sauvegarde],
});
