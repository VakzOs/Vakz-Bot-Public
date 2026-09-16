import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { formatMoney, getEconomyConfig, type EconomyConfig } from '../economy/config.js';
import { PAGE_SIZE, countActiveListings, listActiveListings, userListings } from './service.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
export interface View {
  embeds: EmbedBuilder[];
  components: Row[];
}

function newRow(): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function m(config: EconomyConfig, n: number): string {
  return formatMoney(config, n);
}

/** Page de l'hôtel des ventes : annonces + sélecteur d'achat + navigation. */
export async function renderBrowse(ctx: BotContext, guildId: string, page: number): Promise<View> {
  const econ = await getEconomyConfig(ctx, guildId);
  const total = await countActiveListings(ctx, guildId);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const listings = await listActiveListings(ctx, guildId, p);

  const embed = infoEmbed({
    title: t('modules.market.browse.title'),
    description: total === 0 ? t('modules.market.browse.empty') : t('modules.market.browse.intro'),
  });
  if (listings.length) {
    embed.setDescription(
      listings
        .map((l, i) =>
          t('modules.market.browse.line', {
            n: p * PAGE_SIZE + i + 1,
            emoji: l.item.emoji,
            name: l.item.name,
            qty: l.quantity,
            unit: m(econ, l.unitPrice),
            seller: `<@${l.sellerId}>`,
          }),
        )
        .join('\n'),
    );
  }
  embed.setFooter({ text: t('modules.market.browse.footer', { page: p + 1, pages, total }) });

  const components: Row[] = [];
  if (listings.length) {
    components.push(
      newRow().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hdv|buy')
          .setPlaceholder(t('modules.market.browse.buyPlaceholder'))
          .addOptions(
            listings.map((l) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${l.item.name} ×${l.quantity}`.slice(0, 100))
                .setValue(l.id)
                .setDescription(
                  t('modules.market.browse.buyOption', { unit: m(econ, l.unitPrice) }).slice(
                    0,
                    100,
                  ),
                ),
            ),
          ),
      ),
    );
  }
  components.push(
    newRow().addComponents(
      new ButtonBuilder()
        .setCustomId(`hdv|page|${p - 1}`)
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p <= 0),
      new ButtonBuilder()
        .setCustomId(`hdv|page|${p + 1}`)
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(p >= pages - 1),
      new ButtonBuilder()
        .setCustomId(`hdv|page|${p}`)
        .setEmoji('\u{1F504}')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('hdv|mine')
        .setLabel(t('modules.market.browse.mine'))
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return { embeds: [embed], components };
}

/** Vue « mes annonces » : liste + sélecteur d'annulation. */
export async function renderMine(ctx: BotContext, guildId: string, userId: string): Promise<View> {
  const econ = await getEconomyConfig(ctx, guildId);
  const listings = await userListings(ctx, guildId, userId);

  const embed = infoEmbed({
    title: t('modules.market.mine.title'),
    description: listings.length ? t('modules.market.mine.intro') : t('modules.market.mine.empty'),
  });
  if (listings.length) {
    embed.setDescription(
      listings
        .map((l, i) =>
          t('modules.market.mine.line', {
            n: i + 1,
            emoji: l.item.emoji,
            name: l.item.name,
            qty: l.quantity,
            unit: m(econ, l.unitPrice),
          }),
        )
        .join('\n'),
    );
  }

  const components: Row[] = [];
  if (listings.length) {
    components.push(
      newRow().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('hdv|cancel')
          .setPlaceholder(t('modules.market.mine.cancelPlaceholder'))
          .addOptions(
            listings.map((l) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${l.item.name} ×${l.quantity}`.slice(0, 100))
                .setValue(l.id)
                .setDescription(m(econ, l.unitPrice).slice(0, 100)),
            ),
          ),
      ),
    );
  }
  components.push(
    newRow().addComponents(
      new ButtonBuilder()
        .setCustomId('hdv|browse')
        .setLabel(t('modules.market.mine.back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components };
}
