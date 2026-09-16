import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getReportsConfig, MODULE_NAME } from './config.js';
import { buildReportComponents, buildReportEmbed, parseMessageLink } from './service.js';

export const report: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription(t('modules.reports.command.description'))
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.reports.command.member')).setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName('raison')
        .setDescription(t('modules.reports.command.reason'))
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription(t('modules.reports.command.message')).setMaxLength(200),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const config = await getReportsConfig(ctx, interaction.guildId);
    if (!config.channelId) {
      await interaction.editReply({ content: t('modules.reports.notConfigured') });
      return;
    }

    const target = interaction.options.getUser('membre', true);
    if (target.id === interaction.user.id) {
      await interaction.editReply({ content: t('modules.reports.selfReport') });
      return;
    }

    const reportChannel = await interaction.guild.channels
      .fetch(config.channelId)
      .catch(() => null);
    if (reportChannel?.type !== ChannelType.GuildText) {
      await interaction.editReply({ content: t('modules.reports.channelGone') });
      return;
    }

    const rawMessageLink = interaction.options.getString('message')?.trim() ?? null;
    const messageLink = parseMessageLink(rawMessageLink, interaction.guildId);
    if (rawMessageLink && !messageLink) {
      await interaction.editReply({ content: t('modules.reports.invalidMessageLink') });
      return;
    }
    const reason = interaction.options.getString('raison', true).trim();
    const record = await ctx.db.report.create({
      data: {
        guildId: interaction.guildId,
        reporterId: interaction.user.id,
        targetId: target.id,
        reason,
        sourceChannelId: messageLink?.channelId ?? interaction.channelId,
        sourceMessageId: messageLink?.messageId ?? null,
        reportChannelId: reportChannel.id,
      },
    });

    try {
      const sent = await reportChannel.send({
        embeds: [buildReportEmbed(record)],
        components: buildReportComponents(record),
      });
      await ctx.db.report.update({ where: { id: record.id }, data: { reportMessageId: sent.id } });

      const thread = await reportChannel.threads.create({
        name: t('modules.reports.threadName', { id: record.id.slice(0, 8) }),
        type: ChannelType.PrivateThread,
        invitable: false,
      });
      await thread.members.add(interaction.user.id).catch(() => undefined);
      await thread.send({
        content: t('modules.reports.threadIntro', {
          reporter: `<@${interaction.user.id}>`,
          target: `<@${target.id}>`,
        }),
      });
      await sent.edit({
        content: t('modules.reports.staffThreadLine', { thread: `<#${thread.id}>` }),
      });

      await interaction.editReply({
        content: t('modules.reports.submittedWithThread', { thread: `<#${thread.id}>` }),
      });
    } catch (error) {
      await ctx.db.report.delete({ where: { id: record.id } }).catch(() => undefined);
      ctx.logger.warn(
        { err: error, guildId: interaction.guildId, module: MODULE_NAME },
        'Report send failed',
      );
      await interaction.editReply({ content: t('modules.reports.sendError') });
    }
  },
};
