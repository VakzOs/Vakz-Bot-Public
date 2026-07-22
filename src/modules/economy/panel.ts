import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
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
import { resolveEmojiInput } from '../../lib/emoji.js';
import {
  type EconomyConfig,
  MODULE_NAME,
  getEconomyConfig,
  updateEconomyConfig,
} from './config.js';

const MAX_SHOPS = 10;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function input(
  id: string,
  label: string,
  style: TextInputStyle,
  value: string,
  required = true,
): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setRequired(required)
      .setMaxLength(100)
      .setValue(value),
  );
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getEconomyConfig(ctx, guildId);

  const shopsText = config.shops.length
    ? config.shops
        .map((shop) => `• **${shop.name}** — ${d('itemCount', { count: shop.items.length })}`)
        .join('\n')
    : t('modules.economy.panel.shopEmpty');

  const embed = infoEmbed({
    title: t('modules.economy.label'),
    description: t('modules.economy.panel.intro'),
  }).addFields(
    {
      name: t('modules.economy.panel.currencyField'),
      value: `${config.currencyName} (${config.currencySymbol})`,
      inline: true,
    },
    {
      name: t('modules.economy.panel.earnField'),
      value: t('modules.economy.panel.earnValue', {
        min: config.messageMin,
        max: config.messageMax,
        cd: config.messageCooldown,
      }),
      inline: true,
    },
    {
      name: t('modules.economy.panel.dailyField'),
      value: `${config.dailyAmount} ${config.currencySymbol}`,
      inline: true,
    },
    { name: t('modules.economy.panel.shopsField'), value: shopsText },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'currency'))
        .setLabel(t('modules.economy.panel.editCurrency'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'earn'))
        .setLabel(t('modules.economy.panel.editEarn'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'daily'))
        .setLabel(t('modules.economy.panel.editDaily'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'adv2'))
        .setLabel(t('modules.economy.panel.advanced'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'shopcreate'))
        .setLabel(d('createShop'))
        .setStyle(ButtonStyle.Success),
    ),
  ];

  if (config.shops.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'shoppick'))
          .setPlaceholder(d('shopPickPlaceholder'))
          .addOptions(
            config.shops.slice(0, 25).map((shop) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(shop.name.slice(0, 100))
                .setValue(shop.id)
                .setDescription(d('itemCount', { count: shop.items.length })),
            ),
          ),
      ),
    );
  }

  return { embed, components };
}

function d(key: string, vars?: Record<string, string | number>): string {
  return t(`modules.economy.panel.${key}`, vars);
}

function stockText(stock: number): string {
  if (stock < 0) return d('stockUnlimited');
  return stock === 0 ? d('stockSoldOut') : d('stockN', { n: stock });
}

