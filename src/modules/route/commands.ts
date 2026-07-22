import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, infoEmbed } from '../../lib/embeds.js';
import { getRouteConfig } from './config.js';
import {
  type MoveOutcome,
  type Traveler,
  cooldownState,
  getTraveler,
  leaderboard,
  move,
} from './service.js';

/** Barre de vie graphique (10 segments). */
function healthBar(health: number, max: number): string {
  const filled = Math.round((Math.max(0, health) / max) * 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Ligne récapitulative des effets d'un déplacement. */
function deltaLine(deltas: MoveOutcome['deltas']): string {
  const parts = [`📏 +${Math.max(0, deltas.distance)}`];
  if (deltas.health !== 0) parts.push(`❤️ ${signed(deltas.health)}`);
  if (deltas.energy !== 0) parts.push(`⚡ ${signed(deltas.energy)}`);
  if (deltas.coins > 0) parts.push(`🪙 +${deltas.coins}`);
  return parts.join(' • ');
}

function statsField(traveler: Traveler): { name: string; value: string } {
  return {
    name: t('modules.route.stats.title'),
    value: t('modules.route.stats.body', {
      bar: healthBar(traveler.health, traveler.maxHealth),
      health: traveler.health,
      maxHealth: traveler.maxHealth,
      energy: traveler.energy,
      distance: traveler.distance,
      coins: traveler.coins,
      events: traveler.events,
    }),
  };
}

const avancer: SlashCommand = {
  data: (() => {
    const b = new SlashCommandBuilder()
      .setName('route')
      .setDescription(t('modules.route.description'));
    b.addSubcommand((s) => s.setName('avancer').setDescription(t('modules.route.commands.move')));
    b.addSubcommand((s) =>
      s
        .setName('profil')
        .setDescription(t('modules.route.commands.profile'))
        .addUserOption((o) => o.setName('membre').setDescription(t('modules.route.opt.member'))),
    );
    b.addSubcommand((s) =>
      s.setName('classement').setDescription(t('modules.route.commands.leaderboard')),
    );
    return b;
  })(),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'profil') {
      const user = interaction.options.getUser('membre') ?? interaction.user;
      const traveler = await getTraveler(ctx, interaction.guildId, user.id);
      if (!traveler) {
        await interaction.reply({
          content: t('modules.route.noTraveler', { user: user.username }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const embed = infoEmbed({
        title: t('modules.route.profileTitle', { user: user.username }),
      })
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .addFields(statsField(traveler));
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'classement') {
      const rows = await leaderboard(ctx, interaction.guildId, 10);
      if (rows.length === 0) {
        await interaction.reply({
          content: t('modules.route.leaderboardEmpty'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      const lines = rows.map(
        (row, index) =>
          `${medals[index] ?? `**${index + 1}.**`} <@${row.userId}> — 📏 **${row.distance}**`,
      );
      await interaction.reply({
        embeds: [
          infoEmbed({
            title: t('modules.route.leaderboardTitle'),
            description: lines.join('\n'),
          }),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    // sub === 'avancer'
    const config = await getRouteConfig(ctx, interaction.guildId);
    const existing = await getTraveler(ctx, interaction.guildId, interaction.user.id);
    const cd = cooldownState(existing, config);
    if (!cd.ready && cd.nextAt) {
      await interaction.reply({
        content: t('modules.route.cooldown', {
          time: `<t:${Math.floor(cd.nextAt.getTime() / 1000)}:R>`,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const outcome = await move(ctx, interaction.guildId, interaction.user.id);
    const description =
      `${t(`modules.route.events.${outcome.eventKey}`)}\n\n${deltaLine(outcome.deltas)}` +
      (outcome.itemFound
        ? `\n${t('modules.route.itemFound', { emoji: outcome.itemFound.emoji, name: outcome.itemFound.name })}`
        : '') +
      (outcome.fainted ? `\n\n${t('modules.route.fainted')}` : '');

    const embed = new EmbedBuilder()
      .setColor(outcome.fainted ? Colors.error : Colors.brand)
      .setTitle(t('modules.route.moveTitle', { user: interaction.user.username }))
      .setDescription(description)
      .addFields(statsField(outcome.traveler));
    await interaction.reply({ embeds: [embed] });
  },
};

export const routeCommands: SlashCommand[] = [avancer];
