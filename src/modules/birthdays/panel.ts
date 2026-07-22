import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getBirthdaysConfig, updateBirthdaysConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Interprète une saisie d'heure type `14:01`, `14h01` ou `14` (minute = 0). */
function parseTime(
  input: string,
  fallback: { hour: number; minute: number },
): { hour: number; minute: number } {
  const match = /^(\d{1,2})\s*[:hH]\s*(\d{1,2})$/.exec(input.trim());
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      return { hour: Math.min(23, Math.max(0, hour)), minute: Math.min(59, Math.max(0, minute)) };
    }
  }
  const hourOnly = Number(input.trim());
  if (!Number.isNaN(hourOnly)) return { hour: Math.min(23, Math.max(0, hourOnly)), minute: 0 };
  return fallback;
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getBirthdaysConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);

  const embed = infoEmbed({
    title: t('modules.birthdays.label'),
    description: t('modules.birthdays.panel.intro'),
  }).addFields(
    {
      name: t('modules.birthdays.panel.channelField'),
      value: config.channelId ? `<#${config.channelId}>` : t('modules.birthdays.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.birthdays.panel.roleField'),
      value: config.roleId ? `<@&${config.roleId}>` : t('modules.birthdays.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.birthdays.panel.hourField'),
      value: `${pad(config.announceHour)}:${pad(config.announceMinute)}`,
      inline: true,
    },
    { name: t('modules.birthdays.panel.messageField'), value: truncate(config.message) },
  );

  const existingRole =
    config.roleId && guild?.roles.cache.has(config.roleId) ? config.roleId : null;
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'role'))
    .setPlaceholder(t('modules.birthdays.panel.rolePlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  if (existingRole) roleSelect.setDefaultRoles(existingRole);

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.birthdays.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
    row().addComponents(roleSelect),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'msg'))
        .setLabel(t('modules.birthdays.panel.editMessage'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'hour'))
        .setLabel(t('modules.birthdays.panel.editHour'))
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
      await updateBirthdaysConfig(ctx, guildId, { channelId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      await updateBirthdaysConfig(ctx, guildId, { roleId: interaction.values[0] ?? null });
      await interaction.update(await renderPage());
      return;
    }
    case 'msg': {
      if (!interaction.isButton()) return;
      const config = await getBirthdaysConfig(ctx, guildId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'msgmodal'))
          .setTitle(t('modules.birthdays.panel.messageModal'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('message')
                .setLabel(t('modules.birthdays.panel.messageField'))
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(2000)
                .setRequired(true)
                .setValue(config.message)
                .setPlaceholder('{mention} {age}'),
            ),
          ),
      );
      return;
    }
    case 'msgmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      await updateBirthdaysConfig(ctx, guildId, {
        message: interaction.fields.getTextInputValue('message'),
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'hour': {
      if (!interaction.isButton()) return;
      const config = await getBirthdaysConfig(ctx, guildId);
      const safeHour = Number.isInteger(config.announceHour) ? config.announceHour : 9;
      const safeMinute = Number.isInteger(config.announceMinute) ? config.announceMinute : 0;
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hourmodal'))
          .setTitle(t('modules.birthdays.panel.hourModal'))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('hour')
                .setLabel(t('modules.birthdays.panel.hourField'))
                .setStyle(TextInputStyle.Short)
                .setMaxLength(5)
                .setRequired(true)
                .setValue(`${pad(safeHour)}:${pad(safeMinute)}`)
                .setPlaceholder('14:01'),
            ),
          ),
      );
      return;
    }
    case 'hourmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getBirthdaysConfig(ctx, guildId);
      const { hour, minute } = parseTime(interaction.fields.getTextInputValue('hour'), {
        hour: config.announceHour,
        minute: config.announceMinute,
      });
      await updateBirthdaysConfig(ctx, guildId, { announceHour: hour, announceMinute: minute });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Anniversaires ». */
export const birthdaysPanel: ConfigPanel = { render, handle };
