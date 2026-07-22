import {
  AttachmentBuilder,
  type EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { levelProgress } from './curve.js';
import { renderRankCard } from './card.js';
import { getLevelsConfig } from './config.js';
import { type RankInfo, getLeaderboard, getRank } from './service.js';

function progressBar(current: number, needed: number, size = 12): string {
  const ratio = needed > 0 ? Math.min(current / needed, 1) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, size - filled));
}

function rankEmbed(
  username: string,
  avatarUrl: string,
  info: RankInfo,
  progress: { current: number; needed: number },
): EmbedBuilder {
  return infoEmbed({ title: t('modules.levels.commands.rang.title', { user: username }) })
    .setThumbnail(avatarUrl)
    .addFields(
      { name: t('modules.levels.commands.rang.level'), value: `${info.level}`, inline: true },
      { name: t('modules.levels.commands.rang.rank'), value: `#${info.rank}`, inline: true },
      { name: t('modules.levels.commands.rang.xp'), value: `${info.xp}`, inline: true },
      {
        name: t('modules.levels.commands.rang.progress'),
        value: `${progressBar(progress.current, progress.needed)}\n\`${progress.current} / ${progress.needed} XP\``,
      },
    );
}

/** `/rang` — affiche une carte (image) avec le niveau, l'XP et le rang d'un membre. */
export const rang: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('rang')
    .setDescription(t('modules.levels.commands.rang.description'))
    .addUserOption((option) =>
      option.setName('membre').setDescription(t('modules.levels.commands.rang.member')),
    ),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const target = interaction.options.getUser('membre') ?? interaction.user;
    const info = await getRank(ctx, guildId, target.id);

    if (!info) {
      await interaction.reply({
        content: t('modules.levels.commands.rang.noXp'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await getLevelsConfig(ctx, guildId);
    const progress = levelProgress(info.xp, config.curveFactor);
    await interaction.deferReply();

    try {
      const buffer = await renderRankCard({
        username: target.username,
        avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
        level: progress.level,
        rank: info.rank,
        xp: info.xp,
        currentXp: progress.current,
        neededXp: progress.needed,
        accentColor: config.cardColor,
      });
      await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'rang.png' })] });
    } catch (error) {
      ctx.logger.error({ err: error }, 'Échec du rendu de la carte de rang, repli sur embed');
      await interaction.editReply({
        embeds: [
          rankEmbed(target.username, target.displayAvatarURL({ size: 256 }), info, progress),
        ],
      });
    }
  },
};

/** `/classement` — affiche le top des membres par XP. */
export const classement: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription(t('modules.levels.commands.leaderboard.description')),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const top = await getLeaderboard(ctx, guildId, 10);
    if (top.length === 0) {
      await interaction.reply({
        content: t('modules.levels.commands.leaderboard.empty'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((entry, index) => {
      const rank = medals[index] ?? `**${index + 1}.**`;
      return `${rank} <@${entry.userId}> — ${t('modules.levels.commands.rang.level')} ${entry.level} · ${entry.xp} XP`;
    });

    const embed = infoEmbed({
      title: t('modules.levels.commands.leaderboard.title'),
      description: lines.join('\n'),
    });

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
