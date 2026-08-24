import { GatewayDispatchEvents } from 'discord.js';
import {
  LavalinkManager,
  type Player,
  type Track,
  type UnresolvedTrack,
  type VoicePacket,
} from 'lavalink-client';
import type { BotContext } from '../../core/module.js';
import { env } from '../../core/env.js';
import { createLogger } from '../../core/logger.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { getMusicConfig } from './config.js';
import { nowPlayingEmbed } from './service.js';

const log = createLogger('music');

let manager: LavalinkManager | null = null;

/** Le module musique n'est actif que si un serveur Lavalink est configuré. */
export function isMusicConfigured(): boolean {
  return Boolean(env.LAVALINK_HOST);
}

/** Renvoie le gestionnaire Lavalink, ou `null` s'il n'est pas (encore) prêt. */
export function getManager(): LavalinkManager | null {
  return manager;
}

/** Poste le message « Lecture en cours » dans le salon texte du lecteur. */
async function announceTrack(ctx: BotContext, player: Player, track: Track | null): Promise<void> {
  if (!track || !player.textChannelId) return;
  const channel =
    ctx.client.channels.cache.get(player.textChannelId) ??
    (await ctx.client.channels.fetch(player.textChannelId).catch(() => null));
  if (channel?.isTextBased() && channel.isSendable()) {
    await channel.send({ embeds: [nowPlayingEmbed(player, track)] }).catch(() => undefined);
  }
}

/** Fin de file : signale, puis quitte le vocal si l'auto-départ est activé. */
async function handleQueueEnd(ctx: BotContext, player: Player): Promise<void> {
  const config = await getMusicConfig(ctx, player.guildId).catch(() => null);
  if (player.textChannelId) {
    const channel =
      ctx.client.channels.cache.get(player.textChannelId) ??
      (await ctx.client.channels.fetch(player.textChannelId).catch(() => null));
    if (channel?.isTextBased() && channel.isSendable()) {
      await channel
        .send({ embeds: [infoEmbed({ description: t('modules.music.queueEnded') })] })
        .catch(() => undefined);
    }
  }
  if (config?.autoLeave ?? true) {
    await player.destroy('queueEnd').catch(() => undefined);
  }
}

/**
 * Initialise le gestionnaire Lavalink (appelé au chargement du module, une fois
 * le client prêt). Idempotent : ne fait rien si déjà initialisé ou non configuré.
 */
export async function initMusicManager(ctx: BotContext): Promise<void> {
  if (!isMusicConfigured() || manager) return;
  const client = ctx.client;
  if (!client.user) return;

  manager = new LavalinkManager({
    nodes: [
      {
        id: 'main',
        host: env.LAVALINK_HOST as string,
        port: env.LAVALINK_PORT,
        authorization: env.LAVALINK_PASSWORD,
        secure: env.LAVALINK_SECURE,
        // Résilience au démarrage : Lavalink peut mettre ~1 min à être prêt
        // (téléchargement des plugins) et le bot démarre souvent avant lui.
        // On retente longtemps plutôt que d'abandonner après quelques essais.
        retryAmount: 120,
        retryDelay: 5000,
      },
    ],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload),
    playerOptions: {
      defaultSearchPlatform: 'ytsearch',
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
    },
    queueOptions: { maxPreviousTracks: 25 },
  });

  // Discord -> Lavalink : transfert des mises à jour d'état vocal. sendRawData
  // exige le paquet COMPLET (avec son champ `t`) ; or `client.ws.on(<event>)`
  // ne fournit que la charge utile `d`. On ré-emballe donc avec `t`, sinon
  // Lavalink ignore les updates et l'audio n'est jamais transmis (aucun son).
  client.ws.on(GatewayDispatchEvents.VoiceStateUpdate, (data) => {
    void manager?.sendRawData({ t: 'VOICE_STATE_UPDATE', d: data } as VoicePacket);
  });
  client.ws.on(GatewayDispatchEvents.VoiceServerUpdate, (data) => {
    void manager?.sendRawData({ t: 'VOICE_SERVER_UPDATE', d: data } as VoicePacket);
  });

  manager.nodeManager
    .on('connect', (node) => log.info({ node: node.id }, 'Nœud Lavalink connecté'))
    .on('disconnect', (node) => log.warn({ node: node.id }, 'Nœud Lavalink déconnecté'))
    .on('error', (node, error) => log.error({ node: node.id, err: error }, 'Erreur nœud Lavalink'));

  manager.on('trackStart', (player, track) => {
    void announceTrack(ctx, player, track);
  });
  manager.on('queueEnd', (player) => {
    void handleQueueEnd(ctx, player);
  });

  await manager.init({ id: client.user.id, username: client.user.username });
  log.info('Gestionnaire musique (Lavalink) initialisé');
}

export type { Player, Track, UnresolvedTrack };
