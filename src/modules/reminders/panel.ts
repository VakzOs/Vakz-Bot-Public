import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { formatDuration } from '../../lib/duration.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getRemindersConfig, updateRemindersConfig } from './config.js';
import { createReminder, nextWeeklyOccurrence } from './service.js';

const MIN_REMINDER_MINUTES = 1;
const MIN_REMINDER_MS = MIN_REMINDER_MINUTES * 60_000;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function parseTime(input: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})(?:\s*[:hH]\s*(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getRemindersConfig(ctx, guildId);
  const target =
    config.targetId === null
      ? t('modules.reminders.panel.notSet')
      : config.targetKind === 'role'
        ? `<@&${config.targetId}>`
        : `<@${config.targetId}>`;
  const destination = config.deliverInDm
    ? t('modules.reminders.panel.destinationDm')
    : config.targetChannelId
      ? `<#${config.targetChannelId}>`
      : t('modules.reminders.panel.notSet');

  const embed = infoEmbed({
    title: t('modules.reminders.label'),
    description: t('modules.reminders.panel.intro'),
  }).addFields(
    {
      name: t('modules.reminders.panel.dmField'),
      value: config.allowDm ? t('modules.reminders.panel.on') : t('modules.reminders.panel.off'),
      inline: true,
    },
    {
      name: t('modules.reminders.panel.maxDelayField'),
      value: t('modules.reminders.panel.maxDelayValue', { days: config.maxDelayDays }),
      inline: true,
    },
    {
      name: t('modules.reminders.panel.modeField'),
      value:
        config.creationMode === 'weekly'
          ? `${t('modules.reminders.panel.modeWeekly')} - ${t(
              `modules.reminders.weekdays.${config.weeklyDay}`,
            )}`
          : t('modules.reminders.panel.modeOnce'),
      inline: true,
    },
    {
      name: t('modules.reminders.panel.targetField'),
      value: target,
      inline: true,
    },
    {
      name: t('modules.reminders.panel.destinationField'),
      value: destination,
      inline: true,
    },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'target'))
        .setPlaceholder(t('modules.reminders.panel.userPlaceholder'))
        .setMinValues(1)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'role'))
        .setPlaceholder(t('modules.reminders.panel.rolePlaceholder'))
        .setMinValues(1)
        .setMaxValues(1),
    ),
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan'))
        .setPlaceholder(t('modules.reminders.panel.channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)
        .setDisabled(config.deliverInDm && config.targetKind === 'user'),
    ),
  ];

  const scheduleButton =
    config.creationMode === 'weekly'
      ? new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'weekday'))
          .setLabel(
            t('modules.reminders.panel.weekdayButton', {
              day: t(`modules.reminders.weekdays.${config.weeklyDay}`),
            }),
          )
          .setStyle(ButtonStyle.Primary)
      : new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'maxdelay'))
          .setLabel(t('modules.reminders.panel.editMaxDelay'))
          .setStyle(ButtonStyle.Primary);

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'dm'))
        .setLabel(t('modules.reminders.panel.dmToggle'))
        .setStyle(config.allowDm ? ButtonStyle.Success : ButtonStyle.Secondary),
      scheduleButton,
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'mode'))
        .setLabel(
          config.creationMode === 'weekly'
            ? t('modules.reminders.panel.modeWeekly')
            : t('modules.reminders.panel.modeOnce'),
        )
        .setStyle(config.creationMode === 'weekly' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'dest'))
        .setLabel(
          config.deliverInDm
            ? t('modules.reminders.panel.destinationDm')
            : t('modules.reminders.panel.destinationChannel'),
        )
        .setStyle(config.deliverInDm ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(config.targetKind === 'role'),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'create'))
        .setLabel(t('modules.reminders.panel.create'))
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return { embed, components };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  if (action === 'target') {
    if (!interaction.isUserSelectMenu()) return;
    await updateRemindersConfig(ctx, guildId, {
      targetKind: 'user',
      targetId: interaction.values[0] ?? null,
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'role') {
    if (!interaction.isRoleSelectMenu()) return;
    await updateRemindersConfig(ctx, guildId, {
      targetKind: 'role',
      targetId: interaction.values[0] ?? null,
      deliverInDm: false,
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'chan') {
    if (!interaction.isChannelSelectMenu()) return;
    await updateRemindersConfig(ctx, guildId, {
      targetChannelId: interaction.values[0] ?? null,
      deliverInDm: false,
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'dm') {
    if (!interaction.isButton()) return;
    const config = await getRemindersConfig(ctx, guildId);
    await updateRemindersConfig(ctx, guildId, { allowDm: !config.allowDm });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'mode') {
    if (!interaction.isButton()) return;
    const config = await getRemindersConfig(ctx, guildId);
    await updateRemindersConfig(ctx, guildId, {
      creationMode: config.creationMode === 'weekly' ? 'once' : 'weekly',
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'weekday') {
    if (!interaction.isButton()) return;
    const config = await getRemindersConfig(ctx, guildId);
    const currentIndex = WEEKDAYS.indexOf(config.weeklyDay);
    const nextDay = WEEKDAYS[(currentIndex + 1) % WEEKDAYS.length] ?? 1;
    await updateRemindersConfig(ctx, guildId, { weeklyDay: nextDay });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'dest') {
    if (!interaction.isButton()) return;
    const config = await getRemindersConfig(ctx, guildId);
    if (config.targetKind === 'role') return;
    if (!config.deliverInDm && !config.allowDm) {
      await interaction.reply({
        content: t('modules.reminders.dmDisabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await updateRemindersConfig(ctx, guildId, { deliverInDm: !config.deliverInDm });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'create') {
    if (!interaction.isButton()) return;
    const config = await getRemindersConfig(ctx, guildId);
    if (!config.targetId || (!config.deliverInDm && !config.targetChannelId)) {
      await interaction.reply({
        content: t('modules.reminders.panel.notReady'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (config.deliverInDm && !config.allowDm) {
      await interaction.reply({
        content: t('modules.reminders.dmDisabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'createmodal'))
        .setTitle(t('modules.reminders.panel.createModal'))
        .addComponents(
          ...(config.creationMode === 'weekly'
            ? [
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId('time')
                    .setLabel(t('modules.reminders.panel.timeField'))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(5)
                    .setRequired(true)
                    .setPlaceholder('18:00'),
                ),
              ]
            : [
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId('minutes')
                    .setLabel(t('modules.reminders.panel.minutesField'))
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(6)
                    .setRequired(true)
                    .setPlaceholder('90'),
                ),
              ]),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('text')
              .setLabel(t('modules.reminders.panel.textField'))
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1000)
              .setRequired(true),
          ),
        ),
    );
    return;
  }

  if (action === 'createmodal') {
    if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
    const config = await getRemindersConfig(ctx, guildId);
    const message = interaction.fields.getTextInputValue('text').trim();

    if (
      !config.targetId ||
      (!config.deliverInDm && !config.targetChannelId) ||
      (config.deliverInDm && !config.allowDm)
    ) {
      await interaction.reply({
        content: t('modules.reminders.panel.notReady'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (message.length === 0) {
      await interaction.reply({
        content: t('modules.reminders.emptyText'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let dueAt: Date;
    let durationLabel: string;
    let repeatDay: number | null = null;
    let repeatHour: number | null = null;
    let repeatMinute: number | null = null;

    if (config.creationMode === 'weekly') {
      repeatDay = config.weeklyDay;
      const parsedTime = parseTime(interaction.fields.getTextInputValue('time'));
      if (parsedTime === null) {
        await interaction.reply({
          content: t('modules.reminders.panel.invalidWeekly'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      repeatHour = parsedTime.hour;
      repeatMinute = parsedTime.minute;
      dueAt = nextWeeklyOccurrence(repeatDay, repeatHour, repeatMinute);
      durationLabel = t('modules.reminders.panel.weeklySummary', {
        day: t(`modules.reminders.weekdays.${repeatDay}`),
        time: `${String(repeatHour).padStart(2, '0')}:${String(repeatMinute).padStart(2, '0')}`,
      });
    } else {
      const minutes = Number(interaction.fields.getTextInputValue('minutes'));
      const maxReminderMinutes = config.maxDelayDays * 24 * 60;
      const durationMs = minutes * 60_000;
      if (
        !Number.isInteger(minutes) ||
        durationMs < MIN_REMINDER_MS ||
        minutes > maxReminderMinutes
      ) {
        await interaction.reply({
          content: t('modules.reminders.invalidDuration', { days: config.maxDelayDays }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      dueAt = new Date(Date.now() + durationMs);
      durationLabel = formatDuration(durationMs);
    }

    await createReminder(ctx, {
      guildId,
      channelId: config.deliverInDm ? null : config.targetChannelId,
      targetKind: config.targetKind,
      targetId: config.targetId,
      message,
      dueAt,
      deliverInDm: config.deliverInDm,
      repeatKind: config.creationMode,
      repeatDay,
      repeatHour,
      repeatMinute,
    });

    await interaction.reply({
      content: t('modules.reminders.created', {
        duration: durationLabel,
        time: `<t:${Math.floor(dueAt.getTime() / 1000)}:R>`,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'maxdelay') {
    if (!interaction.isButton()) return;
    const config = await getRemindersConfig(ctx, guildId);
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'maxdelaymodal'))
        .setTitle(t('modules.reminders.panel.maxDelayModal'))
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('days')
              .setLabel(t('modules.reminders.panel.maxDelayField'))
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(3)
              .setRequired(true)
              .setValue(String(config.maxDelayDays))
              .setPlaceholder('30'),
          ),
        ),
    );
    return;
  }

  if (action === 'maxdelaymodal') {
    if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
    const days = Number(interaction.fields.getTextInputValue('days'));
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      await interaction.reply({
        content: t('modules.reminders.panel.invalidMaxDelay'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await updateRemindersConfig(ctx, guildId, { maxDelayDays: days });
    await interaction.update(await renderPage());
  }
}

export const remindersPanel: ConfigPanel = { render, handle };
