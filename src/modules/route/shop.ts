import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  MessageFlags,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Emojis, brandedEmbed, withEmoji } from '../../lib/embeds.js';
import type { RouteConfig } from './config.js';
import { GOODS, type GoodKey, buyGood, peddlerBuy } from './service.js';

export const GOOD_KEYS = Object.keys(GOODS) as GoodKey[];

export function goodName(good: GoodKey): string {
  return t(`modules.route.goods.${good}.name`);
}

function goodEffect(good: GoodKey): string {
  const effect = GOODS[good];
  const parts: string[] = [];
  if (effect.health !== 0) parts.push(`❤️ +${effect.health}`);
  if (effect.energy !== 0) parts.push(`⚡ +${effect.energy}`);
  return parts.join(' • ');
}

/** Vue de la boutique de la Route : embed + boutons d'achat (effet immédiat). */
export function buildShopView(config: RouteConfig): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const embed = brandedEmbed({
    title: withEmoji(t('modules.route.shop.title'), Emojis.coin),
    description: GOOD_KEYS.map(
      (good) =>
        `${goodName(good)} — ${goodEffect(good)}\n🪙 **${config.shopPrices[good]}** • ${t(`modules.route.goods.${good}.desc`)}`,
    ).join('\n\n'),
  });

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    GOOD_KEYS.map((good) =>
      new ButtonBuilder()
        .setCustomId(`route|buy|${good}`)
        .setLabel(t('modules.route.shop.buyButton', { name: goodName(good) }).slice(0, 80))
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return { embeds: [embed], components: [row] };
}

/** Boutons d'achat à prix cassés de l'événement marchand ambulant. */
export function buildPeddlerRows(
  config: RouteConfig,
  userId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      GOOD_KEYS.map((good) =>
        new ButtonBuilder()
          .setCustomId(`route|peddler|${good}|${userId}`)
          .setLabel(
            t('modules.route.peddler.buyButton', {
              name: goodName(good),
              price: config.peddlerPrices[good],
            }).slice(0, 80),
          )
          .setStyle(ButtonStyle.Success),
      ),
    ),
  ];
}

/** Gère les achats boutique (`route|buy|<good>`) et marchand (`route|peddler|<good>|<userId>`). */
export const routeComponent: ComponentHandler = {
  prefix: 'route',
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inGuild()) return;
    const [, kind, good, ownerId] = interaction.customId.split('|');
    if (!good || !(good in GOODS)) return;

    const reply = (key: string, vars?: Record<string, string | number>) =>
      interaction.reply({ content: t(key, vars), flags: MessageFlags.Ephemeral });

    if (kind !== 'buy' && kind !== 'peddler') return;

    // Les boutons du marchand ambulant ne concernent que le voyageur de l'événement.
    if (kind === 'peddler' && ownerId && interaction.user.id !== ownerId) {
      await reply('modules.route.peddler.notYours');
      return;
    }

    const purchase = kind === 'buy' ? buyGood : peddlerBuy;
    const result = await purchase(ctx, interaction.guildId, interaction.user.id, good as GoodKey);
    if (!result.ok) {
      await reply('modules.route.shop.tooPoor', { price: result.price, balance: result.balance });
      return;
    }
    await reply('modules.route.shop.bought', {
      name: goodName(good as GoodKey),
      effect: goodEffect(good as GoodKey),
      price: result.price,
      balance: result.balance,
    });
  },
};
