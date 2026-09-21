import type { ConfigField, ModuleAction } from '../../core/module.js';
import { getInteractiveMessagesConfig } from './config.js';
import { publishPanel } from './service.js';

/** Publie (ou met à jour) un message interactif dans son salon. */
const publish: ModuleAction = {
  id: 'publish',
  label: 'Publier un message',
  help: 'Publie le message choisi, ou met à jour celui déjà envoyé.',
  style: 'primary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { panels } = await getInteractiveMessagesConfig(ctx, guildId);
    return [
      {
        key: 'id',
        label: 'Message',
        type: 'select',
        options: panels.map((panel) => ({ value: panel.id, label: panel.name })),
      },
    ];
  },
  async run({ ctx, guildId, input }) {
    const id = typeof input.id === 'string' ? input.id : '';
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: 'Serveur introuvable.' };

    const config = await getInteractiveMessagesConfig(ctx, guildId);
    const panel = config.panels.find((p) => p.id === id);
    if (!panel) return { ok: false, message: 'Choisis un message enregistré.' };

    const result = await publishPanel(guild, panel, ctx.logger);
    if (!result.ok) {
      const reason =
        result.error === 'nochannel'
          ? 'salon manquant ou introuvable'
          : result.error === 'empty'
            ? 'titre et description vides'
            : 'envoi refusé par Discord';
      return { ok: false, message: `Publication impossible : ${reason}.` };
    }

    // Mémorise le message publié pour que la prochaine publication l'édite.
    return {
      ok: true,
      message: 'Message publié.',
      configPatch: {
        panels: config.panels.map((p) => (p.id === id ? { ...p, messageId: result.messageId } : p)),
      },
    };
  },
};

export const interactiveMessagesActions: ModuleAction[] = [publish];