/** Sous-vue d'édition d'une boutique : bannière, nom et articles. */
function renderShopEdit(
  ctx: BotContext,
  guildId: string,
  shop: EconomyConfig['shops'][number],
): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const guild = ctx.client.guilds.cache.get(guildId);
  const itemsText = shop.items.length
    ? shop.items
        .map((item) => `• <@&${item.roleId}> — **${item.price}** · ${stockText(item.stock)}`)
        .join('\n')
    : d('noItems');

  const embed = infoEmbed({
    title: d('shopEditTitle', { name: shop.name }),
    description: d('shopEditIntro'),
  }).addFields(
    {
      name: d('bannerField'),
      value: shop.bannerUrl ? `[${d('bannerSet')}](${shop.bannerUrl})` : d('bannerNone'),
    },
    { name: d('itemsField'), value: itemsText },
  );
  if (shop.bannerUrl) embed.setThumbnail(shop.bannerUrl);

  const components: PanelRow[] = [
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'itemadd', shop.id))
        .setPlaceholder(d('itemAdd'))
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (shop.items.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'itemremove', shop.id))
          .setPlaceholder(d('itemRemove'))
          .addOptions(
            shop.items
              .slice(0, 25)
              .map((item) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(
                    `${guild?.roles.cache.get(item.roleId)?.name ?? item.roleId} • ${item.price}`.slice(
                      0,
                      100,
                    ),
                  )
                  .setValue(item.roleId),
              ),
          ),
      ),
    );
  }

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'shopmeta', shop.id))
        .setLabel(d('shopMeta'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'shopdelete', shop.id))
        .setLabel(d('shopDelete'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'home'))
        .setLabel(d('back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

/** Recompose la sous-vue d'une boutique (ou la page principale si supprimée). */
async function showShopView(
  interaction: PanelHandlerArgs['interaction'],
  ctx: BotContext,
  guildId: string,
  shopId: string,
  renderPage: PanelHandlerArgs['renderPage'],
): Promise<void> {
  const config = await getEconomyConfig(ctx, guildId);
  const shop = config.shops.find((s) => s.id === shopId);
  const view = shop ? renderShopEdit(ctx, guildId, shop) : await renderPage();
  if (interaction.isMessageComponent()) {
    await interaction.update(view);
  } else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(view);
  }
}

function renderAdvanced(ctx: BotContext, guildId: string, config: EconomyConfig) {
  const guild = ctx.client.guilds.cache.get(guildId);
  const inCache = (ids: string[], kind: 'channel' | 'role') =>
    ids.filter((id) =>
      kind === 'channel' ? guild?.channels.cache.has(id) : guild?.roles.cache.has(id),
    );
  const ignoredChannels = inCache(config.ignoredChannelIds, 'channel');
  const ignoredRoles = inCache(config.ignoredRoleIds, 'role');

  const embed = infoEmbed({ title: d('advTitle'), description: d('advIntro') }).addFields(
    {
      name: d('voiceField'),
      value: config.voiceEnabled
        ? d('voiceOn', { amount: config.voicePerMinute, symbol: config.currencySymbol })
        : d('voiceOff'),
      inline: true,
    },
    {
      name: d('leaderboardField'),
      value: config.leaderboardChannelId ? `<#${config.leaderboardChannelId}>` : d('off'),
      inline: true,
    },
    {
      name: d('ignoredField'),
      value: `${d('ignoredChannels', { count: ignoredChannels.length })} · ${d('ignoredRoles', { count: ignoredRoles.length })}`,
    },
  );

  const ignoredChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'ignch'))
    .setPlaceholder(d('ignoredChannelsPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
    .setMinValues(0)
    .setMaxValues(25);
  if (ignoredChannels.length) ignoredChannelSelect.setDefaultChannels(ignoredChannels);

  const ignoredRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'ignrole'))
    .setPlaceholder(d('ignoredRolesPlaceholder'))
    .setMinValues(0)
    .setMaxValues(25);
  if (ignoredRoles.length) ignoredRoleSelect.setDefaultRoles(ignoredRoles);

  const lbSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'lbchan'))
    .setPlaceholder(d('leaderboardPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (config.leaderboardChannelId && guild?.channels.cache.has(config.leaderboardChannelId)) {
    lbSelect.setDefaultChannels([config.leaderboardChannelId]);
  }

  const components: PanelRow[] = [
    row().addComponents(ignoredChannelSelect),
    row().addComponents(ignoredRoleSelect),
    row().addComponents(lbSelect),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'voice'))
        .setLabel(config.voiceEnabled ? d('voiceDisable') : d('voiceEnable'))
        .setStyle(config.voiceEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'voiceamount'))
        .setLabel(d('voiceAmount'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'back'))
        .setLabel(d('back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], components };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'currency': {
      if (!interaction.isButton()) return;
      const config = await getEconomyConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'currencymodal'))
          .setTitle(t('modules.economy.panel.currencyModal'))
          .addComponents(
            input(
              'name',
              t('modules.economy.panel.nameField'),
              TextInputStyle.Short,
              config.currencyName,
            ),
            input(
              'symbol',
              t('modules.economy.panel.symbolField'),
              TextInputStyle.Short,
              config.currencySymbol,
            ),
          ),
      );
      return;
    }
    case 'currencymodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const rawSymbol = interaction.fields.getTextInputValue('symbol').slice(0, 32);
      const symbol = interaction.guild
        ? resolveEmojiInput(rawSymbol, interaction.guild)
        : rawSymbol.trim();
      await updateEconomyConfig(ctx, guildId, {
        currencyName: interaction.fields.getTextInputValue('name').slice(0, 30) || 'pièces',
        currencySymbol: (symbol || '🪙').slice(0, 64),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'earn': {
      if (!interaction.isButton()) return;
      const config = await getEconomyConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'earnmodal'))
          .setTitle(t('modules.economy.panel.earnModal'))
          .addComponents(
            input(
              'min',
              t('modules.economy.panel.minField'),
              TextInputStyle.Short,
              String(config.messageMin),
            ),
            input(
              'max',
              t('modules.economy.panel.maxField'),
              TextInputStyle.Short,
              String(config.messageMax),
            ),
            input(
              'cd',
              t('modules.economy.panel.cdField'),
              TextInputStyle.Short,
              String(config.messageCooldown),
            ),
          ),
      );
      return;
    }
    case 'earnmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getEconomyConfig(ctx, guildId);
      const min = clampInt(
        interaction.fields.getTextInputValue('min'),
        config.messageMin,
        0,
        10_000,
      );
      const max = Math.max(
        min,
        clampInt(interaction.fields.getTextInputValue('max'), config.messageMax, 0, 10_000),
      );
      const cd = clampInt(
        interaction.fields.getTextInputValue('cd'),
        config.messageCooldown,
        0,
        3600,
      );
      await updateEconomyConfig(ctx, guildId, {
        messageMin: min,
        messageMax: max,
        messageCooldown: cd,
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'daily': {
      if (!interaction.isButton()) return;
      const config = await getEconomyConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'dailymodal'))
          .setTitle(t('modules.economy.panel.dailyModal'))
          .addComponents(
            input(
              'amount',
              t('modules.economy.panel.dailyAmountField'),
              TextInputStyle.Short,
              String(config.dailyAmount),
            ),
          ),
      );
      return;
    }
    case 'dailymodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getEconomyConfig(ctx, guildId);
      await updateEconomyConfig(ctx, guildId, {
        dailyAmount: clampInt(
          interaction.fields.getTextInputValue('amount'),
          config.dailyAmount,
          0,
          1_000_000,
        ),
      });
      await interaction.update(await renderPage());
      return;
    }
    // --- Boutiques multiples ---
    case 'shopcreate': {
      if (!interaction.isButton()) return;
      const config = await getEconomyConfig(ctx, guildId);
      if (config.shops.length >= MAX_SHOPS) {
        await interaction.reply({
          content: d('shopFull', { max: MAX_SHOPS }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'shopcreatemodal'))
          .setTitle(d('createShop'))
          .addComponents(input('name', d('shopNameField'), TextInputStyle.Short, '')),
      );
      return;
    }
    case 'shopcreatemodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getEconomyConfig(ctx, guildId);
      const name =
        interaction.fields.getTextInputValue('name').trim().slice(0, 100) || d('shopDefault');
      const shop = { id: randomUUID().slice(0, 8), name, bannerUrl: null, items: [] };
      await updateEconomyConfig(ctx, guildId, { shops: [...config.shops, shop] });
      await interaction.update(renderShopEdit(ctx, guildId, shop));
      return;
    }
    case 'shoppick': {
      if (!interaction.isStringSelectMenu()) return;
      await showShopView(interaction, ctx, guildId, interaction.values[0] ?? '', renderPage);
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'shopmeta': {
      if (!interaction.isButton()) return;
      const shop = (await getEconomyConfig(ctx, guildId)).shops.find((s) => s.id === params[0]);
      if (!shop) return;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'shopmetamodal', shop.id))
          .setTitle(d('shopMeta'))
          .addComponents(
            input('name', d('shopNameField'), TextInputStyle.Short, shop.name),
            input(
              'banner',
              d('bannerFieldModal'),
              TextInputStyle.Short,
              shop.bannerUrl ?? '',
              false,
            ),
          ),
      );
      return;
    }
    case 'shopmetamodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getEconomyConfig(ctx, guildId);
      const rawBanner = interaction.fields.getTextInputValue('banner').trim();
      const bannerUrl = /^https?:\/\//.test(rawBanner) ? rawBanner.slice(0, 512) : null;
      const shops = config.shops.map((s) =>
        s.id === params[0]
          ? {
              ...s,
              name: interaction.fields.getTextInputValue('name').trim().slice(0, 100) || s.name,
              bannerUrl,
            }
          : s,
      );
      await updateEconomyConfig(ctx, guildId, { shops });
      await showShopView(interaction, ctx, guildId, params[0] ?? '', renderPage);
      return;
    }
    case 'itemadd': {
      if (!interaction.isRoleSelectMenu()) return;
      const roleId = interaction.values[0];
      if (!roleId) return;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'itemaddmodal', params[0] ?? '', roleId))
          .setTitle(t('modules.economy.panel.priceModal'))
          .addComponents(
            input('price', t('modules.economy.panel.priceField'), TextInputStyle.Short, '100'),
            input('stock', d('stockField'), TextInputStyle.Short, '-1', false),
          ),
      );
      return;
    }
    case 'itemaddmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const [shopId, roleId] = params;
      if (!shopId || !roleId) return;
      const config = await getEconomyConfig(ctx, guildId);
      const price = clampInt(interaction.fields.getTextInputValue('price'), 100, 0, 100_000_000);
      const stock = clampInt(interaction.fields.getTextInputValue('stock'), -1, -1, 1_000_000);
      const shops = config.shops.map((s) =>
        s.id === shopId
          ? {
              ...s,
              items: [...s.items.filter((i) => i.roleId !== roleId), { roleId, price, stock }],
            }
          : s,
      );
      await updateEconomyConfig(ctx, guildId, { shops });
      await showShopView(interaction, ctx, guildId, shopId, renderPage);
      return;
    }
    case 'itemremove': {
      if (!interaction.isStringSelectMenu()) return;
      const roleId = interaction.values[0];
      const config = await getEconomyConfig(ctx, guildId);
      const shops = config.shops.map((s) =>
        s.id === params[0] ? { ...s, items: s.items.filter((i) => i.roleId !== roleId) } : s,
      );
      await updateEconomyConfig(ctx, guildId, { shops });
      await showShopView(interaction, ctx, guildId, params[0] ?? '', renderPage);
      return;
    }
    case 'shopdelete': {
      if (!interaction.isButton()) return;
      const config = await getEconomyConfig(ctx, guildId);
      await updateEconomyConfig(ctx, guildId, {
        shops: config.shops.filter((s) => s.id !== params[0]),
      });
      await interaction.update(await renderPage());
      return;
    }

    // --- Réglages avancés ---
    case 'adv2': {
      if (!interaction.isButton()) return;
      await interaction.update(renderAdvanced(ctx, guildId, await getEconomyConfig(ctx, guildId)));
      return;
    }
    case 'back': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'ignch': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await updateEconomyConfig(ctx, guildId, {
        ignoredChannelIds: [...interaction.values],
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'ignrole': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await updateEconomyConfig(ctx, guildId, {
        ignoredRoleIds: [...interaction.values],
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'lbchan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await updateEconomyConfig(ctx, guildId, {
        leaderboardChannelId: interaction.values[0] ?? null,
        leaderboardMessageId: null,
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'voice': {
      if (!interaction.isButton()) return;
      const current = await getEconomyConfig(ctx, guildId);
      const config = await updateEconomyConfig(ctx, guildId, {
        voiceEnabled: !current.voiceEnabled,
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'voiceamount': {
      if (!interaction.isButton()) return;
      const config = await getEconomyConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'voiceamountmodal'))
          .setTitle(t('modules.economy.panel.voiceAmount'))
          .addComponents(
            input(
              'amount',
              t('modules.economy.panel.voiceAmountField'),
              TextInputStyle.Short,
              String(config.voicePerMinute),
            ),
          ),
      );
      return;
    }
    case 'voiceamountmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const current = await getEconomyConfig(ctx, guildId);
      const config = await updateEconomyConfig(ctx, guildId, {
        voicePerMinute: clampInt(
          interaction.fields.getTextInputValue('amount'),
          current.voicePerMinute,
          0,
          10_000,
        ),
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Économie ». */
export const economyPanel: ConfigPanel = { render, handle };
