import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import {
  MODULE_NAME,
  type VerificationMethod,
  getVerificationConfig,
  updateVerificationConfig,
} from './config.js';
import { publishVerification, roleAssignable } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function methodLabel(method: VerificationMethod): string {
  return method === 'captcha'
    ? t('modules.verification.panel.methodCaptcha')
    : t('modules.verification.panel.methodButton');
}

function textModal(title: string, content: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'textmodal'))
    .setTitle(t('modules.verification.panel.textModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel(t('modules.verification.panel.titleField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(true)
          .setValue(title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('content')
          .setLabel(t('modules.verification.panel.contentField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true)
          .setValue(content),
      ),
    );
}

function buttonModal(label: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'btnmodal'))
    .setTitle(t('modules.verification.panel.buttonModalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel(t('modules.verification.panel.buttonField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true)
          .setValue(label),
      ),
    );
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getVerificationConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);

  const roleOk = !config.roleId || (!!guild && roleAssignable(guild, config.roleId));

  const embed = infoEmbed({
    title: t('modules.verification.label'),
    description: t('modules.verification.panel.intro'),
  }).addFields(
    {
      name: t('modules.verification.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.verification.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.verification.panel.roleField'),
      value: config.roleId
        ? `<@&${config.roleId}>${roleOk ? '' : ' ⚠️'}`
        : t('modules.verification.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.verification.panel.methodField'),
      value: methodLabel(config.method),
      inline: true,
    },
    {
      name: t('modules.verification.panel.statusField'),
      value: config.messageId
        ? t('modules.verification.panel.published')
        : t('modules.verification.panel.notPublished'),
      inline: true,
    },
    {
      name: t('modules.verification.panel.logField'),
      value: config.logChannelId
        ? `<#${config.logChannelId}>`
        : t('modules.verification.panel.notSet'),
      inline: true,
    },
    { name: t('modules.verification.panel.previewField'), value: truncate(config.content) },
  );

  if (!roleOk) {
    embed.addFields({ name: '⚠️', value: t('modules.verification.panel.roleWarning') });
  }

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.verification.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'role'))
        .setPlaceholder(t('modules.verification.panel.rolePlaceholder'))
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'logchan'))
        .setPlaceholder(t('modules.verification.panel.logPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'method'))
        .setLabel(
          t('modules.verification.panel.methodToggle', { method: methodLabel(config.method) }),
        )
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'text'))
        .setLabel(t('modules.verification.panel.editText'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'btn'))
        .setLabel(t('modules.verification.panel.editButton'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'publish'))
        .setLabel(t('modules.verification.panel.publish'))
        .setStyle(ButtonStyle.Success),
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
      await updateVerificationConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateVerificationConfig(ctx, guildId, { roleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'logchan': {
      if (!interaction.isChannelSelectMenu()) return;
      await updateVerificationConfig(ctx, guildId, { logChannelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'method': {
      if (!interaction.isButton()) return;
      const config = await getVerificationConfig(ctx, guildId);
      await updateVerificationConfig(ctx, guildId, {
        method: config.method === 'captcha' ? 'button' : 'captcha',
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'text': {
      if (!interaction.isButton()) return;
      const config = await getVerificationConfig(ctx, guildId);
      await interaction.showModal(textModal(config.title, config.content));
      return;
    }
    case 'textmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateVerificationConfig(ctx, guildId, {
        title: interaction.fields.getTextInputValue('title'),
        content: interaction.fields.getTextInputValue('content'),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'btn': {
      if (!interaction.isButton()) return;
      const config = await getVerificationConfig(ctx, guildId);
      await interaction.showModal(buttonModal(config.buttonLabel));
      return;
    }
    case 'btnmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const label = interaction.fields.getTextInputValue('label').trim();
      await updateVerificationConfig(ctx, guildId, { buttonLabel: label || '✅ Se vérifier' });
      await interaction.update(await renderPage());
      return;
    }
    case 'publish': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const config = await getVerificationConfig(ctx, guildId);
      if (!config.roleId) {
        await interaction.reply({
          content: t('modules.verification.panel.needRole'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const result = await publishVerification(interaction.guild, config);
      if (!result.ok) {
        await interaction.reply({
          content: t(`modules.verification.panel.publishError.${result.error}`),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateVerificationConfig(ctx, guildId, { messageId: result.messageId });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Vérification ». */
export const verificationPanel: ConfigPanel = { render, handle };
