import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { getItem, listItems } from '../items/service.js';
import {
  type AdventConfig,
  type DayReward,
  LAST_DAY,
  MODULE_NAME,
  getAdventConfig,
  updateAdventConfig,
} from './config.js';
import { rewardForDay } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function d(key: string, vars?: Record<string, string | number>): string {
  return t(`modules.advent.panel.${key}`, vars);
}

function upsertReward(config: AdventConfig, day: number, patch: Partial<DayReward>): DayReward[] {
  if (config.rewards.some((reward) => reward.day === day)) {
    return config.rewards.map((reward) => (reward.day === day ? { ...reward, ...patch } : reward));
  }
  return [
    ...config.rewards,
    { day, coins: config.defaultCoins, itemId: null, itemQty: 1, message: '', ...patch },
  ].sort((a, b) => a.day - b.day);
}

// --- Page principale --------------------------------------------------------

function daysSummary(config: AdventConfig): string {
  if (!config.rewards.length) return d('allDefault', { coins: config.defaultCoins });
  return config.rewards
    .slice()
    .sort((a, b) => a.day - b.day)
    .map((reward) => {
      const bits = [d('coinsShort', { coins: reward.coins })];
      if (reward.itemId) bits.push(`🎁×${reward.itemQty}`);
      return `• ${d('dayN', { day: reward.day })} — ${bits.join(' · ')}`;
    })
    .join('\n');
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getAdventConfig(ctx, guildId);

  const embed = infoEmbed({
    title: t('modules.advent.label'),
    description: d('intro'),
  }).addFields(
    {
      name: d('announceField'),
      value: config.announceChannelId ? `<#${config.announceChannelId}>` : d('notSet'),
      inline: true,
    },
    {
      name: d('testField'),
      value: config.testMode ? d('testOn') : d('testOff'),
      inline: true,
    },
    { name: d('defaultCoinsField'), value: String(config.defaultCoins), inline: true },
    { name: d('daysField'), value: daysSummary(config) },
  );

  const dayPicker = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'daypick'))
    .setPlaceholder(d('dayPickPlaceholder'))
    .addOptions(
      Array.from({ length: LAST_DAY }, (_, i) => i + 1).map((day) => {
        const reward = rewardForDay(config, day);
        const summary = `${d('coinsShort', { coins: reward.coins })}${reward.itemId ? ' · 🎁' : ''}`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(d('dayN', { day }))
          .setValue(String(day))
          .setDescription(summary.slice(0, 100));
      }),
    );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(d('announcePlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(dayPicker),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'test'))
        .setLabel(config.testMode ? d('disableTest') : d('enableTest'))
        .setStyle(config.testMode ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'defcoins'))
        .setLabel(d('editDefaultCoins'))
        .setStyle(ButtonStyle.Primary),
    ),
  ];

  return { embed, components };
}

// --- Sous-page : édition d'un jour ------------------------------------------

async function renderDayEdit(
  ctx: BotContext,
  guildId: string,
  config: AdventConfig,
  day: number,
): Promise<{ embeds: EmbedBuilder[]; components: PanelRow[] }> {
  const reward = rewardForDay(config, day);
  const explicit = config.rewards.some((entry) => entry.day === day);

  let itemLabel = d('noItem');
  if (reward.itemId) {
    const item = await getItem(ctx, guildId, reward.itemId);
    itemLabel = item
      ? `${item.emoji ? `${item.emoji} ` : ''}${item.name} ×${reward.itemQty}`
      : d('itemMissing');
  }

  const embed = infoEmbed({
    title: d('dayEditTitle', { day }),
    description: explicit ? d('dayEditIntro') : d('dayEditDefault'),
  }).addFields(
    { name: d('coinsField'), value: String(reward.coins), inline: true },
    { name: d('itemField'), value: itemLabel, inline: true },
    { name: d('messageField'), value: reward.message || d('noMessage') },
  );

  const components: PanelRow[] = [];

  const items = await listItems(ctx, guildId);
  if (items.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'itempick', String(day)))
          .setPlaceholder(d('itemPickPlaceholder'))
          .addOptions(
            items.slice(0, 25).map((item) => {
              const option = new StringSelectMenuOptionBuilder()
                .setLabel(item.name.slice(0, 100))
                .setValue(item.id)
                .setDefault(item.id === reward.itemId);
              if (item.emoji) option.setEmoji(item.emoji);
              return option;
            }),
          ),
      ),
    );
  }

  const buttons = row().addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'reward', String(day)))
      .setLabel(d('editReward'))
      .setStyle(ButtonStyle.Primary),
  );
  if (reward.itemId) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'clearitem', String(day)))
        .setLabel(d('clearItem'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'home'))
      .setLabel(d('back'))
      .setStyle(ButtonStyle.Secondary),
  );
  components.push(buttons);

  return { embeds: [embed], components };
}

// --- Modals -----------------------------------------------------------------

