import { type AutocompleteInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { formatMoney, getEconomyConfig } from '../economy/config.js';
import { getInventory, getItem } from '../items/service.js';
import { getMarketConfig } from './config.js';
import { createListing } from './service.js';
import { renderBrowse, renderMine } from './view.js';

/** Autocomplétion : objets ÉCHANGEABLES possédés par le membre. */
async function sellableAutocomplete(
  interaction: AutocompleteInteraction,
  ctx: BotContext,
): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused().toLowerCase();
  const inventory = await getInventory(ctx, interaction.guildId, interaction.user.id);
  const choices = inventory
    .filter(({ item }) => item.tradable)
    .filter(({ item }) => item.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(({ item, quantity }) => ({
      name: `${item.emoji} ${item.name} ×${quantity}`.slice(0, 100),
      value: item.id,
    }));
  await interaction.respond(choices);
}

export const hdv: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('hdv')
    .setDescription(t('modules.market.command.description'))
    .addSubcommand((s) => s.setName('parcourir').setDescription(t('modules.market.command.browse')))
    .addSubcommand((s) =>
      s
        .setName('vendre')
        .setDescription(t('modules.market.command.sell'))
        .addStringOption((o) =>
          o
            .setName('objet')
            .setDescription(t('modules.market.command.optItem'))
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('prix')
            .setDescription(t('modules.market.command.optPrice'))
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1_000_000),
        )
        .addIntegerOption((o) =>
          o
            .setName('quantité')
            .setDescription(t('modules.market.command.optQty'))
            .setMinValue(1)
            .setMaxValue(10_000),
        ),
    )
    .addSubcommand((s) =>
      s.setName('mes-annonces').setDescription(t('modules.market.command.mine')),
    ),

  async autocomplete(interaction, ctx) {
    await sellableAutocomplete(interaction, ctx);
  },

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'parcourir') {
      await interaction.reply({
        ...(await renderBrowse(ctx, guildId, 0)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (sub === 'mes-annonces') {
      await interaction.reply({
        ...(await renderMine(ctx, guildId, interaction.user.id)),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // sub === 'vendre'
    const itemId = interaction.options.getString('objet', true);
    const unitPrice = interaction.options.getInteger('prix', true);
    const qty = Math.max(1, interaction.options.getInteger('quantité') ?? 1);
    const item = await getItem(ctx, guildId, itemId);
    if (!item) {
      await interaction.reply({
        content: t('modules.items.commands.unknownItem'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!item.tradable) {
      await interaction.reply({
        content: t('modules.market.sell.notTradable', { emoji: item.emoji, name: item.name }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const econ = await getEconomyConfig(ctx, guildId);
    const config = await getMarketConfig(ctx, guildId);
    const result = await createListing(ctx, guildId, interaction.user.id, item, qty, unitPrice);

    if (!result.ok) {
      if (result.reason === 'tooCheap') {
        await interaction.reply({
          content: t('modules.market.sell.tooCheap', {
            emoji: item.emoji,
            name: item.name,
            min: formatMoney(econ, result.min),
          }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const key =
        result.reason === 'tooMany'
          ? 'modules.market.sell.tooMany'
          : 'modules.market.sell.notOwned';
      await interaction.reply({
        content: t(key, {
          emoji: item.emoji,
          name: item.name,
          max: config.maxListingsPerUser,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: t('modules.market.sell.done', {
        qty: result.listing.quantity,
        emoji: item.emoji,
        name: item.name,
        unit: formatMoney(econ, unitPrice),
      }),
    });
  },
};
