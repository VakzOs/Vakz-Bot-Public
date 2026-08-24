import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Emojis, infoEmbed } from '../../lib/embeds.js';
import { formatMoney, getEconomyConfig } from '../economy/config.js';
import { addBalance, getBalance } from '../economy/service.js';
import { isOwner } from '../deploy/service.js';
import { getItemsConfig } from './config.js';
import { getItemLimit, setItemLimit } from './limit.js';
import { parseEffects, requiresTarget } from './effects-schema.js';
import { applyItemEffects } from './effects.js';
import {
  type Item,
  addToInventory,
  getInventory,
  getItem,
  getItemUsedAt,
  getQuantity,
  listItems,
  markItemUsed,
  rarityColor,
  rarityLabel,
  takeFromInventory,
} from './service.js';

/** Libellé lisible d'une limite (nombre ou « illimité »). */
function limitLabel(limit: number | null): string {
  return limit === null ? t('modules.items.limit.unlimited') : String(limit);
}

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
      emoji: Emojis.backpack,
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

/** Nombre d'objets affichés par page du catalogue (embed lisible). */
const CATALOG_PAGE_SIZE = 10;

/** `/objets` — liste le catalogue d'objets du serveur (paginé). */
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

    const pageCount = Math.ceil(items.length / CATALOG_PAGE_SIZE);

    const renderPage = (page: number): EmbedBuilder => {
      const slice = items.slice(
        page * CATALOG_PAGE_SIZE,
        page * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE,
      );
      const lines = slice.map((item) => {
        const price =
          item.buyable && item.price > 0
            ? formatMoney(config, item.price)
            : t('modules.items.commands.catalog.notForSale');
        const tags = [item.usable ? '✨' : '', item.tradable ? '🔁' : ''].filter(Boolean).join(' ');
        return `${item.emoji} **${item.name}** — ${price} · ${rarityLabel(item.rarity)}${tags ? ` · ${tags}` : ''}\n${
          item.description ? `> ${item.description.slice(0, 120)}` : ''
        }`.trim();
      });
      const footer =
        pageCount > 1
          ? t('modules.items.commands.catalog.footerPaged', {
              base: t('modules.items.commands.catalog.footer'),
              page: page + 1,
              pages: pageCount,
            })
          : t('modules.items.commands.catalog.footer');
      return infoEmbed({
        title: t('modules.items.commands.catalog.title'),
        description: lines.join('\n\n').slice(0, 4000),
        emoji: Emojis.gem,
      }).setFooter({ text: footer });
    };

    const navRow = (page: number, disabled = false): ActionRowBuilder<ButtonBuilder> =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('objets:prev')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page === 0),
        new ButtonBuilder()
          .setCustomId('objets:next')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= pageCount - 1),
      );

    // Catalogue éphémère (« my eyes only ») : visible du seul auteur.
    // Une seule page : pas de boutons.
    if (pageCount === 1) {
      await interaction.reply({ embeds: [renderPage(0)], flags: MessageFlags.Ephemeral });
      return;
    }

    let page = 0;
    await interaction.reply({
      embeds: [renderPage(page)],
      components: [navRow(page)],
      flags: MessageFlags.Ephemeral,
    });
    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: 120_000,
    });
    collector.on('collect', async (button) => {
      page =
        button.customId === 'objets:next'
          ? Math.min(pageCount - 1, page + 1)
          : Math.max(0, page - 1);
      await button.update({ embeds: [renderPage(page)], components: [navRow(page)] });
    });
    collector.on('end', async () => {
      // Message éphémère : désactive les boutons via le webhook d'interaction.
      await interaction.editReply({ components: [navRow(page, true)] }).catch(() => undefined);
    });
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

