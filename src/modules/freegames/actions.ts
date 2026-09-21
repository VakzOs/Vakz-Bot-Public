import { PermissionFlagsBits } from 'discord.js';
import type { ModuleAction } from '../../core/module.js';
import { getFreegamesConfig } from './config.js';
import { buildFreeGameEmbed, fetchFreeGames } from './service.js';

/**
 * Publie tout de suite les offres en cours dans le salon configuré, sans
 * attendre le prochain passage de la tâche.
 *
 * Republie **même ce qui a déjà été annoncé** — c'est tout l'intérêt d'un
 * forçage — mais consigne chaque envoi réussi dans la table de dédup : sans
 * ça, la tâche des 30 minutes réannoncerait derrière une offre qu'elle n'avait
 * pas encore vue, et l'admin recevrait le même jeu deux fois.
 */
const announceNow: ModuleAction = {
  id: 'announceNow',
  label: 'Annoncer les offres en cours',
  help: 'Republie les jeux actuellement gratuits sur les plateformes cochées, et les marque comme annoncés.',
  style: 'primary',
  async run({ ctx, guildId }) {
    const config = await getFreegamesConfig(ctx, guildId);
    if (!config.channelId) return { ok: false, message: 'Aucun salon d’annonces configuré.' };
    if (config.platforms.length === 0) return { ok: false, message: 'Aucune plateforme cochée.' };

    const channel = await ctx.client.channels.fetch(config.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      return { ok: false, message: 'Salon introuvable ou non textuel.' };
    }
    const selfId = ctx.client.user?.id;
    if (selfId && 'permissionsFor' in channel) {
      const permissions = channel.permissionsFor(selfId);
      if (
        !permissions?.has(PermissionFlagsBits.SendMessages) ||
        !permissions.has(PermissionFlagsBits.EmbedLinks)
      ) {
        return { ok: false, message: 'Permissions manquantes dans le salon.' };
      }
    }

    const games = await fetchFreeGames(config.platforms);
    if (games.length === 0) return { ok: false, message: 'Aucune offre gratuite en ce moment.' };

    const mention = config.roleId ? `<@&${config.roleId}>` : undefined;
    let sent = 0;
    for (const game of games) {
      const delivered = await channel
        .send({
          ...(mention ? { content: mention } : {}),
          embeds: [buildFreeGameEmbed(game)],
          allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] },
        })
        .then(() => true)
        .catch((error: unknown) => {
          ctx.logger.warn({ err: error, guildId }, 'Annonce forcée de jeu gratuit échouée');
          return false;
        });
      if (!delivered) continue;
      sent++;
      // La contrainte d'unicité (guildId, source, gameId) rend l'écriture
      // idempotente : une offre déjà consignée n'est pas un échec.
      await ctx.db.freeGameAnnouncement
        .create({ data: { guildId, source: game.platform, gameId: game.gameId } })
        .catch(() => undefined);
    }
    if (sent === 0) return { ok: false, message: 'Aucune annonce n’a pu être envoyée.' };
    return { ok: true, message: `${sent} offre(s) annoncée(s).` };
  },
};

export const freegamesActions: ModuleAction[] = [announceNow];
