import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { RARITIES } from '../items/config.js';
import { rarityLabel } from '../items/service.js';
import { MODULE_NAME, type RouteConfig, getRouteConfig, updateRouteConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function onOff(value: boolean): string {
  return value ? t('modules.route.panel.on') : t('modules.route.panel.off');
}

function clampPct(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isNaN(parsed) ? fallback : Math.min(100, Math.max(0, parsed));
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value.replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(min, parsed));
}

const PRICE_KEYS = ['potion', 'tonic', 'ration'] as const;

function pricesValue(prices: RouteConfig['shopPrices']): string {
  return PRICE_KEYS.map(
    (key) => `${t(`modules.route.goods.${key}.name`)} — 🪙 **${prices[key]}**`,
  ).join('\n');
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getRouteConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.route.label'),
    description: t('modules.route.panel.intro'),
  }).addFields(
    {
      name: t('modules.route.panel.cooldownField'),
      value: t('modules.route.panel.cooldownValue', { minutes: config.cooldownMinutes }),
      inline: true,
    },
    { name: t('modules.route.panel.coinsField'), value: onOff(config.giveCoins), inline: true },
    { name: t('modules.route.panel.itemsField'), value: onOff(config.giveItems), inline: true },
    {
      name: t('modules.route.panel.regenField'),
      value: t('modules.route.panel.regenValue', {
        rate: config.energyRegenRate,
        cap: config.energyRegenCap,
      }),
      inline: true,
    },
    {
      name: t('modules.route.panel.shopPricesField'),
      value: pricesValue(config.shopPrices),
      inline: true,
    },
    {
      name: t('modules.route.panel.peddlerPricesField'),
      value: pricesValue(config.peddlerPrices),
      inline: true,
    },
    {
      name: t('modules.route.panel.dropsField'),
      value: config.giveItems
        ? RARITIES.map((r) => `${rarityLabel(r)} — **${config.drops[r]}%**`).join('\n')
        : t('modules.route.panel.dropsDisabled'),
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'cooldown'))
        .setLabel(t('modules.route.panel.editCooldown'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'coins'))
        .setLabel(t('modules.route.panel.coinsField'))
        .setStyle(config.giveCoins ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'items'))
        .setLabel(t('modules.route.panel.itemsField'))
        .setStyle(config.giveItems ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'drops'))
        .setLabel(t('modules.route.panel.editDrops'))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!config.giveItems),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'regen'))
        .setLabel(t('modules.route.panel.editRegen'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'shopprices'))
        .setLabel(t('modules.route.panel.editShopPrices'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'peddlerprices'))
        .setLabel(t('modules.route.panel.editPeddlerPrices'))
        .setStyle(ButtonStyle.Primary),
    ),
  ];
  return { embed, components };
}

function dropsModal(drops: Record<'common' | 'rare' | 'epic' | 'legendary', number>): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'dropsmodal'))
    .setTitle(t('modules.route.panel.dropsTitle'));
  for (const r of RARITIES) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(r)
          .setLabel(`${t(`modules.items.rarity.${r}`)} (%)`)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(3)
          .setRequired(true)
          .setValue(String(drops[r]))
          .setPlaceholder('0-100'),
      ),
    );
  }
  return modal;
}

function cooldownModal(current: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'cooldownmodal'))
    .setTitle(t('modules.route.panel.editCooldown'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('minutes')
          .setLabel(t('modules.route.panel.cooldownLabel'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true)
          .setValue(String(current))
          .setPlaceholder('15'),
      ),
    );
}

function modalInput(id: string, label: string, value: number, placeholder: string) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label.slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(6)
      .setRequired(true)
      .setValue(String(value))
      .setPlaceholder(placeholder),
  );
}

function regenModal(config: RouteConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'regenmodal'))
    .setTitle(t('modules.route.panel.editRegen'))
    .addComponents(
      modalInput('rate', t('modules.route.panel.regenRateLabel'), config.energyRegenRate, '1'),
      modalInput('cap', t('modules.route.panel.regenCapLabel'), config.energyRegenCap, '15'),
    );
}

function pricesModal(
  kind: 'shoppricesmodal' | 'peddlerpricesmodal',
  title: string,
  prices: RouteConfig['shopPrices'],
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(panelCustomId(MODULE_NAME, kind)).setTitle(title);
  for (const key of PRICE_KEYS) {
    modal.addComponents(
      modalInput(key, t(`modules.route.goods.${key}.name`), prices[key], String(prices[key])),
    );
  }
  return modal;
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'cooldown': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await interaction.showModal(cooldownModal(config.cooldownMinutes));
      return;
    }
    case 'cooldownmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const parsed = Number.parseInt(interaction.fields.getTextInputValue('minutes'), 10);
      const cooldownMinutes = Number.isNaN(parsed) ? 15 : Math.min(1440, Math.max(0, parsed));
      await updateRouteConfig(ctx, guildId, { cooldownMinutes });
      await interaction.update(await renderPage());
      return;
    }
    case 'coins': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await updateRouteConfig(ctx, guildId, { giveCoins: !config.giveCoins });
      await interaction.update(await renderPage());
      return;
    }
    case 'items': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await updateRouteConfig(ctx, guildId, { giveItems: !config.giveItems });
      await interaction.update(await renderPage());
      return;
    }
    case 'drops': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await interaction.showModal(dropsModal(config.drops));
      return;
    }
    case 'dropsmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getRouteConfig(ctx, guildId);
      const drops = { ...config.drops };
      for (const r of RARITIES) {
        drops[r] = clampPct(interaction.fields.getTextInputValue(r), drops[r]);
      }
      await updateRouteConfig(ctx, guildId, { drops });
      await interaction.update(await renderPage());
      return;
    }
    case 'regen': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await interaction.showModal(regenModal(config));
      return;
    }
    case 'regenmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getRouteConfig(ctx, guildId);
      const energyRegenRate = clampInt(
        interaction.fields.getTextInputValue('rate'),
        config.energyRegenRate,
        0,
        10,
      );
      const energyRegenCap = clampInt(
        interaction.fields.getTextInputValue('cap'),
        config.energyRegenCap,
        0,
        100,
      );
      await updateRouteConfig(ctx, guildId, { energyRegenRate, energyRegenCap });
      await interaction.update(await renderPage());
      return;
    }
    case 'shopprices': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await interaction.showModal(
        pricesModal('shoppricesmodal', t('modules.route.panel.editShopPrices'), config.shopPrices),
      );
      return;
    }
    case 'peddlerprices': {
      if (!interaction.isButton()) return;
      const config = await getRouteConfig(ctx, guildId);
      await interaction.showModal(
        pricesModal(
          'peddlerpricesmodal',
          t('modules.route.panel.editPeddlerPrices'),
          config.peddlerPrices,
        ),
      );
      return;
    }
    case 'shoppricesmodal':
    case 'peddlerpricesmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getRouteConfig(ctx, guildId);
      const field = action === 'shoppricesmodal' ? 'shopPrices' : 'peddlerPrices';
      const prices = { ...config[field] };
      for (const key of PRICE_KEYS) {
        prices[key] = clampInt(interaction.fields.getTextInputValue(key), prices[key], 0, 100000);
      }
      await updateRouteConfig(ctx, guildId, { [field]: prices });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Route de l'Infini ». */
export const routePanel: ConfigPanel = { render, handle };