function textRow(
  id: string,
  label: string,
  style: TextInputStyle,
  opts: Partial<{ value: string; max: number; required: boolean; placeholder: string }> = {},
): ActionRowBuilder<TextInputBuilder> {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (opts.value) field.setValue(opts.value);
  if (opts.max) field.setMaxLength(opts.max);
  field.setRequired(opts.required ?? false);
  if (opts.placeholder) field.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

function rewardModal(day: number, reward: DayReward): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'rewardmodal', String(day)))
    .setTitle(d('rewardModalTitle', { day }))
    .addComponents(
      textRow('coins', d('coinsField'), TextInputStyle.Short, {
        max: 7,
        required: true,
        value: String(reward.coins),
      }),
      textRow('qty', d('itemQtyField'), TextInputStyle.Short, {
        max: 3,
        value: String(reward.itemQty),
        placeholder: '1',
      }),
      textRow('message', d('messageField'), TextInputStyle.Paragraph, {
        max: 500,
        value: reward.message,
      }),
    );
}

function defaultCoinsModal(config: AdventConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'defcoinsmodal'))
    .setTitle(d('defaultCoinsField'))
    .addComponents(
      textRow('coins', d('defaultCoinsField'), TextInputStyle.Short, {
        max: 7,
        required: true,
        value: String(config.defaultCoins),
      }),
    );
}

function parseAmount(input: string, max: number, fallback: number): number {
  const parsed = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, parsed));
}

// --- Routeur ----------------------------------------------------------------

async function showDay(
  interaction: PanelHandlerArgs['interaction'],
  ctx: BotContext,
  guildId: string,
  day: number,
  renderPage: PanelHandlerArgs['renderPage'],
): Promise<void> {
  const config = await getAdventConfig(ctx, guildId);
  const view = day >= 1 && day <= LAST_DAY ? await renderDayEdit(ctx, guildId, config, day) : null;
  const page = view ?? (await renderPage());
  if (interaction.isMessageComponent()) {
    await interaction.update(page);
  } else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(page);
  }
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  const day = Number.parseInt(params[0] ?? '', 10);

  switch (action) {
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateAdventConfig(ctx, guildId, { announceChannelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'test': {
      if (!interaction.isButton()) return;
      const config = await getAdventConfig(ctx, guildId);
      await updateAdventConfig(ctx, guildId, { testMode: !config.testMode });
      await interaction.update(await renderPage());
      return;
    }
    case 'defcoins': {
      if (!interaction.isButton()) return;
      const config = await getAdventConfig(ctx, guildId);
      await interaction.showModal(defaultCoinsModal(config));
      return;
    }
    case 'defcoinsmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getAdventConfig(ctx, guildId);
      await updateAdventConfig(ctx, guildId, {
        defaultCoins: parseAmount(
          interaction.fields.getTextInputValue('coins'),
          1_000_000,
          config.defaultCoins,
        ),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'daypick': {
      if (!interaction.isStringSelectMenu()) return;
      await showDay(
        interaction,
        ctx,
        guildId,
        Number.parseInt(interaction.values[0] ?? '', 10),
        renderPage,
      );
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'reward': {
      if (!interaction.isButton()) return;
      const config = await getAdventConfig(ctx, guildId);
      if (day < 1 || day > LAST_DAY) return;
      await interaction.showModal(rewardModal(day, rewardForDay(config, day)));
      return;
    }
    case 'rewardmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      if (day < 1 || day > LAST_DAY) return;
      const config = await getAdventConfig(ctx, guildId);
      const rewards = upsertReward(config, day, {
        coins: parseAmount(interaction.fields.getTextInputValue('coins'), 1_000_000, 0),
        itemQty: Math.max(1, parseAmount(interaction.fields.getTextInputValue('qty'), 100, 1)),
        message: interaction.fields.getTextInputValue('message').trim().slice(0, 500),
      });
      await updateAdventConfig(ctx, guildId, { rewards });
      await showDay(interaction, ctx, guildId, day, renderPage);
      return;
    }
    case 'itempick': {
      if (!interaction.isStringSelectMenu()) return;
      if (day < 1 || day > LAST_DAY) return;
      const config = await getAdventConfig(ctx, guildId);
      const rewards = upsertReward(config, day, { itemId: interaction.values[0] ?? null });
      await updateAdventConfig(ctx, guildId, { rewards });
      await showDay(interaction, ctx, guildId, day, renderPage);
      return;
    }
    case 'clearitem': {
      if (!interaction.isButton()) return;
      if (day < 1 || day > LAST_DAY) return;
      const config = await getAdventConfig(ctx, guildId);
      const rewards = upsertReward(config, day, { itemId: null });
      await updateAdventConfig(ctx, guildId, { rewards });
      await showDay(interaction, ctx, guildId, day, renderPage);
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Calendrier de l'Avent ». */
export const adventPanel: ConfigPanel = { render, handle };
