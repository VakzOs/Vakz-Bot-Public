import { defineModule } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, itemsConfigSchema, itemsDefaultConfig } from './config.js';
import { itemsCommands } from './commands.js';
import { tempNicknameTask } from './tempnick.js';
import { itemsRoutes } from './routes.js';

/**
 * Module « Objets & inventaires » : catalogue d'objets par serveur, achat avec
 * la monnaie du serveur, utilisation (rôle-récompense optionnel), échange entre
 * membres et gestion administrative. Catalogue géré depuis le dashboard.
 */
export default defineModule({
  name: MODULE_NAME,
  labelKey: 'modules.items.label',
  descriptionKey: 'modules.items.description',
  webPaths: ['app/dashboard/[guildId]/catalogue'],
  httpRoutes: itemsRoutes,
  category: 'fun',
  emoji: '\u{1F392}',
  configSchema: itemsConfigSchema,
  defaultConfig: itemsDefaultConfig,
  configUI: () => [
    {
      description: t('modules.items.ui.g0.description'),
      fields: [
        {
          key: 'tradingEnabled',
          label: t('modules.items.ui.g0.champs.tradingEnabled.label'),
          type: 'boolean',
          help: t('modules.items.ui.g0.champs.tradingEnabled.help'),
        },
      ],
    },
    {
      key: 'drops',
      label: t('modules.items.ui.drops.label'),
      description: t('modules.items.ui.drops.description'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.items.ui.drops.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.items.ui.drops.champs.enabled.help'),
        },
        {
          key: 'on',
          label: t('modules.items.ui.drops.champs.on.label'),
          type: 'select',
          help: t('modules.items.ui.drops.champs.on.help'),
          options: [
            { value: 'win', label: t('modules.items.ui.drops.champs.on.opt.win.label') },
            { value: 'winDraw', label: t('modules.items.ui.drops.champs.on.opt.winDraw.label') },
            { value: 'any', label: t('modules.items.ui.drops.champs.on.opt.any.label') },
          ],
        },
        {
          key: 'common',
          label: t('modules.items.ui.drops.champs.common.label'),
          type: 'number',
          help: t('modules.items.ui.drops.champs.common.help'),
        },
        {
          key: 'rare',
          label: t('modules.items.ui.drops.champs.rare.label'),
          type: 'number',
          help: t('modules.items.ui.drops.champs.rare.help'),
        },
        {
          key: 'epic',
          label: t('modules.items.ui.drops.champs.epic.label'),
          type: 'number',
          help: t('modules.items.ui.drops.champs.epic.help'),
        },
        {
          key: 'legendary',
          label: t('modules.items.ui.drops.champs.legendary.label'),
          type: 'number',
          help: t('modules.items.ui.drops.champs.legendary.help'),
        },
      ],
    },
    {
      key: 'sell',
      label: t('modules.items.ui.sell.label'),
      description: t('modules.items.ui.sell.description'),
      fields: [
        {
          key: 'enabled',
          label: t('modules.items.ui.sell.champs.enabled.label'),
          type: 'boolean',
          help: t('modules.items.ui.sell.champs.enabled.help'),
        },
        {
          key: 'percent',
          label: t('modules.items.ui.sell.champs.percent.label'),
          type: 'number',
          help: t('modules.items.ui.sell.champs.percent.help'),
        },
      ],
    },
  ],
  commands: itemsCommands,
  tasks: [tempNicknameTask],
});
