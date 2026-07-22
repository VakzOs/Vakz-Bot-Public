import { defineModule } from '../../core/module.js';
import { MODULE_NAME, suggestionsConfigSchema, suggestionsDefaultConfig } from './config.js';
import { suggestion, suggestionsList } from './commands.js';
import { suggestionsPanel } from './panel.js';
import { suggestionsComponent } from './component.js';

/**
 * Module « Suggestions » : les membres soumettent une suggestion via
 * `/suggestion` ; le bot la poste dans un salon dédié avec un vote 👍/👎 par
 * boutons. Le staff peut approuver / refuser / mettre à l'étude avec une raison.
 * Suggestions et votes sont persistés (tables `Suggestion` / `SuggestionVote`).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.suggestions.label',
  descriptionKey: 'modules.suggestions.description',
  configSchema: suggestionsConfigSchema,
  defaultConfig: suggestionsDefaultConfig,
  configUI: [
    {
      description: 'La récompense « objet » à l’approbation reste éditable sur Discord via /config.',
      fields: [
        {
          key: 'channelIds',
          label: 'Salons de suggestions',
          type: 'channels',
          help: 'Salons où les suggestions sont publiées.',
        },
        { key: 'staffRoleId', label: 'Rôle staff', type: 'role' },
        { key: 'createThread', label: 'Créer un fil par suggestion', type: 'boolean' },
        {
          key: 'maxPending',
          label: 'Limite de suggestions en attente / membre',
          type: 'number',
          help: '0 = illimité.',
        },
        {
          key: 'rewardCoins',
          label: 'Pièces offertes à l’approbation',
          type: 'number',
          help: '0 = aucune récompense.',
        },
        { key: 'dynamicColor', label: 'Couleur d’embed dynamique (selon les votes)', type: 'boolean' },
        {
          key: 'roleLimits',
          label: 'Limites par rôle',
          type: 'list',
          help: 'Priment sur la limite par défaut. Limite 0 = illimité.',
          addLabel: 'Ajouter un rôle',
          item: [
            { key: 'roleId', label: 'Rôle', type: 'role' },
            { key: 'limit', label: 'Limite', type: 'number' },
          ],
        },
      ],
    },
  ],
  configPanel: suggestionsPanel,
  componentHandler: suggestionsComponent,
  commands: [suggestion, suggestionsList],
});
