import {
  type AutocompleteInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { formatMoney, getEconomyConfig } from '../economy/config.js';
import { addBalance, getBalance } from '../economy/service.js';
import { getItemsConfig } from './config.js';
import {
  type Item,
  addToInventory,
  getInventory,
  getItem,
  getQuantity,
  listItems,
  rarityColor,
  rarityLabel,
  takeFromInventory,
} from './service.js';

/** Autocomplétion des objets, filtrable (achetables, utilisables, etc.). */
function itemAutocomplete(filter?: (item: Item) => boolean) {
  return async (interaction: AutocompleteInteraction, ctx: BotContext): Promise<void> => {
    if (!interaction.inGuild()) {
      await interaction.respond([]);
      return;
    }
    const focused = interaction.options.getFocused().toLowerCase();
    const items = await listItems(ctx, interaction.guildId);
    const choices = items
      .filter((item) => !filter || filter(item))
      .filter((item) => item.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((item) => ({ name: `${item.emoji} ${item.name}`.slice(0, 100), value: item.id }));
    await interaction.respond(choices);
  };
}

function objetOption(required = true) {
  return (o: {
    setName: (n: string) => unknown;
    setDescription: (d: string) => unknown;
    setRequired: (r: boolean) => unknown;
    setAutocomplete: (a: boolean) => unknown;
  }) => {
    o.setName('objet');
    o.setDescription(t('modules.items.opt.item'));
    o.setRequired(required);
    o.setAutocomplete(true);
    return o as never;
  };
}

function quantityOption(o: {
  setName: (n: string) => unknown;
  setDescription: (d: string) => unknown;
  setMinValue: (v: number) => unknown;
  setMaxValue: (v: number) => unknown;
}) {
  o.setName('quantité');
  o.setDescription(t('modules.items.opt.quantity'));
  o.setMinValue(1);
  o.setMaxValue(999);
  return o as never;
}

/** `/inventaire` — affiche l'inventaire d'un membre. */
export const inventaire: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('inventaire')
    .setDescription(t('modules.items.commands.inventory.description'))
    .addUserOption((o) => o.setName('membre').setDescription(t('modules.items.opt.member'))),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const lines = await getInventory(ctx, interaction.guildId, user.id);

    const embed = infoEmbed({
      title: t('modules.items.commands.inventory.title', { user: user.username }),
    }).setThumbnail(user.displayAvatarURL({ size: 128 }));

    if (lines.length === 0) {
      embed.setDescription(t('modules.items.commands.inventory.empty'));
    } else {
      embed.setDescription(
        lines
          .map(
            (line) =>
              `${line.item.emoji} **${line.item.name}** ×**${line.quantity}** · ${rarityLabel(line.item.rarity)}`,
          )
          .join('\n'),
      );
    }
    await interaction.reply({ embeds: [embed] });
  },
};

