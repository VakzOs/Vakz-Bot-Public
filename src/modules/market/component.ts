import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { formatMoney, getEconomyConfig } from '../economy/config.js';
import { buyListing, cancelListing } from './service.js';
import { renderBrowse, renderMine } from './view.js';

/** Routeur des composants de l'hôtel des ventes (préfixe `hdv`). */
export const marketComponent: ComponentHandler = {
  prefix: 'hdv',
  async handle(interaction, ctx) {
    if (!interaction.isMessageComponent()) return;
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const [, action, arg] = interaction.customId.split('|');

    if (action === 'page' && interaction.isButton()) {
      await interaction.update(
        await renderBrowse(ctx, guildId, Number.parseInt(arg ?? '0', 10) || 0),
      );
      return;
    }
    if (action === 'mine' && interaction.isButton()) {
      await interaction.update(await renderMine(ctx, guildId, interaction.user.id));
      return;
    }
    if (action === 'browse' && interaction.isButton()) {
      await interaction.update(await renderBrowse(ctx, guildId, 0));
      return;
    }

    if (action === 'buy' && interaction.isStringSelectMenu()) {
      const econ = await getEconomyConfig(ctx, guildId);
      const result = await buyListing(
        ctx,
        guildId,
        interaction.user.id,
        interaction.values[0] ?? '',
        1,
      );
      await interaction.update(await renderBrowse(ctx, guildId, 0));
      if (!result.ok) {
        await interaction
          .followUp({
            content: t(`modules.market.buy.${result.reason}`),
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
        return;
      }

      // Confirmation à l'acheteur.
      await interaction
        .followUp({
          content: t('modules.market.buy.done', {
            qty: result.qty,
            emoji: result.item.emoji,
            name: result.item.name,
            cost: formatMoney(econ, result.cost),
            seller: `<@${result.sellerId}>`,
            balance: formatMoney(econ, result.balance),
          }),
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => undefined);

      // Notification au VENDEUR (absent) par MP — best effort (MP fermés = ignoré).
      const buyerName = interaction.member?.displayName ?? interaction.user.username;
      const notice = t('modules.market.buy.sellerNotice', {
        guild: interaction.guild?.name ?? '',
        buyer: buyerName,
        qty: result.qty,
        emoji: result.item.emoji,
        name: result.item.name,
        total: formatMoney(econ, result.cost),
        gain: formatMoney(econ, result.sellerGain),
        tax:
          result.tax > 0
            ? t('modules.market.buy.taxNote', { tax: formatMoney(econ, result.tax) })
            : '',
      });
      void ctx.client.users
        .fetch(result.sellerId)
        .then((user) => user.send({ content: notice }))
        .catch(() => undefined);
      return;
    }

    if (action === 'cancel' && interaction.isStringSelectMenu()) {
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
      const result = await cancelListing(
        ctx,
        guildId,
        interaction.user.id,
        interaction.values[0] ?? '',
        isAdmin,
      );
      await interaction.update(await renderMine(ctx, guildId, interaction.user.id));
      const content = result.ok
        ? t('modules.market.cancel.done', {
            qty: result.qty,
            emoji: result.item.emoji,
            name: result.item.name,
          })
        : t(`modules.market.cancel.${result.reason}`);
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }
  },
};
