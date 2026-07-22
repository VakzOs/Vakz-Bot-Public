import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { parseEmoji, resolveEmojiInput } from '../../lib/emoji.js';
import {
  MAX_ITEMS,
  MODULE_NAME,
  RARITIES,
  type Rarity,
  getItemsConfig,
  updateItemsConfig,
} from './config.js';
import {
  type Item,
  countItems,
  createItem,
  deleteItem,
  getItem,
  listItems,
  rarityColor,
  rarityLabel,
  updateItem,
} from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function onOff(value: boolean): string {
  return value ? t('modules.items.panel.on') : t('modules.items.panel.off');
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value.replace(/[^\d-]/g, ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getItemsConfig(ctx, guildId);
  const items = await listItems(ctx, guildId);

  const list = items.length
    ? items
        .slice(0, 25)
        .map(
          (item) =>
            `${item.emoji} **${item.name}** — ${item.price > 0 ? `${item.price} 🪙` : t('modules.items.panel.free')} · ${rarityLabel(item.rarity)}`,
        )
        .join('\n')
    : t('modules.items.panel.noItems');

  const embed = infoEmbed({
    title: t('modules.items.label'),
    description: t('modules.items.panel.intro'),
  }).addFields(
    {
      name: t('modules.items.panel.itemsField', { count: items.length, max: MAX_ITEMS }),
      value: list,
    },
    {
      name: t('modules.items.panel.tradingField'),
      value: onOff(config.tradingEnabled),
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add'))
        .setLabel(t('modules.items.panel.addItem'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(items.length >= MAX_ITEMS),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'trading'))
        .setLabel(
          config.tradingEnabled
            ? t('modules.items.panel.disableTrading')
            : t('modules.items.panel.enableTrading'),
        )
        .setStyle(config.tradingEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    ),
  ];

  if (items.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
          .setPlaceholder(t('modules.items.panel.pickPlaceholder'))
          .addOptions(
            items.slice(0, 25).map((item) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(item.name.slice(0, 100))
                .setValue(item.id)
                .setDescription(rarityLabel(item.rarity).slice(0, 100))
                .setEmoji(parseEmoji(item.emoji) ?? '📦'),
            ),
          ),
      ),
    );
  }

  return { embed, components };
}

/** Emoji sûr pour une option de select (unicode/custom, sinon rien). */
function safeEmoji(value: string): string {
  if (/^<a?:\w+:\d+>$/.test(value)) return value;
  if (/\p{Extended_Pictographic}/u.test(value)) return value;
  return '📦';
}

// --- Vue d'édition d'un objet ----------------------------------------------

