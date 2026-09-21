import type { ConfigField, ModuleAction } from '../../core/module.js';
import { linkChannel, listLinks, unlinkChannel } from './service.js';

/** Lie un salon de ce serveur à un réseau interserveurs. */
const link: ModuleAction = {
  id: 'link',
  label: 'Lier un salon',
  help: 'Les serveurs partageant le même code de réseau voient leurs messages relayés.',
  style: 'primary',
  fields: [
    { key: 'channelId', label: 'Salon à lier', type: 'channel' },
    {
      key: 'network',
      label: 'Code du réseau',
      type: 'text',
      placeholder: 'mon-reseau',
      help: '3 à 32 caractères : lettres, chiffres et tirets.',
    },
  ],
  async run({ ctx, guildId, input }) {
    const channelId = typeof input.channelId === 'string' ? input.channelId : '';
    const network = typeof input.network === 'string' ? input.network : '';
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return { ok: false, message: 'Serveur introuvable.' };

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return { ok: false, message: 'Salon introuvable ou non textuel.' };

    const result = await linkChannel(ctx, channel, network);
    if (result.ok) return { ok: true, message: `Salon lié au réseau « ${result.network} ».` };
    return {
      ok: false,
      message:
        result.error === 'code'
          ? 'Code de réseau invalide (3 à 32 caractères).'
          : result.error === 'perm'
            ? 'Permission « Gérer les webhooks » manquante sur ce salon.'
            : 'Création du webhook impossible.',
    };
  },
};

/** Retire un salon du réseau et supprime son webhook. */
const unlink: ModuleAction = {
  id: 'unlink',
  label: 'Délier un salon',
  style: 'danger',
  confirm: 'Retirer ce salon de son réseau interserveurs ?',
  async resolveFields(ctx, guildId): Promise<ConfigField[]> {
    const links = await listLinks(ctx, guildId);
    const guild = ctx.client.guilds.cache.get(guildId);
    return [
      {
        key: 'channelId',
        label: 'Salon lié',
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
      return { ok: false, message: 'Choisis un salon actuellement lié.' };
    }
    await unlinkChannel(ctx, channelId);
    return { ok: true, message: 'Salon délié.' };
  },
};

export const interserverActions: ModuleAction[] = [link, unlink];
