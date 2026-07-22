import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { formatMoney, getEconomyConfig } from './config.js';
import {
  addBalance,
  claimDaily,
  getBalance,
  getLeaderboard,
  setBalance,
  transfer,
} from './service.js';

/** `/solde` — affiche le solde d'un membre. */
export const solde: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('solde')
    .setDescription(t('modules.economy.commands.balance.description'))
    .addUserOption((o) => o.setName('membre').setDescription(t('modules.economy.opt.member'))),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const config = await getEconomyConfig(ctx, interaction.guildId);
    const balance = await getBalance(ctx, interaction.guildId, target.id);
    const embed = infoEmbed({
      title: t('modules.economy.commands.balance.title', { user: target.username }),
      description: `${t('modules.economy.commands.balance.line')} : ${formatMoney(config, balance)}`,
    });
    await interaction.reply({ embeds: [embed] });
  },
};

/** `/daily` — réclame la récompense quotidienne. */
export const daily: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription(t('modules.economy.commands.daily.description')),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const config = await getEconomyConfig(ctx, interaction.guildId);
    const result = await claimDaily(
      ctx,
      interaction.guildId,
      interaction.user.id,
      config.dailyAmount,
    );

    if (!result.ok) {
      await interaction.reply({
        content: t('modules.economy.commands.daily.cooldown', {
          time: `<t:${Math.floor(result.nextAt.getTime() / 1000)}:R>`,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: t('modules.economy.commands.daily.claimed', {
        amount: formatMoney(config, result.amount),
        balance: formatMoney(config, result.balance),
      }),
    });
  },
};

/** `/payer` — transfère de la monnaie à un autre membre. */
export const payer: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('payer')
    .setDescription(t('modules.economy.commands.pay.description'))
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.economy.opt.member')).setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('montant')
        .setDescription(t('modules.economy.opt.amount'))
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const target = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('montant', true);
    const config = await getEconomyConfig(ctx, interaction.guildId);

    if (target.bot || target.id === interaction.user.id) {
      await interaction.reply({
        content: t('modules.economy.commands.pay.invalidTarget'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await transfer(ctx, interaction.guildId, interaction.user.id, target.id, amount);
    if (!result.ok) {
      await interaction.reply({
        content: t('modules.economy.commands.pay.insufficient'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: t('modules.economy.commands.pay.done', {
        amount: formatMoney(config, amount),
        user: `<@${target.id}>`,
      }),
    });
  },
};

/** `/riches` — classement des plus riches. */
export const riches: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('riches')
    .setDescription(t('modules.economy.commands.leaderboard.description')),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const config = await getEconomyConfig(ctx, interaction.guildId);
    const top = await getLeaderboard(ctx, interaction.guildId, 10);

    if (top.length === 0) {
      await interaction.reply({
        content: t('modules.economy.commands.leaderboard.empty'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map(
      (entry, index) =>
        `${medals[index] ?? `**${index + 1}.**`} <@${entry.userId}> — ${formatMoney(config, entry.balance)}`,
    );
    const embed = infoEmbed({
      title: t('modules.economy.commands.leaderboard.title', { currency: config.currencyName }),
      description: lines.join('\n'),
    });
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

/** `/eco` — gestion administrative des soldes (give / take / set). */
export const eco: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription(t('modules.economy.commands.admin.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('give')
        .setDescription(t('modules.economy.commands.admin.give'))
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.economy.opt.member')).setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('montant')
            .setDescription(t('modules.economy.opt.amount'))
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('take')
        .setDescription(t('modules.economy.commands.admin.take'))
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.economy.opt.member')).setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('montant')
            .setDescription(t('modules.economy.opt.amount'))
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription(t('modules.economy.commands.admin.set'))
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.economy.opt.member')).setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('montant')
            .setDescription(t('modules.economy.opt.amount'))
            .setRequired(true)
            .setMinValue(0),
        ),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('montant', true);
    const config = await getEconomyConfig(ctx, interaction.guildId);

    let balance: number;
    if (sub === 'give') {
      balance = await addBalance(ctx, interaction.guildId, target.id, amount);
    } else if (sub === 'take') {
      const current = await getBalance(ctx, interaction.guildId, target.id);
      balance = Math.max(0, current - amount);
      await setBalance(ctx, interaction.guildId, target.id, balance);
    } else {
      balance = amount;
      await setBalance(ctx, interaction.guildId, target.id, amount);
    }

    await interaction.reply({
      content: t('modules.economy.commands.admin.done', {
        user: `<@${target.id}>`,
        balance: formatMoney(config, balance),
      }),
      flags: MessageFlags.Ephemeral,
    });
  },
};