function renderItemEdit(item: Item): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: `${item.emoji} ${item.name}`,
    description: item.description || t('modules.items.panel.noDescription'),
  })
    .setColor(rarityColor(item.rarity))
    .addFields(
      {
        name: t('modules.items.panel.priceField'),
        value: item.price > 0 ? `${item.price} 🪙` : t('modules.items.panel.free'),
        inline: true,
      },
      { name: t('modules.items.panel.rarityField'), value: rarityLabel(item.rarity), inline: true },
      {
        name: t('modules.items.panel.flagsField'),
        value: [
          `${t('modules.items.panel.buyable')} : ${onOff(item.buyable)}`,
          `${t('modules.items.panel.tradable')} : ${onOff(item.tradable)}`,
          `${t('modules.items.panel.usable')} : ${onOff(item.usable)}`,
        ].join('\n'),
      },
      {
        name: t('modules.items.panel.roleField'),
        value: item.roleReward ? `<@&${item.roleReward}>` : t('modules.items.panel.roleNone'),
        inline: true,
      },
    );

  const rarityMenu = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'rarity', item.id))
    .setPlaceholder(t('modules.items.panel.rarityPlaceholder'))
    .addOptions(
      RARITIES.map((r: Rarity) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(t(`modules.items.rarity.${r}`))
          .setValue(r)
          .setDefault(r === item.rarity),
      ),
    );

  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'role', item.id))
    .setPlaceholder(t('modules.items.panel.rolePlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  if (item.roleReward) roleMenu.setDefaultRoles([item.roleReward]);

  return {
    embeds: [embed],
    components: [
      row().addComponents(rarityMenu),
      row().addComponents(roleMenu),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'buyable', item.id))
          .setLabel(t('modules.items.panel.buyable'))
          .setStyle(item.buyable ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'tradable', item.id))
          .setLabel(t('modules.items.panel.tradable'))
          .setStyle(item.tradable ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'usable', item.id))
          .setLabel(t('modules.items.panel.usable'))
          .setStyle(item.usable ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'edit', item.id))
          .setLabel(t('modules.items.panel.editFields'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'delete', item.id))
          .setLabel(t('modules.items.panel.deleteItem'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.items.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// --- Modals -----------------------------------------------------------------

function textField(
  id: string,
  label: string,
  style: TextInputStyle,
  value: string,
  required: boolean,
  maxLength: number,
  placeholder?: string,
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);
  if (value) input.setValue(value);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function itemModal(item: Item | null): ModalBuilder {
  const create = item === null;
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, create ? 'addmodal' : 'editmodal', item?.id ?? ''))
    .setTitle(create ? t('modules.items.panel.addTitle') : t('modules.items.panel.editTitle'))
    .addComponents(
      textField(
        'name',
        t('modules.items.panel.nameField'),
        TextInputStyle.Short,
        item?.name ?? '',
        true,
        60,
      ),
      textField(
        'emoji',
        t('modules.items.panel.emojiField'),
        TextInputStyle.Short,
        item?.emoji ?? '',
        false,
        64,
        '📦 ou :nom:',
      ),
      textField(
        'description',
        t('modules.items.panel.descriptionField'),
        TextInputStyle.Paragraph,
        item?.description ?? '',
        false,
        300,
      ),
      textField(
        'price',
        t('modules.items.panel.priceField'),
        TextInputStyle.Short,
        item ? String(item.price) : '',
        false,
        9,
        '0',
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  const itemId = params[0] ?? '';

  const backToItem = async (): Promise<void> => {
    const item = await getItem(ctx, guildId, itemId);
    const view = item ? renderItemEdit(item) : await renderPage();
    if (interaction.isModalSubmit()) {
      if (interaction.isFromMessage()) await interaction.update(view);
      return;
    }
    if (interaction.isMessageComponent()) await interaction.update(view);
  };

  switch (action) {
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'trading': {
      if (!interaction.isButton()) return;
      const config = await getItemsConfig(ctx, guildId);
      await updateItemsConfig(ctx, guildId, { tradingEnabled: !config.tradingEnabled });
      await interaction.update(await renderPage());
      return;
    }
    case 'add': {
      if (!interaction.isButton()) return;
      if ((await countItems(ctx, guildId)) >= MAX_ITEMS) {
        await interaction.reply({
          content: t('modules.items.panel.tooMany', { max: MAX_ITEMS }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(itemModal(null));
      return;
    }
    case 'addmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const name = interaction.fields.getTextInputValue('name').trim().slice(0, 60);
      if (!name) {
        await interaction.reply({
          content: t('modules.items.panel.nameRequired'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const guild = ctx.client.guilds.cache.get(guildId);
      const emojiRaw = interaction.fields.getTextInputValue('emoji').trim();
      const emoji = emojiRaw && guild ? safeEmoji(resolveEmojiInput(emojiRaw, guild)) : '📦';
      await createItem(ctx, guildId, {
        name,
        emoji,
        description: interaction.fields.getTextInputValue('description').trim().slice(0, 300),
        price: clampInt(interaction.fields.getTextInputValue('price'), 0, 0, 100_000_000),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'pick': {
      if (!interaction.isStringSelectMenu()) return;
      const item = await getItem(ctx, guildId, interaction.values[0] ?? '');
      await interaction.update(item ? renderItemEdit(item) : await renderPage());
      return;
    }
    case 'edit': {
      if (!interaction.isButton()) return;
      const item = await getItem(ctx, guildId, itemId);
      if (!item) {
        await interaction.update(await renderPage());
        return;
      }
      await interaction.showModal(itemModal(item));
      return;
    }
    case 'editmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const name = interaction.fields.getTextInputValue('name').trim().slice(0, 60);
      const guild = ctx.client.guilds.cache.get(guildId);
      const emojiRaw = interaction.fields.getTextInputValue('emoji').trim();
      const emoji = emojiRaw && guild ? safeEmoji(resolveEmojiInput(emojiRaw, guild)) : '📦';
      await updateItem(ctx, itemId, {
        name: name || undefined,
        emoji,
        description: interaction.fields.getTextInputValue('description').trim().slice(0, 300),
        price: clampInt(interaction.fields.getTextInputValue('price'), 0, 0, 100_000_000),
      });
      await backToItem();
      return;
    }
    case 'rarity': {
      if (!interaction.isStringSelectMenu()) return;
      const rarity = interaction.values[0];
      if (rarity) await updateItem(ctx, itemId, { rarity });
      await backToItem();
      return;
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateItem(ctx, itemId, { roleReward: interaction.values[0] ?? null });
      await backToItem();
      return;
    }
    case 'buyable':
    case 'tradable':
    case 'usable': {
      if (!interaction.isButton()) return;
      const item = await getItem(ctx, guildId, itemId);
      if (item) await updateItem(ctx, itemId, { [action]: !item[action] });
      await backToItem();
      return;
    }
    case 'delete': {
      if (!interaction.isButton()) return;
      await deleteItem(ctx, itemId);
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Objets & inventaires ». */
export const itemsPanel: ConfigPanel = { render, handle };