/** `/utiliser` — utilise un objet et applique ses effets configurés. */
export const utiliser: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('utiliser')
    .setDescription(t('modules.items.commands.use.description'))
    .addStringOption(objetOption(true))
    .addUserOption((o) =>
      o.setName('cible').setDescription(t('modules.items.commands.use.optTarget')),
    ),
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

    const effects = parseEffects(item);

    // Cible requise pour certains effets (ex. dégâts sur la Route).
    const targetUser = interaction.options.getUser('cible');
    if (requiresTarget(effects) && !targetUser) {
      await interaction.reply({
        content: t('modules.items.commands.use.targetRequired'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Cooldown des objets réutilisables (non consommables).
    if (!item.consumable && item.cooldownSeconds > 0) {
      const usedAt = await getItemUsedAt(ctx, interaction.guildId, interaction.user.id, item.id);
      const readyAt = usedAt ? usedAt.getTime() + item.cooldownSeconds * 1000 : 0;
      if (readyAt > Date.now()) {
        await interaction.reply({
          content: t('modules.items.commands.use.cooldown', {
            time: `<t:${Math.floor(readyAt / 1000)}:R>`,
          }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const targetMember = targetUser
      ? await interaction.guild.members.fetch(targetUser.id).catch(() => null)
      : null;

    const lines = await applyItemEffects({
      ctx,
      guild: interaction.guild,
      member: interaction.member,
      target: targetMember,
      item,
      effects,
    });

    // Consommation OU cooldown (selon la config de l'objet).
    if (item.consumable) {
      await takeFromInventory(ctx, interaction.guildId, interaction.user.id, item.id, 1);
    } else {
      await markItemUsed(ctx, interaction.guildId, interaction.user.id, item.id);
    }

    const body =
      t('modules.items.commands.use.done', {
        user: `<@${interaction.user.id}>`,
        emoji: item.emoji,
        name: item.name,
      }) + (lines.length > 0 ? `\n\n${lines.join('\n')}` : '');

    const embed = infoEmbed({
      title: t('modules.items.commands.use.title'),
      description: body,
      emoji: Emojis.sparkles,
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

/** `/objets-limite` — règle le plafond global d'objets (propriétaire du bot). */
export const objetsLimite: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('objets-limite')
    .setDescription(t('modules.items.limit.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('voir').setDescription(t('modules.items.limit.view')))
    .addSubcommand((s) =>
      s
        .setName('definir')
        .setDescription(t('modules.items.limit.set'))
        .addIntegerOption((o) =>
          o
            .setName('nombre')
            .setDescription(t('modules.items.limit.opt.number'))
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(1_000_000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('augmenter')
        .setDescription(t('modules.items.limit.increase'))
        .addIntegerOption((o) =>
          o
            .setName('de')
            .setDescription(t('modules.items.limit.opt.amount'))
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1_000_000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('reduire')
        .setDescription(t('modules.items.limit.reduce'))
        .addIntegerOption((o) =>
          o
            .setName('de')
            .setDescription(t('modules.items.limit.opt.amount'))
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1_000_000),
        ),
    ),
  async execute(interaction, ctx) {
    // Réservé au propriétaire du bot (même droit que /maj).
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: t('modules.items.limit.notOwner'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const current = await getItemLimit(ctx);

    if (sub === 'voir') {
      await interaction.reply({
        content: t('modules.items.limit.current', { value: limitLabel(current) }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let target: number | null;
    if (sub === 'definir') {
      const n = interaction.options.getInteger('nombre', true);
      target = n <= 0 ? null : n; // 0 = illimité
    } else {
      // augmenter / reduire : nécessite une limite finie existante.
      if (current === null) {
        await interaction.reply({
          content: t('modules.items.limit.currentlyUnlimited'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const amount = interaction.options.getInteger('de', true);
      const next = sub === 'augmenter' ? current + amount : current - amount;
      target = Math.max(1, next); // ne descend jamais sous 1 (utiliser « definir 0 » pour illimité)
    }

    const saved = await setItemLimit(ctx, target);
    await interaction.reply({
      content: t('modules.items.limit.updated', { value: limitLabel(saved) }),
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
  objetsLimite,
];
