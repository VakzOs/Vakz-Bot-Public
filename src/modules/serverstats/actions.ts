import type { ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getServerstatsConfig } from './config.js';
import { refreshCounter } from './service.js';

/** Force la mise à jour de tous les compteurs sans attendre la tâche planifiée. */
const refreshAll = (): ModuleAction => ({
  id: 'refreshAll',
  label: t('modules.serverstats.actions.refreshAll.label'),
  help: t('modules.serverstats.actions.refreshAll.help'),
  style: 'primary',
  async run({ ctx, guildId }) {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: t('modules.serverstats.actions.msg.noGuild') };

    const { counters } = await getServerstatsConfig(ctx, guildId);
    if (counters.length === 0)
      return { ok: false, message: t('modules.serverstats.actions.msg.noCounter') };

    // Les compteurs par rôle ont besoin de la liste complète des membres.
    await guild.members.fetch().catch(() => undefined);
    for (const counter of counters) {
      await refreshCounter(ctx, guild, counter).catch(() => undefined);
    }
    return {
      ok: true,
      message: t('modules.serverstats.actions.refreshAll.msg.done', { n: counters.length }),
    };
  },
});

export const serverstatsActions = (): ModuleAction[] => [refreshAll()];
