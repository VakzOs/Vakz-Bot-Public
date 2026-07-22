import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  PermissionFlagsBits,
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
import { MODULE_NAME, type LevelsConfig, getLevelsConfig, updateLevelsConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 150): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sortedRewards(config: LevelsConfig): LevelsConfig['rewards'] {
  return config.rewards.slice().sort((a, b) => a.level - b.level);
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function messageModal(current: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'msgmodal'))
    .setTitle(t('modules.levels.panel.msgModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel(t('modules.levels.panel.msgModalField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
          .setValue(current)
          .setPlaceholder(t('modules.levels.panel.msgModalPlaceholder')),
      ),
    );
}

function xpField(id: string, label: string, value: number): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(5)
      .setValue(String(value)),
  );
}

function xpModal(config: LevelsConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'xpmodal'))
    .setTitle(t('modules.levels.panel.xpModalTitle'))
    .addComponents(
      xpField('xpMin', t('modules.levels.panel.xpMinField'), config.xpMin),
      xpField('xpMax', t('modules.levels.panel.xpMaxField'), config.xpMax),
      xpField('cooldown', t('modules.levels.panel.cooldownField'), config.cooldown),
    );
}

function rewardModal(roleId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'rewardlevel', roleId))
    .setTitle(t('modules.levels.panel.rewardModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('level')
          .setLabel(t('modules.levels.panel.rewardModalField'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(4)
          .setPlaceholder('5'),
      ),
    );
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getLevelsConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);

  const channelText = config.announce.channelId
    ? `<#${config.announce.channelId}>`
    : t('modules.levels.panel.sameChannel');
  const announceStatus = config.announce.enabled
    ? t('modules.levels.panel.on')
    : t('modules.levels.panel.off');
  const me = guild?.members.me ?? null;
  const botHighest = me?.roles.highest.position ?? 0;
  const canManageRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;

  let hasUnassignable = false;
  const rewardsText = config.rewards.length
    ? sortedRewards(config)
        .map((r) => {
          const role = guild?.roles.cache.get(r.roleId);
          const assignable = canManageRoles && !!role && role.position < botHighest;
          if (!assignable) hasUnassignable = true;
          return `• ${t('modules.levels.panel.levelWord')} ${r.level} → <@&${r.roleId}>${
            assignable ? '' : ' ⚠️'
          }`;
        })
        .join('\n')
    : t('modules.levels.panel.noRewards');

  const embed = infoEmbed({
    title: t('modules.levels.label'),
    description: t('modules.levels.panel.intro'),
  }).addFields(
    {
      name: t('modules.levels.panel.xpField'),
      value: t('modules.levels.panel.xpValue', {
        min: config.xpMin,
        max: config.xpMax,
        cd: config.cooldown,
      }),
    },
    {
      name: t('modules.levels.panel.announceField'),
      value: `${announceStatus} · ${channelText}\n${truncate(config.announce.message)}`,
    },
    { name: t('modules.levels.panel.rewardsField'), value: rewardsText },
  );

  if (hasUnassignable) {
    embed.addFields({ name: '⚠️', value: t('modules.levels.panel.rewardWarning') });
  }

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.levels.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'announce'))
        .setLabel(t('modules.levels.panel.announceToggle'))
        .setStyle(config.announce.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'msg'))
        .setLabel(t('modules.levels.panel.editMessage'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'xp'))
        .setLabel(t('modules.levels.panel.editXp'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'adv2'))
        .setLabel(t('modules.levels.panel.advanced'))
        .setStyle(ButtonStyle.Secondary),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'rewardadd'))
        .setPlaceholder(t('modules.levels.panel.addReward'))
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (config.rewards.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'rewardremove'))
          .setPlaceholder(t('modules.levels.panel.removeReward'))
          .addOptions(
            sortedRewards(config)
              .slice(0, 25)
              .map((r) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(
                    `${t('modules.levels.panel.levelWord')} ${r.level} — ${
                      guild?.roles.cache.get(r.roleId)?.name ?? r.roleId
                    }`.slice(0, 100),
                  )
                  .setValue(r.roleId),
              ),
          ),
      ),
    );
  }

  return { embed, components };
}

