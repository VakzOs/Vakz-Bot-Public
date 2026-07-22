import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type GuildTextBasedChannel,
  type MessageActionRowComponentBuilder,
  MessageFlags,
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
import { MODULE_NAME, getInterserverConfig, updateInterserverConfig } from './config.js';
import { linkChannel, listLinks, unlinkChannel } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function d(key: string, vars?: Record<string, string | number>): string {
  return t(`modules.interserver.panel.${key}`, vars);
}

function reply(interaction: PanelHandlerArgs['interaction'], content: string) {
  if (!interaction.isRepliable()) return;
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getInterserverConfig(ctx, guildId);
  const links = await listLinks(ctx, guildId);

  const list = links.length
    ? links.map((link) => `• <#${link.channelId}> — \`${link.network}\``).join('\n')
    : d('noLinks');

  const embed = infoEmbed({
    title: t('modules.interserver.label'),
    description: d('intro'),
  }).addFields(
    { name: d('linksField'), value: list },
    {
      name: d('tagField'),
      value: config.tagServer ? d('tagOn') : d('tagOff'),
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'link'))
        .setPlaceholder(d('linkPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (links.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'unlink'))
          .setPlaceholder(d('unlinkPlaceholder'))
          .addOptions(
            links.slice(0, 25).map((link) => {
              const channel = ctx.client.guilds.cache
                .get(guildId)
                ?.channels.cache.get(link.channelId);
              return new StringSelectMenuOptionBuilder()
                .setLabel((channel?.name ?? link.channelId).slice(0, 100))
                .setValue(link.channelId)
                .setDescription(link.network.slice(0, 100));
            }),
          ),
      ),
    );
  }

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'tag'))
        .setLabel(config.tagServer ? d('disableTag') : d('enableTag'))
        .setStyle(config.tagServer ? ButtonStyle.Secondary : ButtonStyle.Success),
    ),
  );

  return { embed, components };
}

function networkModal(channelId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'linkmodal', channelId))
    .setTitle(d('linkModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('network')
          .setLabel(d('networkField'))
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(32)
          .setRequired(true)
          .setPlaceholder('salon-global'),
      ),
    );
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
    case 'link': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (!channelId) return;
      await interaction.showModal(networkModal(channelId));
      return;
    }
    case 'linkmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      if (!interaction.inCachedGuild()) return;
      const channelId = params[0] ?? '';
      const channel =
        interaction.guild.channels.cache.get(channelId) ??
        (await interaction.guild.channels.fetch(channelId).catch(() => null));
      if (!channel?.isTextBased()) {
        await reply(interaction, d('badChannel'));
        return;
      }
      const result = await linkChannel(
        ctx,
        channel as GuildTextBasedChannel,
        interaction.fields.getTextInputValue('network'),
      );
      if (!result.ok) {
        await reply(interaction, d(`linkError.${result.error}`));
        return;
      }
      await interaction.update(await renderPage());
      return;
    }
    case 'unlink': {
      if (!interaction.isStringSelectMenu()) return;
      const channelId = interaction.values[0];
      if (channelId) await unlinkChannel(ctx, channelId);
      await interaction.update(await renderPage());
      return;
    }
    case 'tag': {
      if (!interaction.isButton()) return;
      const config = await getInterserverConfig(ctx, guildId);
      await updateInterserverConfig(ctx, guildId, { tagServer: !config.tagServer });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Interserveurs ». */
export const interserverPanel: ConfigPanel = { render, handle };
