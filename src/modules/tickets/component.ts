import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  MessageFlags,
} from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, getTicketsConfig } from './config.js';
import { canCloseTicket, closeTicket, openTicket } from './service.js';

/**
 * Gère les boutons du module Tickets : `tickets|open|<typeId>` (panneau),
 * `tickets|close|<id>` et `tickets|confirm|<id>` (dans le salon du ticket).
 */
export const ticketsComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;

    const guildId = interaction.guildId;
    const [, action, param] = interaction.customId.split('|');

    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('modules.tickets.feedback.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await getTicketsConfig(ctx, guildId);
    const member = interaction.member;

    if (action === 'open') {
      const type = config.types.find((candidate) => candidate.id === param);
      if (!type) {
        await interaction.reply({
          content: t('modules.tickets.error.notype'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await openTicket(ctx, interaction.guild, member, config, type);
      if (!result.ok) {
        const detail =
          result.error === 'max'
            ? t('modules.tickets.error.max', { max: config.maxOpen })
            : t(`modules.tickets.error.${result.error}`);
        await interaction.editReply({ content: detail });
        return;
      }
      await interaction.editReply({
        content: t('modules.tickets.opened', { channel: `<#${result.channelId}>` }),
      });
      return;
    }

    if (action === 'close' || action === 'confirm') {
      if (!param) return;
      const ticket = await ctx.db.ticket.findUnique({ where: { id: param } });
      if (!ticket || ticket.status !== 'open') {
        await interaction.reply({
          content: t('modules.tickets.close.notFound'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!canCloseTicket(member, ticket, config)) {
        await interaction.reply({
          content: t('modules.tickets.close.cantClose'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (action === 'close') {
        const confirmRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${MODULE_NAME}|confirm|${ticket.id}`)
            .setLabel(t('modules.tickets.close.confirmButton'))
            .setStyle(ButtonStyle.Danger),
        );
        await interaction.reply({
          content: t('modules.tickets.close.confirm'),
          components: [confirmRow],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // action === 'confirm' : archivage éventuel puis suppression du salon.
      await interaction.reply({
        content: config.archiveChannelId
          ? t('modules.tickets.close.closingArchive')
          : t('modules.tickets.close.closing'),
        flags: MessageFlags.Ephemeral,
      });
      await closeTicket(ctx, interaction.guild, ticket, config, interaction.user.id);
    }
  },
};
