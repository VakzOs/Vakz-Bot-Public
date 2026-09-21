import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, ticketsConfigSchema, ticketsDefaultConfig } from './config.js';
import { ticketsComponent } from './component.js';
import { onChannelDelete } from './events.js';
import { publishPanel as publishTicketsPanel } from './service.js';
import type { TicketsConfig } from './config.js';

/**
 * Module « Tickets » : un panneau publié propose un bouton « Ouvrir un ticket »
 * qui crée, selon le mode choisi, un salon privé (dans une catégorie) ou un fil
 * privé entre le membre et le staff. Le nom suit un format configurable
 * (`{type}`, `{number}`, `{count}`, `{user}`, `{id}`). Le ticket se ferme via un
 * bouton, ce qui archive puis supprime le salon/fil. Configuration via le dashboard.
 * Le bot a besoin de « Gérer les salons » (mode salon) ou « Créer des fils
 * privés » (mode fil).
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.tickets.label',
  descriptionKey: 'modules.tickets.description',
  publishPanel: (guild, config) => publishTicketsPanel(guild, config as TicketsConfig),
  category: 'community',
  emoji: '\u{1F39F}\u{FE0F}',
  configSchema: ticketsConfigSchema,
  defaultConfig: ticketsDefaultConfig,
  configUI: () => [
    {
      label: t('modules.tickets.ui.g0.label'),
      description: t('modules.tickets.ui.g0.description'),
      fields: [
        {
          key: 'title',
          label: t('modules.tickets.ui.g0.champs.title.label'),
          type: 'text',
          help: t('modules.tickets.ui.g0.champs.title.help'),
        },
        {
          key: 'description',
          label: t('modules.tickets.ui.g0.champs.description.label'),
          type: 'textarea',
          help: t('modules.tickets.ui.g0.champs.description.help'),
        },
        {
          key: 'panelChannelId',
          label: t('modules.tickets.ui.g0.champs.panelChannelId.label'),
          type: 'channel',
          help: t('modules.tickets.ui.g0.champs.panelChannelId.help'),
        },
        {
          key: 'mode',
          label: t('modules.tickets.ui.g0.champs.mode.label'),
          type: 'select',
          help: t('modules.tickets.ui.g0.champs.mode.help'),
          options: [
            { value: 'channel', label: t('modules.tickets.ui.g0.champs.mode.opt.channel.label') },
            { value: 'thread', label: t('modules.tickets.ui.g0.champs.mode.opt.thread.label') },
          ],
        },
        {
          key: 'categoryId',
          label: t('modules.tickets.ui.g0.champs.categoryId.label'),
          type: 'category',
          help: t('modules.tickets.ui.g0.champs.categoryId.help'),
        },
        {
          key: 'archiveChannelId',
          label: t('modules.tickets.ui.g0.champs.archiveChannelId.label'),
          type: 'channel',
          help: t('modules.tickets.ui.g0.champs.archiveChannelId.help'),
        },
        {
          key: 'nameFormat',
          label: t('modules.tickets.ui.g0.champs.nameFormat.label'),
          type: 'text',
          help: t('modules.tickets.ui.g0.champs.nameFormat.help'),
        },
        {
          key: 'maxOpen',
          label: t('modules.tickets.ui.g0.champs.maxOpen.label'),
          type: 'number',
          help: t('modules.tickets.ui.g0.champs.maxOpen.help'),
        },
      ],
    },
    {
      label: t('modules.tickets.ui.g1.label'),
      description: t('modules.tickets.ui.g1.description'),
      fields: [
        {
          key: 'types',
          label: t('modules.tickets.ui.g1.champs.types.label'),
          type: 'list',
          help: t('modules.tickets.ui.g1.champs.types.help'),
          idKey: 'id',
          addLabel: t('modules.tickets.ui.g1.champs.types.addLabel'),
          item: [
            {
              key: 'label',
              label: t('modules.tickets.ui.g1.champs.types.item.label.label'),
              type: 'text',
            },
            {
              key: 'emoji',
              label: t('modules.tickets.ui.g1.champs.types.item.emoji.label'),
              type: 'text',
              placeholder: t('modules.tickets.ui.g1.champs.types.item.emoji.placeholder'),
            },
            {
              key: 'prefix',
              label: t('modules.tickets.ui.g1.champs.types.item.prefix.label'),
              type: 'text',
              placeholder: t('modules.tickets.ui.g1.champs.types.item.prefix.placeholder'),
              help: t('modules.tickets.ui.g1.champs.types.item.prefix.help'),
            },
            {
              key: 'roleIds',
              label: t('modules.tickets.ui.g1.champs.types.item.roleIds.label'),
              type: 'roles',
            },
          ],
        },
      ],
    },
  ],
  componentHandler: ticketsComponent,
  events: [onChannelDelete],
});
