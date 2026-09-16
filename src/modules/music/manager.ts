import { GatewayDispatchEvents } from 'discord.js';
import {
  LavalinkManager,
  type LavalinkNode,
  type LavalinkNodeOptions,
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

/**
 * Codes d'erreur réseau qui disent tous la même chose : le serveur Lavalink
 * n'est pas joignable. C'est l'état NORMAL des premières dizaines de secondes —
 * le bot est prêt en quelques instants, Lavalink met environ une minute (JVM
 * puis téléchargement des plugins) — et de tout redémarrage du conteneur audio.
 */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

/**
 * Attente avant de recréer le nœud une fois toutes les tentatives épuisées.
 * `lavalink-client` DÉTRUIT le nœud à ce moment-là (et le retire du
 * gestionnaire) : sans reprise, la musique reste morte jusqu'au prochain
 * redémarrage du bot, alors que le conteneur audio, lui, peut revenir à tout
 * moment. Une minute d'attente évite de tourner à vide entre deux fenêtres.
 */
const NODE_REVIVAL_DELAY_MS = 60_000;

let manager: LavalinkManager | null = null;

/** Échecs de connexion consécutifs : sert à n'en signaler que le premier. */
let unreachableStreak = 0;

/** Minuterie de reprise après abandon, pour ne pas en armer deux. */
let revivalTimer: NodeJS.Timeout | null = null;

/** Une erreur « le serveur n'est pas là », par opposition à une vraie panne. */
function isUnreachable(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && UNREACHABLE_CODES.has(code);
}

/** Options du nœud audio — relues telles quelles à chaque recréation. */
function nodeOptions(): LavalinkNodeOptions {
  return {
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
  };
}

/**
 * Recrée le nœud abandonné après un délai, ce qui ouvre une nouvelle fenêtre de
 * tentatives. Sans ça, une indisponibilité de Lavalink plus longue que dix
 * minutes (mise à jour du VPS, conteneur en boucle de redémarrage) condamne la
 * musique jusqu'au prochain redémarrage du bot.
 */
function scheduleNodeRevival(): void {
  if (revivalTimer) return;
  revivalTimer = setTimeout(() => {
    revivalTimer = null;
    const nodeManager = manager?.nodeManager;
    if (!nodeManager || nodeManager.nodes.has('main')) return;
    unreachableStreak = 0;
    log.info('Nouvelle fenêtre de connexion au serveur Lavalink');
    try {
      nodeManager.createNode<LavalinkNode>(nodeOptions()).connect();
    } catch (error) {
      log.error({ err: error }, 'Impossible de recréer le nœud Lavalink');
    }
  }, NODE_REVIVAL_DELAY_MS);
  // Une reprise en attente ne doit jamais retenir le processus à l'arrêt.
  revivalTimer.unref();
}

/** Le module musique n'est actif que si un serveur Lavalink est configuré. */
function isMusicConfigured(): boolean {
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
    nodes: [nodeOptions()],
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
    .on('connect', (node) => {
      log.info({ node: node.id, tentatives: unreachableStreak }, 'Nœud Lavalink connecté');
      unreachableStreak = 0;
    })
    .on('disconnect', (node, reason) => {
      // Chaque tentative ratée ferme aussi la socket, donc passe ici : sans ce
      // garde-fou, une coupure produit deux flots de lignes au lieu d'un. Une
      // panne en cours a déjà été signalée juste au-dessus ; seule une chute
      // depuis un nœud SAIN (série à zéro) est une nouvelle à annoncer.
      const level = unreachableStreak > 0 ? 'debug' : 'warn';
      log[level]({ node: node.id, ...reason }, 'Nœud Lavalink déconnecté');
    })
    .on('error', (node, error) => {
      if (!isUnreachable(error)) {
        log.error({ node: node.id, err: error }, 'Erreur nœud Lavalink');
        return;
      }
      // Le nœud retente toutes les 5 s pendant dix minutes et CHAQUE échec
      // passe ici. Publier cent vingt lignes ERREUR chasserait tout le reste du
      // tampon de logs du dashboard (500 lignes) sans rien apprendre de plus
      // qu'une seule : on signale le début de la panne, puis on se tait. La fin
      // des tentatives, elle, n'est pas une erreur réseau et reste en ERREUR.
      unreachableStreak += 1;
      if (unreachableStreak === 1) {
        log.warn(
          { node: node.id, err: error },
          'Serveur Lavalink injoignable — nouvelles tentatives en cours',
        );
      } else {
        log.debug(
          { node: node.id, err: error, tentatives: unreachableStreak },
          'Serveur Lavalink toujours injoignable',
        );
      }
    })
    .on('destroy', (node, reason) => {
      if (reason !== 'NodeReconnectFail') return;
      log.warn(
        { node: node.id, tentatives: unreachableStreak },
        'Nœud Lavalink abandonné — nouvelle tentative dans une minute',
      );
      scheduleNodeRevival();
    });

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
