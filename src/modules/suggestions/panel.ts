import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
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
import { listItems } from '../items/service.js';
import {
  type SuggestionsConfig,
  MODULE_NAME,
  getSuggestionsConfig,
  updateSuggestionsConfig,
} from './config.js';

function d(key: string, vars?: Record<string, string | number>): string {
  return t(`modules.suggestions.panel.${key}`, vars);
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getSuggestionsConfig(ctx, guildId);

  const embed = infoEmbed({
    title: t('modules.suggestions.label'),
    description: t('modules.suggestions.panel.intro'),
  }).addFields(
    {
      name: t('modules.suggestions.panel.channelField'),
      value: config.channelIds.length
        ? config.channelIds.map((id) => `<#${id}>`).join(', ')
        : t('modules.suggestions.panel.noChannels'),
      inline: false,
    },
    {
      name: t('modules.suggestions.panel.staffField'),
      value: config.staffRoleId
        ? `<@&${config.staffRoleId}>`
        : t('modules.suggestions.panel.staffDefault'),
      inline: true,
    },
    {
      name: t('modules.suggestions.panel.threadField'),
      value: config.createThread
        ? t('modules.suggestions.panel.on')
        : t('modules.suggestions.panel.off'),
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      ((): ChannelSelectMenuBuilder => {
        const select = new ChannelSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
          .setPlaceholder(t('modules.suggestions.panel.channelPlaceholder'))
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(0)
          .setMaxValues(25);
        if (config.channelIds.length) select.setDefaultChannels(config.channelIds);
        return select;
      })(),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'staff'))
        .setPlaceholder(t('modules.suggestions.panel.staffPlaceholder'))
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'thread'))
        .setLabel(t('modules.suggestions.panel.threadToggle'))
        .setStyle(config.createThread ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'adv2'))
        .setLabel(d('advanced'))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embed, components };
}

