import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, withEmoji } from '../../lib/embeds.js';
import { LAST_DAY, MODULE_NAME, getAdventConfig } from './config.js';
import { currentAdventDay, openDoor, openedDays, rewardForDay } from './service.js';

const XMAS_GREEN = 0x2ecc71;

async function ephemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Grille visuelle des 24 portes selon leur état pour le membre. */
function calendarGrid(opened: Set<number>, today: number): string {
  const cells: string[] = [];
  for (let day = 1; day <= LAST_DAY; day += 1) {
    const label = String(day).padStart(2, '0');
    let icon = '🔒';
    if (opened.has(day)) icon = '✅';
    else if (day <= today) icon = '🎁';
    cells.push(`${icon}\`${label}\``);
  }
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += 6) {
    lines.push(cells.slice(i, i + 6).join(' '));
  }
  return lines.join('\n');
}

export const advent: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('avent')
    .setDescription(t('modules.advent.command.description'))
    .addSubcommand((sub) =>
      sub
        .setName('ouvrir')
        .setDescription(t('modules.advent.command.open'))
        .addIntegerOption((opt) =>
          opt
            .setName('jour')
            .setDescription(t('modules.advent.command.dayOption'))
            .setMinValue(1)
            .setMaxValue(LAST_DAY)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('calendrier').setDescription(t('modules.advent.command.calendar')),
    ),

  async execute(interaction, ctx: BotContext) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;

    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await ephemeral(interaction, t('modules.advent.feedback.disabled'));
      return;
    }

    const config = await getAdventConfig(ctx, guildId);
    const today = currentAdventDay(config);
    const sub = interaction.options.getSubcommand();

    if (sub === 'calendrier') {
      const opened = new Set(await openedDays(ctx, guildId, interaction.user.id));
      const grid = calendarGrid(opened, today);
      const description = config.testMode
        ? `${t('modules.advent.calendar.testBadge')}\n${grid}`
        : grid;
      const embed = new EmbedBuilder()
        .setColor(XMAS_GREEN)
        .setTitle(withEmoji(t('modules.advent.calendar.title'), '🎄'))
        .setDescription(description)
        .setFooter({
          text: today
            ? t('modules.advent.calendar.footerOpen', { day: today, opened: opened.size })
            : t('modules.advent.calendar.footerClosed'),
        });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // sub === 'ouvrir'
    if (today === 0) {
      await ephemeral(interaction, t('modules.advent.feedback.closed'));
      return;
    }

    const day = interaction.options.getInteger('jour') ?? today;
    const result = await openDoor(ctx, interaction.member, config, day);

    if (!result.ok) {
      const key =
        result.reason === 'already'
          ? 'modules.advent.feedback.already'
          : result.reason === 'locked'
            ? 'modules.advent.feedback.locked'
            : 'modules.advent.feedback.closed';
      await ephemeral(interaction, t(key, { day }));
      return;
    }

    const reward = rewardForDay(config, result.day);
    const lines: string[] = [];
    if (result.coins > 0) lines.push(t('modules.advent.reward.coins', { coins: result.coins }));
    for (const item of result.items) {
      lines.push(t('modules.advent.reward.item', { qty: item.qty, item: item.name }));
    }
    if (!lines.length) lines.push(t('modules.advent.reward.nothing'));
    const flavour = result.message || reward.message;

    const embed = new EmbedBuilder()
      .setColor(Colors.success)
      .setTitle(withEmoji(t('modules.advent.reward.title', { day: result.day }), Emojis.gift))
      .setDescription(lines.join('\n') + (flavour ? `\n\n${flavour}` : ''));
    if (result.balance !== null) {
      embed.setFooter({ text: t('modules.advent.reward.balance', { balance: result.balance }) });
    }

    // Lien du jour : bouton Lien uniquement si une URL http(s) valide est réglée.
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (reward.link && /^https?:\/\//i.test(reward.link)) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setURL(reward.link)
            .setLabel(t('modules.advent.reward.linkButton')),
        ),
      );
    }

    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  },
};
