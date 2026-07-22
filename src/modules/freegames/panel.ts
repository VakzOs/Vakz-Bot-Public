import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import {
  ALL_PLATFORMS,
  MODULE_NAME,
  type Platform,
  getFreegamesConfig,
  platformSchema,
  updateFreegamesConfig,
} from './config.js';
import { buildFreeGameEmbed, fetchFreeGames } from './service.js';

const PLATFORM_EMOJI: Record<Platform, string> = { steam: '🎮', epic: '🛒', gog: '🟣' };

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function platformsLabel(platforms: Platform[]): string {
  if (platforms.length === 0) return t('modules.freegames.panel.noPlatform');
  return platforms
    .map((p) => `${PLATFORM_EMOJI[p]} ${t(`modules.freegames.platform.${p}`)}`)
    .join(', ');
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getFreegamesConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.freegames.label'),
    description: t('modules.freegames.panel.intro'),
  }).addFields(
    {
      name: t('modules.freegames.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.freegames.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.freegames.panel.roleField'),
      value: config.roleId ? `<@&${config.roleId}>` : t('modules.freegames.panel.none'),
      inline: true,
    },
    {
      name: t('modules.freegames.panel.platformsField'),
      value: platformsLabel(config.platforms),
    },
  );

  const platformSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'platforms'))
    .setPlaceholder(t('modules.freegames.panel.platformsPlaceholder'))
    .setMinValues(0)
    .setMaxValues(ALL_PLATFORMS.length)
    .addOptions(
      ALL_PLATFORMS.map((p) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(t(`modules.freegames.platform.${p}`))
          .setValue(p)
          .setEmoji(PLATFORM_EMOJI[p])
          .setDefault(config.platforms.includes(p)),
      ),
    );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.freegames.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'role'))
        .setPlaceholder(t('modules.freegames.panel.rolePlaceholder'))
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(platformSelect),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'preview'))
        .setLabel(t('modules.freegames.panel.preview'))
        .setEmoji('🔎')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embed, components };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  switch (action) {
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateFreegamesConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateFreegamesConfig(ctx, guildId, { roleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'platforms': {
      if (!interaction.isStringSelectMenu()) return;
      const platforms = interaction.values
        .map((value) => platformSchema.safeParse(value))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
      await updateFreegamesConfig(ctx, guildId, { platforms });
      await interaction.update(await renderPage());
      return;
    }
    case 'preview': {
      if (!interaction.isButton()) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const config = await getFreegamesConfig(ctx, guildId);
      const platforms = config.platforms.length ? config.platforms : ALL_PLATFORMS;
      const games = await fetchFreeGames(platforms);
      if (games.length === 0) {
        await interaction.editReply({ content: t('modules.freegames.command.none') });
        return;
      }
      await interaction.editReply({
        content: t('modules.freegames.command.title', { count: games.length }),
        embeds: games.slice(0, 8).map(buildFreeGameEmbed),
      });
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Jeux gratuits ». */
export const freegamesPanel: ConfigPanel = { render, handle };
