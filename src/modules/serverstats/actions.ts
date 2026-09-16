import type { ModuleAction } from '../../core/module.js';
import { getServerstatsConfig } from './config.js';
import { refreshCounter } from './service.js';

/** Force la mise à jour de tous les compteurs sans attendre la tâche planifiée. */
const refreshAll: ModuleAction = {
  id: 'refreshAll',
  label: 'Rafraîchir les compteurs',
  help: 'Renomme immédiatement chaque salon compteur avec sa valeur actuelle.',
  style: 'primary',
  async run({ ctx, guildId }) {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: 'Serveur introuvable.' };

    const { counters } = await getServerstatsConfig(ctx, guildId);
    if (counters.length === 0) return { ok: false, message: 'Aucun compteur configuré.' };

    // Les compteurs par rôle ont besoin de la liste complète des membres.
    await guild.members.fetch().catch(() => undefined);
    for (const counter of counters) {
      await refreshCounter(ctx, guild, counter).catch(() => undefined);
    }
    return { ok: true, message: `${counters.length} compteur(s) rafraîchi(s).` };
  },
};

export const serverstatsActions: ModuleAction[] = [refreshAll];
