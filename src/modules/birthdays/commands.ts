import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { env } from '../../core/env.js';
import { t } from '../../core/i18n.js';
import { Emojis, infoEmbed } from '../../lib/embeds.js';
import {
  daysUntil,
  getBirthday,
  getUpcoming,
  isValidDate,
  removeBirthday,
  setBirthday,
} from './service.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function whenLabel(days: number): string {
  return days === 0 ? t('modules.birthdays.today') : t('modules.birthdays.inDays', { days });
}

/** `/anniversaire` — gestion de sa date d'anniversaire. */
export const anniversaire: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('anniversaire')
    .setDescription(t('modules.birthdays.command.description'))
    .addSubcommand((s) =>
      s
        .setName('definir')
        .setDescription(t('modules.birthdays.command.set'))
        .addIntegerOption((o) =>
          o
            .setName('jour')
            .setDescription(t('modules.birthdays.opt.day'))
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(31),
        )
        .addIntegerOption((o) =>
          o
            .setName('mois')
            .setDescription(t('modules.birthdays.opt.month'))
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(12),
        )
        .addIntegerOption((o) =>
          o
            .setName('annee')
            .setDescription(t('modules.birthdays.opt.year'))
            .setMinValue(1900)
            .setMaxValue(2100),
        )
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.birthdays.opt.targetMember')),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription(t('modules.birthdays.command.remove'))
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.birthdays.opt.targetMember')),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('voir')
        .setDescription(t('modules.birthdays.command.view'))
        .addUserOption((o) => o.setName('membre').setDescription(t('modules.birthdays.opt.member'))),
    )
    .addSubcommand((s) =>
      s.setName('prochains').setDescription(t('modules.birthdays.command.upcoming')),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    // Cibler un autre membre (definir/retirer) est réservé aux admins.
    const otherUser = interaction.options.getUser('membre');
    const targetingOther = !!otherUser && otherUser.id !== interaction.user.id;
    const canManageOthers =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

    if (sub === 'definir') {
      if (targetingOther && !canManageOthers) {
        await interaction.reply({
          content: t('modules.birthdays.noPermission'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const day = interaction.options.getInteger('jour', true);
      const month = interaction.options.getInteger('mois', true);
      const year = interaction.options.getInteger('annee');
      if (!isValidDate(day, month)) {
        await interaction.reply({
          content: t('modules.birthdays.invalidDate'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const targetId = otherUser?.id ?? interaction.user.id;
      const date = `${pad(day)}/${pad(month)}`;
      await setBirthday(ctx, guildId, targetId, day, month, year);
      await interaction.reply({
        content: targetingOther
          ? t('modules.birthdays.setOther', { user: `<@${targetId}>`, date })
          : t('modules.birthdays.set', { date }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'retirer') {
      if (targetingOther && !canManageOthers) {
        await interaction.reply({
          content: t('modules.birthdays.noPermission'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const targetId = otherUser?.id ?? interaction.user.id;
      await removeBirthday(ctx, guildId, targetId);
      await interaction.reply({
        content: targetingOther
          ? t('modules.birthdays.removedOther', { user: `<@${targetId}>` })
          : t('modules.birthdays.removed'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'voir') {
      const target = interaction.options.getUser('membre') ?? interaction.user;
      const bday = await getBirthday(ctx, guildId, target.id);
      if (!bday) {
        await interaction.reply({
          content: t('modules.birthdays.none', { user: `<@${target.id}>` }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const days = daysUntil(bday.day, bday.month, env.TZ);
      const dateStr = `${pad(bday.day)}/${pad(bday.month)}${bday.year ? `/${bday.year}` : ''}`;
      const embed = infoEmbed({
        title: t('modules.birthdays.view.title', { user: target.username }),
        description: `🎂 **${dateStr}** — ${whenLabel(days)}`,
        emoji: Emojis.cake,
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    // prochains
    const upcoming = await getUpcoming(ctx, guildId, env.TZ, 10);
    if (upcoming.length === 0) {
      await interaction.reply({
        content: t('modules.birthdays.upcomingEmpty'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = upcoming.map(
      (b) => `<@${b.userId}> — **${pad(b.day)}/${pad(b.month)}** (${whenLabel(b.in)})`,
    );
    const embed = infoEmbed({
      title: t('modules.birthdays.upcomingTitle'),
      description: lines.join('\n'),
      emoji: Emojis.cake,
    });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
