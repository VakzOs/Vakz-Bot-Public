import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import {
  MODULE_NAME,
  type GreetConfig,
  type GreetKind,
  getWelcomeConfig,
  updateGreetConfig,
} from './config.js';
import { sendGreeting } from './greet.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function summarize(greet: GreetConfig): string {
  const status = greet.enabled
    ? t('modules.welcome.state.statusOn')
    : t('modules.welcome.state.statusOff');
  const channel = greet.channelId
    ? `<#${greet.channelId}>`
    : t('modules.welcome.state.channelNone');
  const embed = greet.embed ? t('modules.welcome.state.yes') : t('modules.welcome.state.no');
  const card = greet.card
    ? greet.cardBackground
      ? t('modules.welcome.state.cardCustom')
      : t('modules.welcome.state.cardDefault')
    : t('modules.welcome.state.no');
  return [
    `${t('modules.welcome.state.statusLabel')} : ${status}`,
    `${t('modules.welcome.state.channelLabel')} : ${channel}`,
    `${t('modules.welcome.state.embedLabel')} : ${embed}`,
    `${t('modules.welcome.state.cardLabel')} : ${card}`,
    `${t('modules.welcome.state.messageLabel')} : ${truncate(greet.message)}`,
    `${t('modules.welcome.state.footerLabel')} : ${
      greet.footer ? truncate(greet.footer) : t('modules.welcome.state.channelNone')
    }`,
  ].join('\n');
}

function greetRows(kind: GreetKind, greet: GreetConfig): PanelRow[] {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'chan', kind))
    .setPlaceholder(
      kind === 'welcome'
        ? t('modules.welcome.panel.welcomeChannel')
        : t('modules.welcome.panel.leaveChannel'),
    )
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  const buttons = row().addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'toggle', kind))
      .setLabel(
        kind === 'welcome'
          ? t('modules.welcome.panel.welcomeToggle')
          : t('modules.welcome.panel.leaveToggle'),
      )
      .setStyle(greet.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'embed', kind))
      .setLabel(t('modules.welcome.panel.embed'))
      .setStyle(greet.embed ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'card', kind))
      .setLabel(t('modules.welcome.panel.card'))
      .setStyle(greet.card ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'msg', kind))
      .setLabel(t('modules.welcome.panel.message'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'test', kind))
      .setLabel(t('modules.welcome.panel.test'))
      .setStyle(ButtonStyle.Secondary),
  );

  return [row().addComponents(channelSelect), buttons];
}

function messageModal(kind: GreetKind, greet: GreetConfig): ModalBuilder {
  const messageInput = new TextInputBuilder()
    .setCustomId('message')
    .setLabel(t('modules.welcome.panel.modalField'))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(2000)
    .setRequired(true)
    .setValue(greet.message)
    .setPlaceholder(t('modules.welcome.panel.modalPlaceholder'));

  const footerInput = new TextInputBuilder()
    .setCustomId('footer')
    .setLabel(t('modules.welcome.panel.modalFooterField'))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(256)
    .setRequired(false)
    .setValue(greet.footer)
    .setPlaceholder(t('modules.welcome.panel.modalFooterPlaceholder'));

  const cardInput = new TextInputBuilder()
    .setCustomId('cardBackground')
    .setLabel(t('modules.welcome.panel.modalCardField'))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(500)
    .setRequired(false)
    .setValue(greet.cardBackground)
    .setPlaceholder(t('modules.welcome.panel.modalCardPlaceholder'));

  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'msgmodal', kind))
    .setTitle(
      kind === 'welcome'
        ? t('modules.welcome.panel.modalTitleWelcome')
        : t('modules.welcome.panel.modalTitleLeave'),
    )
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(footerInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(cardInput),
    );
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getWelcomeConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.welcome.label'),
    description: t('modules.welcome.panel.intro'),
  }).addFields(
    { name: t('modules.welcome.panel.arrivals'), value: summarize(config.welcome) },
    { name: t('modules.welcome.panel.departures'), value: summarize(config.leave) },
  );

  return {
    embed,
    components: [...greetRows('welcome', config.welcome), ...greetRows('leave', config.leave)],
  };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  const kind: GreetKind = params[0] === 'leave' ? 'leave' : 'welcome';

  switch (action) {
    case 'msg': {
      if (!interaction.isButton()) return;
      const config = await getWelcomeConfig(ctx, guildId);
      await interaction.showModal(messageModal(kind, config[kind]));
      return;
    }
    case 'msgmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const message = interaction.fields.getTextInputValue('message');
      const footer = interaction.fields.getTextInputValue('footer');
      const cardBackground = interaction.fields.getTextInputValue('cardBackground').trim();
      await updateGreetConfig(ctx, guildId, kind, { message, footer, cardBackground });
      await interaction.update(await renderPage());
      return;
    }
    case 'card': {
      if (!interaction.isButton()) return;
      const config = await getWelcomeConfig(ctx, guildId);
      await updateGreetConfig(ctx, guildId, kind, { card: !config[kind].card });
      await interaction.update(await renderPage());
      return;
    }
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateGreetConfig(ctx, guildId, kind, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'toggle':
    case 'embed': {
      if (!interaction.isButton()) return;
      const config = await getWelcomeConfig(ctx, guildId);
      const patch: Partial<GreetConfig> =
        action === 'toggle' ? { enabled: !config[kind].enabled } : { embed: !config[kind].embed };
      await updateGreetConfig(ctx, guildId, kind, patch);
      await interaction.update(await renderPage());
      return;
    }
    case 'test': {
      if (!interaction.isButton()) return;
      const guild = interaction.guild;
      const config = await getWelcomeConfig(ctx, guildId);
      const greet = config[kind];
      if (!guild || !greet.channelId) {
        await interaction.reply({
          content: t('modules.welcome.panel.testNoChannel'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const member = await guild.members.fetch(interaction.user.id);
      await sendGreeting(member, { ...greet, enabled: true }, kind);
      await interaction.reply({
        content: t('modules.welcome.panel.testSent', { channel: `<#${greet.channelId}>` }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Arrivées & départs ». */
export const welcomePanel: ConfigPanel = { render, handle };