/** `/objets` — liste le catalogue d'objets du serveur. */
export const objets: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('objets')
    .setDescription(t('modules.items.commands.catalog.description')),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const items = await listItems(ctx, interaction.guildId);
    const config = await getEconomyConfig(ctx, interaction.guildId);

    if (items.length === 0) {
      await interaction.reply({
        content: t('modules.items.commands.catalog.empty'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = items.map((item) => {
      const price =
        item.buyable && item.price > 0
          ? formatMoney(config, item.price)
          : t('modules.items.commands.catalog.notForSale');
      const tags = [item.usable ? '✨' : '', item.tradable ? '🔁' : ''].filter(Boolean).join(' ');
      return `${item.emoji} **${item.name}** — ${price} · ${rarityLabel(item.rarity)}${tags ? ` · ${tags}` : ''}\n${
        item.description ? `> ${item.description.slice(0, 120)}` : ''
      }`.trim();
    });

    const embed = infoEmbed({
      title: t('modules.items.commands.catalog.title'),
      description: lines.join('\n\n').slice(0, 4000),
    }).setFooter({ text: t('modules.items.commands.catalog.footer') });
    await interaction.reply({ embeds: [embed] });
  },
};

/** `/acheter` — achète un objet avec la monnaie du serveur. */
export const acheter: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('acheter')
    .setDescription(t('modules.items.commands.buy.description'))
    .addStringOption(objetOption(true))
    .addIntegerOption(quantityOption),
  autocomplete: itemAutocomplete((item) => item.buyable),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const itemId = interaction.options.getString('objet', true);
    const qty = interaction.options.getInteger('quantité') ?? 1;
    const item = await getItem(ctx, interaction.guildId, itemId);
    const config = await getEconomyConfig(ctx, interaction.guildId);

    if (!item) {
      await interaction.reply({
        content: t('modules.items.commands.unknownItem'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!item.buyable) {
      await interaction.reply({
        content: t('modules.items.commands.buy.notForSale'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cost = item.price * qty;
    const balance = await getBalance(ctx, interaction.guildId, interaction.user.id);
    if (balance < cost) {
      await interaction.reply({
        content: t('modules.items.commands.buy.insufficient', {
          cost: formatMoney(config, cost),
          balance: formatMoney(config, balance),
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await addBalance(ctx, interaction.guildId, interaction.user.id, -cost);
    const total = await addToInventory(ctx, interaction.guildId, interaction.user.id, item.id, qty);
    await interaction.reply({
      content: t('modules.items.commands.buy.done', {
        qty,
        emoji: item.emoji,
        name: item.name,
        cost: formatMoney(config, cost),
        total,
      }),
    });
  },
};

/** `/utiliser` — consomme un objet (accorde son rôle éventuel). */
export const utiliser: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('utiliser')
    .setDescription(t('modules.items.commands.use.description'))
    .addStringOption(objetOption(true)),
  autocomplete: itemAutocomplete((item) => item.usable),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const itemId = interaction.options.getString('objet', true);
    const item = await getItem(ctx, interaction.guildId, itemId);

    if (!item) {
      await interaction.reply({
        content: t('modules.items.commands.unknownItem'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!item.usable) {
      await interaction.reply({
        content: t('modules.items.commands.use.notUsable'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const owned = await getQuantity(ctx, interaction.guildId, interaction.user.id, item.id);
    if (owned < 1) {
      await interaction.reply({
        content: t('modules.items.commands.use.dontHave', { emoji: item.emoji, name: item.name }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await takeFromInventory(ctx, interaction.guildId, interaction.user.id, item.id, 1);

    let roleNote = '';
    if (item.roleReward) {
      const added = await interaction.member.roles
        .add(item.roleReward, t('modules.items.commands.use.reason', { name: item.name }))
        .then(() => true)
        .catch(() => false);
      if (added)
        roleNote = `\n${t('modules.items.commands.use.roleGranted', { role: `<@&${item.roleReward}>` })}`;
    }

    const embed = infoEmbed({
      title: t('modules.items.commands.use.title'),
      description:
        t('modules.items.commands.use.done', {
          user: `<@${interaction.user.id}>`,
          emoji: item.emoji,
          name: item.name,
        }) + roleNote,
    }).setColor(rarityColor(item.rarity));
    await interaction.reply({ embeds: [embed] });
  },
};

/** `/donner-objet` — échange des objets avec un autre membre. */
export const donnerObjet: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('donner-objet')
    .setDescription(t('modules.items.commands.give.description'))
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.items.opt.member')).setRequired(true),
    )
    .addStringOption(objetOption(true))
    .addIntegerOption(quantityOption),
  autocomplete: itemAutocomplete((item) => item.tradable),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const config = await getItemsConfig(ctx, interaction.guildId);
    if (!config.tradingEnabled) {
      await interaction.reply({
        content: t('modules.items.commands.give.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = interaction.options.getUser('membre', true);
    const itemId = interaction.options.getString('objet', true);
    const qty = interaction.options.getInteger('quantité') ?? 1;

    if (target.bot || target.id === interaction.user.id) {
      await interaction.reply({
        content: t('modules.items.commands.give.invalidTarget'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getItem(ctx, interaction.guildId, itemId);
    if (!item) {
      await interaction.reply({
        content: t('modules.items.commands.unknownItem'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!item.tradable) {
      await interaction.reply({
        content: t('modules.items.commands.give.notTradable'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const taken = await takeFromInventory(
      ctx,
      interaction.guildId,
      interaction.user.id,
      item.id,
      qty,
    );
    if (!taken) {
      await interaction.reply({
        content: t('modules.items.commands.give.insufficient', {
          emoji: item.emoji,
          name: item.name,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await addToInventory(ctx, interaction.guildId, target.id, item.id, qty);

    await interaction.reply({
      content: t('modules.items.commands.give.done', {
        from: `<@${interaction.user.id}>`,
        to: `<@${target.id}>`,
        qty,
        emoji: item.emoji,
        name: item.name,
      }),
      allowedMentions: { users: [target.id] },
    });
  },
};

/** `/objets-admin` — attribue ou retire des objets (staff). */
export const objetsAdmin: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('objets-admin')
    .setDescription(t('modules.items.commands.admin.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('donner')
        .setDescription(t('modules.items.commands.admin.give'))
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.items.opt.member')).setRequired(true),
        )
        .addStringOption(objetOption(true))
        .addIntegerOption(quantityOption),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription(t('modules.items.commands.admin.take'))
        .addUserOption((o) =>
          o.setName('membre').setDescription(t('modules.items.opt.member')).setRequired(true),
        )
        .addStringOption(objetOption(true))
        .addIntegerOption(quantityOption),
    ),
  autocomplete: itemAutocomplete(),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre', true);
    const itemId = interaction.options.getString('objet', true);
    const qty = interaction.options.getInteger('quantité') ?? 1;
    const item = await getItem(ctx, interaction.guildId, itemId);

    if (!item) {
      await interaction.reply({
        content: t('modules.items.commands.unknownItem'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'donner') {
      const total = await addToInventory(ctx, interaction.guildId, target.id, item.id, qty);
      await interaction.reply({
        content: t('modules.items.commands.admin.gave', {
          qty,
          emoji: item.emoji,
          name: item.name,
          user: `<@${target.id}>`,
          total,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const owned = await getQuantity(ctx, interaction.guildId, target.id, item.id);
    const removed = Math.min(qty, owned);
    if (removed > 0) await addToInventory(ctx, interaction.guildId, target.id, item.id, -removed);
    await interaction.reply({
      content: t('modules.items.commands.admin.took', {
        qty: removed,
        emoji: item.emoji,
        name: item.name,
        user: `<@${target.id}>`,
      }),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const itemsCommands: SlashCommand[] = [
  inventaire,
  objets,
  acheter,
  utiliser,
  donnerObjet,
  objetsAdmin,
];
