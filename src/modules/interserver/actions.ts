import type { ConfigField, ModuleAction } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { linkChannel, listLinks, unlinkChannel } from './service.js';

/** Lie un salon de ce serveur à un réseau interserveurs. */
const link = (): ModuleAction => ({
  id: 'link',
  label: t('modules.interserver.actions.link.label'),
  help: t('modules.interserver.actions.link.help'),
  style: 'primary',
  fields: [
    {
      key: 'channelId',
      label: t('modules.interserver.actions.link.champs.channelId'),
      type: 'channel',
    },
    {
      key: 'network',
      label: t('modules.interserver.actions.link.champs.network.label'),
      type: 'text',
      placeholder: t('modules.interserver.actions.link.champs.network.placeholder'),
      help: t('modules.interserver.actions.link.champs.network.help'),
    },
  ],
  async run({ ctx, guildId, input }) {
    const channelId = typeof input.channelId === 'string' ? input.channelId : '';
    const network = typeof input.network === 'string' ? input.network : '';
    const guild = ctx.client.guilds.cache.get(guildId);
    const msg = (key: string, vars?: Record<string, string | number>) =>
      t(`modules.interserver.actions.link.msg.${key}`, vars);
    if (!guild) return { ok: false, message: msg('noGuild') };

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return { ok: false, message: msg('badChannel') };

    const result = await linkChannel(ctx, channel, network);
    if (result.ok) return { ok: true, message: msg('done', { reseau: result.network }) };
    return {
      ok: false,
      message:
        result.error === 'code'
          ? msg('badCode')
          : result.error === 'perm'
            ? msg('noPermission')
            : msg('webhookFailed'),
    };
  },
});

/** Retire un salon du réseau et supprime son webhook. */
const unlink = (): ModuleAction => ({
  id: 'unlink',
  label: t('modules.interserver.actions.unlink.label'),
  style: 'danger',
  confirm: t('modules.interserver.actions.unlink.confirm'),
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const links = await listLinks(ctx, guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    return [
      {
        key: 'channelId',
        label: t('modules.interserver.actions.unlink.champs.channelId'),
        type: 'select',
        options: links.map((row) => ({
          value: row.channelId,
          label: `#${guild?.channels.cache.get(row.channelId)?.name ?? row.channelId} → ${row.network}`,
        })),
      },
    ];
  },
  async run({ ctx, guildId, input }) {
    const channelId = typeof input.channelId === 'string' ? input.channelId : '';
    const links = await listLinks(ctx, guildId);
    if (!links.some((row) => row.channelId === channelId)) {
      return { ok: false, message: t('modules.interserver.actions.unlink.msg.pickChannel') };
    }
    await unlinkChannel(ctx, channelId);
    return { ok: true, message: t('modules.interserver.actions.unlink.msg.done') };
  },
});

export const interserverActions = (): ModuleAction[] => [link(), unlink()];