async function renderAdvanced(
  ctx: BotContext,
  guildId: string,
  config: SuggestionsConfig,
): Promise<{ embeds: EmbedBuilder[]; components: PanelRow[] }> {
  const guild = ctx.client.guilds.cache.get(guildId);
  const roleLimits = config.roleLimits.filter((entry) => guild?.roles.cache.has(entry.roleId));
  const limitsText = roleLimits.length
    ? roleLimits
        .map(
          (entry) => `• <@&${entry.roleId}> — ${entry.limit === 0 ? d('unlimited') : entry.limit}`,
        )
        .join('\n')
    : d('noRoleLimits');

  const rewardItem = config.rewardItemId
    ? await listItems(ctx, guildId).then((items) =>
        items.find((item) => item.id === config.rewardItemId),
      )
    : undefined;
  const rewardText = [
    config.rewardCoins > 0 ? d('rewardCoinsValue', { coins: config.rewardCoins }) : null,
    rewardItem ? d('rewardItemValue', { item: rewardItem.name }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const embed = infoEmbed({ title: d('advTitle'), description: d('advIntro') }).addFields(
    {
      name: d('defaultLimitField'),
      value: config.maxPending === 0 ? d('unlimited') : String(config.maxPending),
      inline: true,
    },
    {
      name: d('dynColorField'),
      value: config.dynamicColor ? d('on') : d('off'),
      inline: true,
    },
    { name: d('rewardField'), value: rewardText || d('noReward') },
    { name: d('roleLimitsField'), value: limitsText },
  );

  const items = await listItems(ctx, guildId);
  const components: PanelRow[] = [
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'limitadd'))
        .setPlaceholder(d('roleLimitAdd'))
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (items.length) {
    const itemSelect = new StringSelectMenuBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'rewarditem'))
      .setPlaceholder(d('rewardItemPlaceholder'))
      .setMinValues(0)
      .setMaxValues(1)
      .addOptions(
        items.slice(0, 25).map((item) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(item.name.slice(0, 100))
            .setValue(item.id)
            .setDefault(item.id === config.rewardItemId),
        ),
      );
    components.push(row().addComponents(itemSelect));
  }

  if (roleLimits.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'limitremove'))
          .setPlaceholder(d('roleLimitRemove'))
          .addOptions(
            roleLimits
              .slice(0, 25)
              .map((entry) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(
                    `${guild?.roles.cache.get(entry.roleId)?.name ?? entry.roleId} • ${entry.limit === 0 ? '∞' : entry.limit}`.slice(
                      0,
                      100,
                    ),
                  )
                  .setValue(entry.roleId),
              ),
          ),
      ),
    );
  }

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'defaultlimit'))
        .setLabel(d('editDefaultLimit'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'rewardcoins'))
        .setLabel(d('editRewardCoins'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'dyncolor'))
        .setLabel(config.dynamicColor ? d('dynColorDisable') : d('dynColorEnable'))
        .setStyle(config.dynamicColor ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'back'))
        .setLabel(d('back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

async function showAdvanced(
  interaction: PanelHandlerArgs['interaction'],
  ctx: BotContext,
  guildId: string,
): Promise<void> {
  const view = await renderAdvanced(ctx, guildId, await getSuggestionsConfig(ctx, guildId));
  if (interaction.isMessageComponent()) {
    await interaction.update(view);
  } else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(view);
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
  switch (action) {
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateSuggestionsConfig(ctx, guildId, { channelIds: [...interaction.values] });
      await interaction.update(await renderPage());
      return;
    }
    case 'staff': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateSuggestionsConfig(ctx, guildId, { staffRoleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'thread': {
      if (!interaction.isButton()) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      await updateSuggestionsConfig(ctx, guildId, { createThread: !config.createThread });
      await interaction.update(await renderPage());
      return;
    }

    // --- Réglages avancés ---
    case 'adv2': {
      if (!interaction.isButton()) return;
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    case 'back': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'dyncolor': {
      if (!interaction.isButton()) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      await updateSuggestionsConfig(ctx, guildId, { dynamicColor: !config.dynamicColor });
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    case 'rewarditem': {
      if (!interaction.isStringSelectMenu()) return;
      await updateSuggestionsConfig(ctx, guildId, { rewardItemId: interaction.values[0] ?? null });
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    case 'limitremove': {
      if (!interaction.isStringSelectMenu()) return;
      const roleId = interaction.values[0];
      const config = await getSuggestionsConfig(ctx, guildId);
      await updateSuggestionsConfig(ctx, guildId, {
        roleLimits: config.roleLimits.filter((entry) => entry.roleId !== roleId),
      });
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    case 'limitadd': {
      if (!interaction.isRoleSelectMenu()) return;
      const roleId = interaction.values[0];
      if (!roleId) return;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'limitmodal', roleId))
          .setTitle(d('roleLimitModalTitle'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('limit')
                .setLabel(d('roleLimitField'))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(3)
                .setPlaceholder('3'),
            ),
          ),
      );
      return;
    }
    case 'limitmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const roleId = params[0];
      if (!roleId) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      const limit = clampInt(interaction.fields.getTextInputValue('limit'), 0, 0, 100);
      const roleLimits = [
        ...config.roleLimits.filter((entry) => entry.roleId !== roleId),
        { roleId, limit },
      ];
      await updateSuggestionsConfig(ctx, guildId, { roleLimits });
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    case 'defaultlimit': {
      if (!interaction.isButton()) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'defaultlimitmodal'))
          .setTitle(d('editDefaultLimit'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('limit')
                .setLabel(d('defaultLimitField'))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(3)
                .setValue(String(config.maxPending)),
            ),
          ),
      );
      return;
    }
    case 'defaultlimitmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      await updateSuggestionsConfig(ctx, guildId, {
        maxPending: clampInt(
          interaction.fields.getTextInputValue('limit'),
          config.maxPending,
          0,
          100,
        ),
      });
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    case 'rewardcoins': {
      if (!interaction.isButton()) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'rewardcoinsmodal'))
          .setTitle(d('editRewardCoins'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('coins')
                .setLabel(d('rewardCoinsField'))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(7)
                .setValue(String(config.rewardCoins)),
            ),
          ),
      );
      return;
    }
    case 'rewardcoinsmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getSuggestionsConfig(ctx, guildId);
      await updateSuggestionsConfig(ctx, guildId, {
        rewardCoins: clampInt(
          interaction.fields.getTextInputValue('coins'),
          config.rewardCoins,
          0,
          1_000_000,
        ),
      });
      await showAdvanced(interaction, ctx, guildId);
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Suggestions ». */
export const suggestionsPanel: ConfigPanel = { render, handle };
