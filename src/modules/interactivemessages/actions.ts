import type { ConfigField, ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getInteractiveMessagesConfig } from './config.js';
import { publishPanel } from './service.js';

/** Publie (ou met à jour) un message interactif dans son salon. */
const publish = (): ModuleAction => ({
  id: 'publish',
  label: t('modules.interactivemessages.actions.publish.label'),
  help: t('modules.interactivemessages.actions.publish.help'),
  style: 'primary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { panels } = await getInteractiveMessagesConfig(ctx, guildId);
    return [
      {
        key: 'id',
        label: t('modules.interactivemessages.actions.publish.champs.id'),
        type: 'select',
        options: panels.map((panel) => ({ value: panel.id, label: panel.name })),
      },
    ];
  },
  async run({ ctx, guildId, input }) {
    const id = typeof input.id === 'string' ? input.id : '';
    const guild = ctx.client.guilds.cache.get(guildId);
    const msg = (key: string, vars?: Record<string, string | number>) =>
      t(`modules.interactivemessages.actions.publish.msg.${key}`, vars);
    if (!guild) return { ok: false, message: msg('noGuild') };

    const config = await getInteractiveMessagesConfig(ctx, guildId);
    const panel = config.panels.find((p) => p.id === id);
    if (!panel) return { ok: false, message: msg('pickPanel') };

    const result = await publishPanel(guild, panel, ctx.logger);
    if (!result.ok) {
      const reason =
        result.error === 'nochannel'
          ? msg('reason.nochannel')
          : result.error === 'empty'
            ? msg('reason.empty')
            : msg('reason.refused');
      return { ok: false, message: msg('failed', { raison: reason }) };
    }

    // Mémorise le message publié pour que la prochaine publication l'édite.
    return {
      ok: true,
      message: msg('done'),
      configPatch: {
        panels: config.panels.map((p) => (p.id === id ? { ...p, messageId: result.messageId } : p)),
      },
    };
  },
});

export const interactiveMessagesActions = (): ModuleAction[] => [publish()];
