import { MessageFlags } from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getReportsConfig, MODULE_NAME } from './config.js';
import { buildReportComponents, buildReportEmbed, isReportStaff } from './service.js';

const ACTION_STATUS: Record<string, 'taken' | 'resolved' | 'ignored'> = {
  take: 'taken',
  resolve: 'resolved',
  ignore: 'ignored',
};

export const reportsComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;

    const [, action, id] = interaction.customId.split('|');
    const nextStatus = ACTION_STATUS[action ?? ''];
    if (!id || !nextStatus) return;

    if (!(await ctx.config.isEnabled(interaction.guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('errors.moduleDisabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await getReportsConfig(ctx, interaction.guildId);
    if (!isReportStaff(interaction.member, config)) {
      await interaction.reply({
        content: t('modules.reports.feedback.staffOnly'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const report = await ctx.db.report.findUnique({ where: { id } });
    if (!report || report.guildId !== interaction.guildId) {
      await interaction.reply({
        content: t('modules.reports.feedback.gone'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (report.status === 'resolved' || report.status === 'ignored') {
      await interaction.reply({
        content: t('modules.reports.feedback.closed'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await ctx.db.report.update({
      where: { id: report.id },
      data:
        nextStatus === 'taken'
          ? { status: nextStatus, assigneeId: interaction.user.id }
          : {
              status: nextStatus,
              resolvedBy: interaction.user.id,
              resolvedAt: new Date(),
            },
    });

    await interaction.update({
      embeds: [buildReportEmbed(updated)],
      components: buildReportComponents(updated),
    });
  },
};
