import type { ModuleAction } from '../../core/module.js';
import { getAutomodConfig } from './config.js';
import { createHoneypotChannel, syncHoneypotMessage } from './service.js';

/**
 * Crée le salon piège (« honeypot ») ouvert à tous : tout membre qui y écrit
 * est sanctionné. Le salon créé devient le salon piège du module.
 */
const setupHoneypot: ModuleAction = {
  id: 'setupHoneypot',
  label: 'Créer le salon piège',
  help: 'Crée un salon visible de tous où écrire déclenche la sanction configurée.',
  style: 'primary',
  confirm: 'Créer un nouveau salon piège sur ce serveur ?',
  async run({ ctx, guildId }) {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: 'Serveur introuvable.' };

    const channel = await createHoneypotChannel(guild);
    if (!channel) {
      return {
        ok: false,
        message: 'Création refusée : permission « Gérer les salons » manquante.',
      };
    }

    const config = await getAutomodConfig(ctx, guildId);
    const honeypot = { ...config.honeypot, channelId: channel.id, messageId: null };
    const messageId = await syncHoneypotMessage(ctx, guild, { ...config, honeypot });
    return {
      ok: true,
      message: `Salon piège créé : #${channel.name}.`,
      configPatch: { honeypot: { ...honeypot, messageId } },
    };
  },
};

export const automodActions: ModuleAction[] = [setupHoneypot];
