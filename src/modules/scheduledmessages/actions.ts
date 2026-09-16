import type { ConfigField, ModuleAction } from '../../core/module.js';
import { getScheduledmessagesConfig } from './config.js';
import { sendNow } from './service.js';

/** Envoie un message planifié tout de suite, sans toucher à sa cadence. */
const send: ModuleAction = {
  id: 'sendNow',
  label: 'Envoyer maintenant',
  help: 'Publie le message choisi immédiatement ; sa planification reste inchangée.',
  style: 'secondary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { messages } = await getScheduledmessagesConfig(ctx, guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    return [
      {
        key: 'id',
        label: 'Message',
        type: 'select',
        options: messages.map((message) => ({
          value: message.id,
          label: `#${guild?.channels.cache.get(message.channelId)?.name ?? message.channelId} · ${message.content.slice(0, 40)}`,
        })),
      },
    ];
  },
  async run({ ctx, guildId, input }) {
    const id = typeof input.id === 'string' ? input.id : '';
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: 'Serveur introuvable.' };

    const { messages } = await getScheduledmessagesConfig(ctx, guildId);
    const message = messages.find((m) => m.id === id);
    if (!message) return { ok: false, message: 'Choisis un message planifié.' };

    const sent = await sendNow(ctx, guild, message);
    return sent
      ? { ok: true, message: 'Message envoyé.' }
      : { ok: false, message: 'Envoi impossible (salon ou permissions).' };
  },
};

export const scheduledmessagesActions: ModuleAction[] = [send];
