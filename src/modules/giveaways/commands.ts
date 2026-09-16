import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { parseDuration } from '../../lib/duration.js';
import { infoEmbed } from '../../lib/embeds.js';
import { buildGiveawayEmbed, buildJoinRow, endGiveaway, rerollAll, rerollOne } from './service.js';

const MAX_WINNERS = 20;

/** `/giveaway` — lancer et gérer des tirages au sort (admin). */
export const giveaway: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription(t('modules.giveaways.command.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('lancer')
        .setDescription(t('modules.giveaways.command.start'))
        .addStringOption((o) =>
          o
            .setName('lot')
            .setDescription(t('modules.giveaways.opt.prize'))
            .setRequired(true)
            .setMaxLength(200),
        )
        .addStringOption((o) =>
          o
            .setName('duree')
            .setDescription(t('modules.giveaways.opt.duration'))
            .setRequired(true)
            .setMaxLength(30),
        )
        .addIntegerOption((o) =>
          o
            .setName('gagnants')
            .setDescription(t('modules.giveaways.opt.winners'))
            .setMinValue(1)
            .setMaxValue(MAX_WINNERS),
        )
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription(t('modules.giveaways.opt.channel'))
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addRoleOption((o) => o.setName('role').setDescription(t('modules.giveaways.opt.role'))),
    )
    .addSubcommand((s) =>
      s
        .setName('terminer')
        .setDescription(t('modules.giveaways.command.end'))
        .addStringOption((o) =>
          o
            .setName('id')
            .setDescription(t('modules.giveaways.opt.id'))
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('relancer')
        .setDescription(t('modules.giveaways.command.reroll'))
        .addStringOption((o) =>
          o
            .setName('id')
            .setDescription(t('modules.giveaways.opt.id'))
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addUserOption((o) =>
          o.setName('gagnant').setDescription(t('modules.giveaways.opt.winner')),
        ),
    )
    .addSubcommand((s) => s.setName('liste').setDescription(t('modules.giveaways.command.list'))),

  async autocomplete(interaction, ctx) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }
    const status = interaction.options.getSubcommand() === 'relancer' ? 'ended' : 'active';
    const focused = interaction.options.getFocused().toLowerCase();
    const list = await ctx.db.giveaway.findMany({
      where: { guildId, status },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    const choices = list
      .filter((g) => g.prize.toLowerCase().includes(focused) || g.id.startsWith(focused))
      .slice(0, 25)
      .map((g) => ({ name: `${g.prize.slice(0, 80)} (${g.id.slice(0, 6)})`, value: g.id }));
    await interaction.respond(choices);
  },

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'lancer') {
      const prize = interaction.options.getString('lot', true);
      const ms = parseDuration(interaction.options.getString('duree', true));
      if (ms === null) {
        await interaction.reply({
          content: t('modules.giveaways.invalidDuration'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const winnerCount = interaction.options.getInteger('gagnants') ?? 1;
      const role = interaction.options.getRole('role');
      const chanOpt = interaction.options.getChannel('salon');
      const channel = chanOpt
        ? await interaction.guild.channels.fetch(chanOpt.id).catch(() => null)
        : interaction.channel;
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({
          content: t('modules.giveaways.channelInvalid'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const created = await ctx.db.giveaway.create({
        data: {
          guildId,
          channelId: channel.id,
          hostId: interaction.user.id,
          prize,
          winnerCount,
          requiredRoleId: role?.id ?? null,
          endsAt: new Date(Date.now() + ms),
        },
      });

      const sent = await channel
        .send({
          embeds: [buildGiveawayEmbed(created, 0)],
          components: buildJoinRow(created, 0),
        })
        .catch(() => null);
      if (!sent) {
        await ctx.db.giveaway.delete({ where: { id: created.id } }).catch(() => undefined);
        await interaction.reply({
          content: t('modules.giveaways.sendError'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await ctx.db.giveaway.update({ where: { id: created.id }, data: { messageId: sent.id } });
      await interaction.reply({
        content: t('modules.giveaways.launched', { url: sent.url }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'terminer') {
      const id = interaction.options.getString('id', true);
      const target = await ctx.db.giveaway.findFirst({ where: { id, guildId, status: 'active' } });
      if (!target) {
        await interaction.reply({
          content: t('modules.giveaways.notFoundActive'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const winners = await endGiveaway(ctx, interaction.guild, target);
      await interaction.editReply({
        content: winners.length
          ? t('modules.giveaways.endedManual', {
              winners: winners.map((w) => `<@${w}>`).join(', '),
            })
          : t('modules.giveaways.endedNoWinner'),
      });
      return;
    }

    if (sub === 'relancer') {
      const id = interaction.options.getString('id', true);
      const winner = interaction.options.getUser('gagnant');
      const target = await ctx.db.giveaway.findFirst({ where: { id, guildId, status: 'ended' } });
      if (!target) {
        await interaction.reply({
          content: t('modules.giveaways.notFoundEnded'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (winner) {
        const result = await rerollOne(ctx, interaction.guild, target, winner.id);
        await interaction.editReply({
          content: result.ok
            ? t('modules.giveaways.rerolledOne', {
                old: `<@${result.oldId}>`,
                new: `<@${result.newId}>`,
              })
            : t(`modules.giveaways.reroll.${result.error}`),
        });
        return;
      }
      const winners = await rerollAll(ctx, interaction.guild, target);
      await interaction.editReply({
        content: winners.length
          ? t('modules.giveaways.rerolledAll', {
              winners: winners.map((w) => `<@${w}>`).join(', '),
            })
          : t('modules.giveaways.endedNoWinner'),
      });
      return;
    }

    // sub === 'liste'
    const list = await ctx.db.giveaway.findMany({
      where: { guildId, status: 'active' },
      orderBy: { endsAt: 'asc' },
      take: 20,
    });
    if (list.length === 0) {
      await interaction.reply({
        content: t('modules.giveaways.listEmpty'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = list.map((g) =>
      t('modules.giveaways.listLine', {
        prize: g.prize,
        id: g.id.slice(0, 6),
        ends: `<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`,
        channel: `<#${g.channelId}>`,
      }),
    );
    await interaction.reply({
      embeds: [
        infoEmbed({ title: t('modules.giveaways.listTitle'), description: lines.join('\n') }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
