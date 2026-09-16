import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ComponentHandler, SlashCommand } from '../../core/module.js';
import { brandedEmbed } from '../../lib/embeds.js';
import { t } from '../../core/i18n.js';
import {
  MODULE_NAME,
  type EconomyConfig,
  type Shop,
  formatMoney,
  getEconomyConfig,
  updateEconomyConfig,
} from './config.js';
import { addBalance, getBalance } from './service.js';

/** Indicateur de stock d'un article (vide si illimité). */
function stockLabel(stock: number): string {
  if (stock < 0) return '';
  return stock === 0
    ? ` — ${t('modules.economy.shop.soldOut')}`
    : ` — ${t('modules.economy.shop.stock', { n: stock })}`;
}

/** Vue d'une boutique : embed (nom + bannière + articles) et boutons d'achat. */
function buildShopView(
  config: EconomyConfig,
  guild: Guild,
  shopId?: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  if (config.shops.length === 0) {
    return {
      embeds: [
        brandedEmbed({
          title: t('modules.economy.shop.title'),
          description: t('modules.economy.shop.empty'),
        }),
      ],
      components: [],
    };
  }

  const shop: Shop = config.shops.find((entry) => entry.id === shopId) ?? config.shops[0]!;
  const lines = shop.items.length
    ? shop.items.map(
        (item) =>
          `<@&${item.roleId}> — ${formatMoney(config, item.price)}${stockLabel(item.stock)}`,
      )
    : [t('modules.economy.shop.empty')];

  const embed = brandedEmbed({ title: shop.name, description: lines.join('\n') });
  if (shop.bannerUrl) embed.setImage(shop.bannerUrl);

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Sélecteur de boutique si le serveur en a plusieurs.
  if (config.shops.length > 1) {
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('eco|shop')
          .setPlaceholder(t('modules.economy.shop.switch'))
          .addOptions(
            config.shops.slice(0, 25).map((entry) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(entry.name.slice(0, 100))
                .setValue(entry.id)
                .setDefault(entry.id === shop.id),
            ),
          ),
      ),
    );
  }

  // Boutons d'achat (5 par rangée ; on garde une rangée pour le sélecteur).
  const maxRows = config.shops.length > 1 ? 4 : 5;
  for (let i = 0; i < shop.items.length && components.length < maxRows; i += 5) {
    const rowBuilder = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (const item of shop.items.slice(i, i + 5)) {
      const name = guild.roles.cache.get(item.roleId)?.name ?? item.roleId;
      rowBuilder.addComponents(
        new ButtonBuilder()
          .setCustomId(`eco|buy|${shop.id}|${item.roleId}`)
          .setLabel(`${name} • ${item.price}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(item.stock === 0),
      );
    }
    components.push(rowBuilder);
  }

  return { embeds: [embed], components };
}

/** `/boutique` — affiche une boutique de rôles avec ses boutons d'achat. */
export const boutique: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('boutique')
    .setDescription(t('modules.economy.commands.shop.description')),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const config = await getEconomyConfig(ctx, interaction.guildId);
    await interaction.reply(buildShopView(config, interaction.guild));
  },
};

/** Gère le changement de boutique et les achats (`eco|shop`, `eco|buy|<shop>|<role>`). */
export const economyComponent: ComponentHandler = {
  prefix: 'eco',
  async handle(interaction, ctx) {
    if (!interaction.isMessageComponent() || !interaction.inCachedGuild()) return;
    const kind = interaction.customId.split('|')[1];
    const guildId = interaction.guildId;

    const reply = (key: string, vars?: Record<string, string | number>) =>
      interaction.isRepliable()
        ? interaction.reply({ content: t(key, vars), flags: MessageFlags.Ephemeral })
        : Promise.resolve();

    if (kind === 'shop' && interaction.isStringSelectMenu()) {
      const config = await getEconomyConfig(ctx, guildId);
      await interaction.update(buildShopView(config, interaction.guild, interaction.values[0]));
      return;
    }

    if (kind !== 'buy' || !interaction.isButton()) return;

    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await reply('modules.economy.shop.disabled');
      return;
    }

    const [, , shopId, roleId] = interaction.customId.split('|');
    const config = await getEconomyConfig(ctx, guildId);
    const shop = config.shops.find((entry) => entry.id === shopId);
    const item = shop?.items.find((entry) => entry.roleId === roleId);
    if (!shop || !item || !roleId) {
      await reply('modules.economy.shop.unavailable');
      return;
    }

    const member = interaction.member;
    if (member.roles.cache.has(roleId)) {
      await reply('modules.economy.shop.alreadyOwned');
      return;
    }

    if (item.stock === 0) {
      await reply('modules.economy.shop.outOfStock');
      return;
    }

    const guild = interaction.guild;
    const role = guild.roles.cache.get(roleId);
    const me = guild.members.me;
    if (
      !role ||
      !me ||
      !me.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.position >= me.roles.highest.position
    ) {
      await reply('modules.economy.shop.cannotAssign');
      return;
    }

    const balance = await getBalance(ctx, guildId, member.id);
    if (balance < item.price) {
      await reply('modules.economy.shop.tooPoor', {
        price: formatMoney(config, item.price),
        balance: formatMoney(config, balance),
      });
      return;
    }

    try {
      await member.roles.add(roleId, 'Achat boutique');
    } catch (error) {
      ctx.logger.warn({ err: error, roleId, guildId }, 'Échec attribution rôle boutique');
      await reply('modules.economy.shop.cannotAssign');
      return;
    }

    await addBalance(ctx, guildId, member.id, -item.price);

    // Décrémente le stock (hors illimité) et persiste.
    if (item.stock > 0) {
      const shops = config.shops.map((entry) =>
        entry.id === shop.id
          ? {
              ...entry,
              items: entry.items.map((it) =>
                it.roleId === roleId ? { ...it, stock: it.stock - 1 } : it,
              ),
            }
          : entry,
      );
      await updateEconomyConfig(ctx, guildId, { shops });
    }

    await reply('modules.economy.shop.bought', {
      role: `<@&${roleId}>`,
      price: formatMoney(config, item.price),
    });
  },
};
