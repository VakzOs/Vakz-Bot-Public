import { defineModule } from '../../core/module.js';
import { MODULE_NAME, serverstatsConfigSchema, serverstatsDefaultConfig } from './config.js';
import { serverstatsPanel } from './panel.js';
import { serverstatsTask } from './task.js';
import { updateAllGuilds } from './service.js';

/**
 * Module « Compteurs de serveur » : des salons vocaux dont le nom affiche une
 * statistique (membres, humains, bots, boosts, rôles, salons, ou membres d'un
 * rôle) et se met à jour toutes les 10 minutes via `/config`.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.serverstats.label',
  descriptionKey: 'modules.serverstats.description',
  configSchema: serverstatsConfigSchema,
  defaultConfig: serverstatsDefaultConfig,
  configUI: [
    {
      label: '📊 Compteurs',
      description: 'Chaque compteur renomme un salon vocal avec une statistique du serveur.',
      fields: [
        {
          key: 'counters',
          label: 'Compteurs',
          type: 'list',
          idKey: 'id',
          addLabel: 'Ajouter un compteur',
          item: [
            { key: 'channelId', label: 'Salon (vocal)', type: 'voiceChannel' },
            {
              key: 'type',
              label: 'Type',
              type: 'select',
              options: [
                { value: 'members', label: 'Membres' },
                { value: 'humans', label: 'Humains' },
                { value: 'bots', label: 'Bots' },
                { value: 'boosts', label: 'Boosts' },
                { value: 'roles', label: 'Nombre de rôles' },
                { value: 'channels', label: 'Nombre de salons' },
                { value: 'role', label: 'Membres d’un rôle' },
              ],
            },
            { key: 'roleId', label: 'Rôle (type « Membres d’un rôle »)', type: 'role' },
            {
              key: 'template',
              label: 'Modèle de nom',
              type: 'text',
              help: '{count} = valeur du compteur.',
            },
          ],
        },
      ],
    },
  ],
  configPanel: serverstatsPanel,
  tasks: [serverstatsTask],
  async onLoad(ctx) {
    await updateAllGuilds(ctx);
  },
});