function clampFloat(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseHexColor(input: string): number | null {
  const value = input.trim().replace(/^#/, '');
  if (!value) return null;
  return /^[0-9a-fA-F]{6}$/.test(value) ? Number.parseInt(value, 16) : null;
}

function colorHex(color: number | null): string {
  return color === null ? '#5865f2' : `#${color.toString(16).padStart(6, '0')}`;
}

function advancedModal(config: LevelsConfig): ModalBuilder {
  const field = (id: string, label: string, value: string, placeholder: string) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setValue(value)
        .setPlaceholder(placeholder),
    );
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'advmodal'))
    .setTitle(t('modules.levels.panel.advModalTitle'))
    .addComponents(
      field(
        'multiplier',
        t('modules.levels.panel.multiplierField'),
        String(config.boosterMultiplier),
        '2',
      ),
      field('maxLevel', t('modules.levels.panel.maxLevelField'), String(config.maxLevel), '0'),
      field('curve', t('modules.levels.panel.curveField'), String(config.curveFactor), '1'),
      field(
        'voiceXp',
        t('modules.levels.panel.voiceXpField'),
        String(config.voiceXpPerMinute),
        '10',
      ),
      field(
        'color',
        t('modules.levels.panel.cardColorField'),
        config.cardColor !== null ? colorHex(config.cardColor) : '',
        '#5865f2',
      ),
    );
}

