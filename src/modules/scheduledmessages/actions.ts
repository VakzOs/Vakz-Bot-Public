import type { ConfigField, ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getScheduledmessagesConfig } from './config.js';
import { sendNow } from './service.js';

/** Envoie un message planifié tout de suite, sans toucher à sa cadence. */
const send = (): ModuleAction => ({
  id: 'sendNow',
  label: t('modules.scheduledmessages.actions.sendNow.label'),
  help: t('modules.scheduledmessages.actions.sendNow.help'),
  style: 'secondary',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const { messages } = await getScheduledmessagesConfig(ctx, guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    return [
      {
        key: 'id',
        label: t('modules.scheduledmessages.actions.sendNow.champs.id'),
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
    const msg = (key: string) => t(`modules.scheduledmessages.actions.sendNow.msg.${key}`);
    if (!guild) return { ok: false, message: msg('noGuild') };

    const { messages } = await getScheduledmessagesConfig(ctx, guildId);
    const message = messages.find((m) => m.id === id);
    if (!message) return { ok: false, message: msg('pickMessage') };

    const sent = await sendNow(ctx, guild, message);
    return sent ? { ok: true, message: msg('done') } : { ok: false, message: msg('failed') };
  },
});

export const scheduledmessagesActions = (): ModuleAction[] => [send()];
