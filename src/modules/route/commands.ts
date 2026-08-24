import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttachmentBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import {
  Emojis,
  brandedEmbed,
  errorEmbed,
  infoEmbed,
  progressBar,
  rankLabel,
  withEmoji,
} from '../../lib/embeds.js';
import { getRouteConfig } from './config.js';
import { buildPeddlerRows, buildShopView } from './shop.js';
import {
  type MoveOutcome,
  type Traveler,
  applyEnergyRegen,
  cooldownState,
  getTraveler,
  leaderboard,
  move,
} from './service.js';

// dist/modules/route/commands.js -> ../../../assets/route || src -> idem
const ROUTE_ART_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/route');

/** Artwork de l'événement, s'il existe (assets/route/<clé>.jpg). */
function eventArtwork(eventKey: string): AttachmentBuilder | null {
  const path = join(ROUTE_ART_DIR, `${eventKey}.jpg`);
  if (!existsSync(path)) return null;
  return new AttachmentBuilder(path, { name: `${eventKey}.jpg` });
}

/** Barre de vie graphique (10 segments). */
function healthBar(health: number, max: number): string {
  return progressBar(max > 0 ? health / max : 0, 10);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Ligne récapitulative des effets d'un déplacement. */
function deltaLine(deltas: MoveOutcome['deltas']): string {
  const parts = [`📏 ${signed(deltas.distance)}`];
  if (deltas.health !== 0) parts.push(`❤️ ${signed(deltas.health)}`);
  if (deltas.energy !== 0) parts.push(`⚡ ${signed(deltas.energy)}`);
  if (deltas.coins !== 0) parts.push(`🪙 ${signed(deltas.coins)}`);
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
      deaths: traveler.deaths,
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
    b.addSubcommand((s) => s.setName('boutique').setDescription(t('modules.route.commands.shop')));
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
      const config = await getRouteConfig(ctx, interaction.guildId);
      // Énergie affichée = énergie effective APRÈS régénération passive.
      const shown: Traveler = { ...traveler, energy: applyEnergyRegen(traveler, config) };
      const embed = infoEmbed({
        title: t('modules.route.profileTitle', { user: user.username }),
        emoji: Emojis.compass,
      })
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .addFields(statsField(shown));
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'boutique') {
      const config = await getRouteConfig(ctx, interaction.guildId);
      await interaction.reply(buildShopView(config));
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
      const lines = rows.map(
        (row, index) => `${rankLabel(index)} <@${row.userId}> — 📏 **${row.distance}**`,
      );
      await interaction.reply({
        embeds: [
          infoEmbed({
            title: t('modules.route.leaderboardTitle'),
            description: lines.join('\n'),
            emoji: Emojis.trophy,
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
      (outcome.exhausted ? `\n\n${t('modules.route.exhausted')}` : '') +
      (outcome.fainted ? `\n\n${t('modules.route.fainted')}` : '');

    // Rouge 💀 si le voyageur tombe, embed brandé 🗺️ sinon.
    const embed = outcome.fainted
      ? errorEmbed({
          title: t('modules.route.moveTitle', { user: interaction.user.username }),
          description,
          emoji: '💀',
        })
      : brandedEmbed({
          title: withEmoji(t('modules.route.moveTitle', { user: interaction.user.username }), Emojis.map),
          description,
        });
    embed.addFields(statsField(outcome.traveler));

    // Artwork de l'événement en pièce jointe (assets/route/<clé>.jpg) si présent.
    const artwork = eventArtwork(outcome.eventKey);
    if (artwork) embed.setImage(`attachment://${outcome.eventKey}.jpg`);

    // Marchand ambulant : boutons d'achat à prix cassés (réservés au voyageur).
    const components =
      outcome.eventKey === 'peddler' ? buildPeddlerRows(config, interaction.user.id) : [];

    await interaction.reply({
      embeds: [embed],
      files: artwork ? [artwork] : [],
      components,
    });
  },
};

export const routeCommands: SlashCommand[] = [avancer];