function renderAdvanced(ctx: BotContext, guildId: string, config: LevelsConfig) {
  const guild = ctx.client.guilds.cache.get(guildId);
  const inCache = (ids: string[], kind: 'channel' | 'role') =>
    ids.filter((id) =>
      kind === 'channel' ? guild?.channels.cache.has(id) : guild?.roles.cache.has(id),
    );

  const ignoredChannels = inCache(config.ignoredChannelIds, 'channel');
  const ignoredRoles = inCache(config.ignoredRoleIds, 'role');
  const boosterRoles = inCache(config.boosterRoleIds, 'role');

  const embed = infoEmbed({
    title: t('modules.levels.panel.advTitle'),
    description: t('modules.levels.panel.advIntro'),
  }).addFields(
    {
      name: t('modules.levels.panel.voiceField'),
      value: config.voiceEnabled
        ? t('modules.levels.panel.voiceOn', { xp: config.voiceXpPerMinute })
        : t('modules.levels.panel.voiceOff'),
      inline: true,
    },
    {
      name: t('modules.levels.panel.multiplierField'),
      value: `×${config.boosterMultiplier}`,
      inline: true,
    },
    {
      name: t('modules.levels.panel.maxLevelField'),
      value: config.maxLevel > 0 ? String(config.maxLevel) : t('modules.levels.panel.unlimited'),
      inline: true,
    },
    { name: t('modules.levels.panel.curveField'), value: `×${config.curveFactor}`, inline: true },
    {
      name: t('modules.levels.panel.cardColorField'),
      value: colorHex(config.cardColor),
      inline: true,
    },
    {
      name: t('modules.levels.panel.leaderboardField'),
      value: config.leaderboardChannelId
        ? `<#${config.leaderboardChannelId}>`
        : t('modules.levels.panel.off'),
      inline: true,
    },
    {
      name: t('modules.levels.panel.ignoredField'),
      value: `${t('modules.levels.panel.ignoredChannels', { count: ignoredChannels.length })} · ${t('modules.levels.panel.ignoredRoles', { count: ignoredRoles.length })} · ${t('modules.levels.panel.boosterRoles', { count: boosterRoles.length })}`,
    },
  );

  const ignoredChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'ignch'))
    .setPlaceholder(t('modules.levels.panel.ignoredChannelsPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
    .setMinValues(0)
    .setMaxValues(25);
  if (ignoredChannels.length) ignoredChannelSelect.setDefaultChannels(ignoredChannels);

  const ignoredRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'ignrole'))
    .setPlaceholder(t('modules.levels.panel.ignoredRolesPlaceholder'))
    .setMinValues(0)
    .setMaxValues(25);
  if (ignoredRoles.length) ignoredRoleSelect.setDefaultRoles(ignoredRoles);

  const boosterRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'boostrole'))
    .setPlaceholder(t('modules.levels.panel.boosterRolesPlaceholder'))
    .setMinValues(0)
    .setMaxValues(25);
  if (boosterRoles.length) boosterRoleSelect.setDefaultRoles(boosterRoles);

  const lbSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'lbchan'))
    .setPlaceholder(t('modules.levels.panel.leaderboardPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (config.leaderboardChannelId && guild?.channels.cache.has(config.leaderboardChannelId)) {
    lbSelect.setDefaultChannels([config.leaderboardChannelId]);
  }

  const components: PanelRow[] = [
    row().addComponents(ignoredChannelSelect),
    row().addComponents(ignoredRoleSelect),
    row().addComponents(boosterRoleSelect),
    row().addComponents(lbSelect),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'voice'))
        .setLabel(
          config.voiceEnabled
            ? t('modules.levels.panel.voiceDisable')
            : t('modules.levels.panel.voiceEnable'),
        )
        .setStyle(config.voiceEnabled ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'adv'))
        .setLabel(t('modules.levels.panel.advNumbers'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'back'))
        .setLabel(t('modules.levels.panel.back'))
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
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getLevelsConfig(ctx, guildId);
      await updateLevelsConfig(ctx, guildId, {
        announce: { ...config.announce, channelId: interaction.values[0] ?? null },
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'announce': {
      if (!interaction.isButton()) return;
      const config = await getLevelsConfig(ctx, guildId);
      await updateLevelsConfig(ctx, guildId, {
        announce: { ...config.announce, enabled: !config.announce.enabled },
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'msg': {
      if (!interaction.isButton()) return;
      const config = await getLevelsConfig(ctx, guildId);
      await interaction.showModal(messageModal(config.announce.message));
      return;
    }
    case 'msgmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getLevelsConfig(ctx, guildId);
      await updateLevelsConfig(ctx, guildId, {
        announce: { ...config.announce, message: interaction.fields.getTextInputValue('message') },
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'xp': {
      if (!interaction.isButton()) return;
      const config = await getLevelsConfig(ctx, guildId);
      await interaction.showModal(xpModal(config));
      return;
    }
    case 'xpmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getLevelsConfig(ctx, guildId);
      const xpMin = clampInt(interaction.fields.getTextInputValue('xpMin'), config.xpMin, 1, 1000);
      const xpMax = Math.max(
        xpMin,
        clampInt(interaction.fields.getTextInputValue('xpMax'), config.xpMax, 1, 1000),
      );
      const cooldown = clampInt(
        interaction.fields.getTextInputValue('cooldown'),
        config.cooldown,
        0,
        3600,
      );
      await updateLevelsConfig(ctx, guildId, { xpMin, xpMax, cooldown });
      await interaction.update(await renderPage());
      return;
    }
    case 'rewardadd': {
      if (!interaction.isRoleSelectMenu()) return;
      const roleId = interaction.values[0];
      if (!roleId) return;
      await interaction.showModal(rewardModal(roleId));
      return;
    }
    case 'rewardlevel': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const roleId = params[0];
      if (!roleId) return;
      const level = clampInt(interaction.fields.getTextInputValue('level'), 1, 1, 1000);
      const config = await getLevelsConfig(ctx, guildId);
      const rewards = config.rewards.filter((r) => r.roleId !== roleId);
      rewards.push({ level, roleId });
      await updateLevelsConfig(ctx, guildId, { rewards });
      await interaction.update(await renderPage());
      return;
    }
    case 'rewardremove': {
      if (!interaction.isStringSelectMenu()) return;
      const roleId = interaction.values[0];
      const config = await getLevelsConfig(ctx, guildId);
      await updateLevelsConfig(ctx, guildId, {
        rewards: config.rewards.filter((r) => r.roleId !== roleId),
      });
      await interaction.update(await renderPage());
      return;
    }

    // --- Réglages avancés ---
    case 'adv2': {
      if (!interaction.isButton()) return;
      await interaction.update(renderAdvanced(ctx, guildId, await getLevelsConfig(ctx, guildId)));
      return;
    }
    case 'back': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'ignch': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await updateLevelsConfig(ctx, guildId, {
        ignoredChannelIds: [...interaction.values],
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'ignrole': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await updateLevelsConfig(ctx, guildId, {
        ignoredRoleIds: [...interaction.values],
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'boostrole': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await updateLevelsConfig(ctx, guildId, {
        boosterRoleIds: [...interaction.values],
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'lbchan': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0] ?? null;
      const config = await updateLevelsConfig(ctx, guildId, {
        leaderboardChannelId: channelId,
        leaderboardMessageId: null,
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'voice': {
      if (!interaction.isButton()) return;
      const current = await getLevelsConfig(ctx, guildId);
      const config = await updateLevelsConfig(ctx, guildId, {
        voiceEnabled: !current.voiceEnabled,
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    case 'adv': {
      if (!interaction.isButton()) return;
      await interaction.showModal(advancedModal(await getLevelsConfig(ctx, guildId)));
      return;
    }
    case 'advmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const current = await getLevelsConfig(ctx, guildId);
      const config = await updateLevelsConfig(ctx, guildId, {
        boosterMultiplier: clampFloat(
          interaction.fields.getTextInputValue('multiplier'),
          current.boosterMultiplier,
          1,
          5,
        ),
        maxLevel: clampInt(
          interaction.fields.getTextInputValue('maxLevel'),
          current.maxLevel,
          0,
          1000,
        ),
        curveFactor: clampFloat(
          interaction.fields.getTextInputValue('curve'),
          current.curveFactor,
          0.25,
          4,
        ),
        voiceXpPerMinute: clampInt(
          interaction.fields.getTextInputValue('voiceXp'),
          current.voiceXpPerMinute,
          0,
          500,
        ),
        cardColor: parseHexColor(interaction.fields.getTextInputValue('color')),
      });
      await interaction.update(renderAdvanced(ctx, guildId, config));
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Niveaux ». */
export const levelsPanel: ConfigPanel = { render, handle };
