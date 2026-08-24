import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
import { infoEmbed, warningEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, SEARCH_PLATFORMS, getMusicConfig, updateMusicConfig } from './config.js';
import { isMusicConfigured } from './manager.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function searchLabel(value: string): string {
  return SEARCH_PLATFORMS.find((platform) => platform.value === value)?.label ?? value;
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getMusicConfig(ctx, guildId);

  const embed = (isMusicConfigured() ? infoEmbed : warningEmbed)({
    title: t('modules.music.label'),
    description: isMusicConfigured()
      ? t('modules.music.panel.intro')
      : t('modules.music.panel.notConfigured'),
  }).addFields(
    {
      name: t('modules.music.panel.djField'),
      value: config.djRoleId ? `<@&${config.djRoleId}>` : t('modules.music.panel.djNone'),
      inline: true,
    },
    {
      name: t('modules.music.panel.searchField'),
      value: searchLabel(config.defaultSearch),
      inline: true,
    },
    {
      name: t('modules.music.panel.volumeField'),
      value: `${config.defaultVolume}% · max ${config.maxVolume}%`,
      inline: true,
    },
    {
      name: t('modules.music.panel.sameChannelField'),
      value: config.requireSameChannel ? t('modules.music.panel.on') : t('modules.music.panel.off'),
      inline: true,
    },
    {
      name: t('modules.music.panel.autoLeaveField'),
      value: config.autoLeave ? t('modules.music.panel.on') : t('modules.music.panel.off'),
      inline: true,
    },
  );

  const searchSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'search'))
    .setPlaceholder(t('modules.music.panel.searchPlaceholder'))
    .addOptions(
      SEARCH_PLATFORMS.map((platform) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(platform.label)
          .setValue(platform.value)
          .setDefault(platform.value === config.defaultSearch),
      ),
    );

  const djSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'djrole'))
    .setPlaceholder(t('modules.music.panel.djPlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  if (config.djRoleId) djSelect.setDefaultRoles([config.djRoleId]);

  const components: PanelRow[] = [
    row().addComponents(djSelect),
    row().addComponents(searchSelect),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'volumes'))
        .setLabel(t('modules.music.panel.editVolumes'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'samechannel'))
        .setLabel(
          config.requireSameChannel
            ? t('modules.music.panel.sameChannelOff')
            : t('modules.music.panel.sameChannelOn'),
        )
        .setStyle(config.requireSameChannel ? ButtonStyle.Secondary : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'autoleave'))
        .setLabel(
          config.autoLeave
            ? t('modules.music.panel.autoLeaveOff')
            : t('modules.music.panel.autoLeaveOn'),
        )
        .setStyle(config.autoLeave ? ButtonStyle.Secondary : ButtonStyle.Success),
    ),
  ];

  return { embed, components };
}

function volumesModal(defaultVolume: number, maxVolume: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'volumesmodal'))
    .setTitle(t('modules.music.panel.volumesTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('default')
          .setLabel(t('modules.music.panel.defaultVolumeField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(3)
          .setRequired(true)
          .setValue(String(defaultVolume))
          .setPlaceholder('1-100'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('max')
          .setLabel(t('modules.music.panel.maxVolumeField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(3)
          .setRequired(true)
          .setValue(String(maxVolume))
          .setPlaceholder('1-150'),
      ),
    );
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'djrole': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateMusicConfig(ctx, guildId, { djRoleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'search': {
      if (!interaction.isStringSelectMenu()) return;
      const value = interaction.values[0];
      if (value) await updateMusicConfig(ctx, guildId, { defaultSearch: value });
      await interaction.update(await renderPage());
      return;
    }
    case 'samechannel': {
      if (!interaction.isButton()) return;
      const config = await getMusicConfig(ctx, guildId);
      await updateMusicConfig(ctx, guildId, { requireSameChannel: !config.requireSameChannel });
      await interaction.update(await renderPage());
      return;
    }
    case 'autoleave': {
      if (!interaction.isButton()) return;
      const config = await getMusicConfig(ctx, guildId);
      await updateMusicConfig(ctx, guildId, { autoLeave: !config.autoLeave });
      await interaction.update(await renderPage());
      return;
    }
    case 'volumes': {
      if (!interaction.isButton()) return;
      const config = await getMusicConfig(ctx, guildId);
      await interaction.showModal(volumesModal(config.defaultVolume, config.maxVolume));
      return;
    }
    case 'volumesmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const rawDefault = Number(interaction.fields.getTextInputValue('default'));
      const rawMax = Number(interaction.fields.getTextInputValue('max'));
      const defaultVolume = Number.isFinite(rawDefault)
        ? Math.min(100, Math.max(1, Math.round(rawDefault)))
        : 60;
      const maxVolume = Number.isFinite(rawMax)
        ? Math.min(150, Math.max(1, Math.round(rawMax)))
        : 100;
      await updateMusicConfig(ctx, guildId, { defaultVolume, maxVolume });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Musique ». */
export const musicPanel: ConfigPanel = { render, handle };
