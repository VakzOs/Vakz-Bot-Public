import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';

/**
 * Nettoyage : si le salon d'un ticket est supprimé « salement » (à la main,
 * hors du bouton « Fermer »), on marque le ticket correspondant comme fermé
 * pour qu'il ne compte plus comme ouvert (limite par membre, etc.).
 */
export const onChannelDelete = defineEvent({
  name: Events.ChannelDelete,
  async execute(ctx, channel) {
    if (channel.isDMBased()) return;
    const result = await ctx.db.ticket.updateMany({
      where: { guildId: channel.guildId, channelId: channel.id, status: 'open' },
      data: { status: 'closed', closedAt: new Date() },
    });
    if (result.count > 0) {
      ctx.logger.info(
        { guildId: channel.guildId, channelId: channel.id },
        'Ticket fermé automatiquement (salon supprimé)',
      );
    }
  },
});
