import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
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
import {
  MAX_MESSAGES,
  MODULE_NAME,
  type Schedule,
  SCHEDULE_TYPES,
  type ScheduleType,
  type ScheduledMessage,
  type ScheduledmessagesConfig,
  getScheduledmessagesConfig,
  updateScheduledmessagesConfig,
} from './config.js';
import { initialLastPosted, sendNow } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function weekdayLabel(weekday: number): string {
  return t(`modules.scheduledmessages.weekday.${weekday}`);
}

function typeLabel(type: ScheduleType): string {
  return t(`modules.scheduledmessages.type.${type}`);
}

/** Description lisible d'une cadence (utilisée dans les listes et l'aperçu). */
export function describeSchedule(schedule: Schedule): string {
  switch (schedule.type) {
    case 'daily':
      return t('modules.scheduledmessages.describe.daily', { time: schedule.time });
    case 'weekly':
      return t('modules.scheduledmessages.describe.weekly', {
        day: weekdayLabel(schedule.weekday),
        time: schedule.time,
      });
    case 'interval':
      return t('modules.scheduledmessages.describe.interval', { hours: schedule.hours });
    default:
      return '';
  }
}

function messageLine(message: ScheduledMessage): string {
  return `<#${message.channelId}> — ${describeSchedule(message.schedule)}`;
}

/** Reconstruit une cadence en changeant de type, en préservant ce qui peut l'être. */
function changeType(prev: Schedule, type: ScheduleType): Schedule {
  const time = prev.type !== 'interval' ? prev.time : '12:00';
  if (type === 'daily') return { type: 'daily', time };
  if (type === 'weekly') {
    return { type: 'weekly', weekday: prev.type === 'weekly' ? prev.weekday : 1, time };
  }
  return { type: 'interval', hours: prev.type === 'interval' ? prev.hours : 24 };
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getScheduledmessagesConfig(ctx, guildId);

  const list = config.messages.length
    ? config.messages.map(messageLine).join('\n')
    : t('modules.scheduledmessages.panel.noMessages');

  const embed = infoEmbed({
    title: t('modules.scheduledmessages.label'),
    description: t('modules.scheduledmessages.panel.intro'),
  }).addFields({
    name: t('modules.scheduledmessages.panel.listField', { count: config.messages.length }),
    value: list.slice(0, 1024),
  });

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add'))
        .setPlaceholder(t('modules.scheduledmessages.panel.addPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1)
        .setDisabled(config.messages.length >= MAX_MESSAGES),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
        .setLabel(t('modules.scheduledmessages.panel.manage'))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(config.messages.length === 0),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages -------------------------------------------------------------

function renderList(config: ScheduledmessagesConfig): {
  embeds: EmbedBuilder[];
  components: PanelRow[];
} {
  const embed = infoEmbed({
    title: t('modules.scheduledmessages.panel.listTitle'),
    description: t('modules.scheduledmessages.panel.listIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
    .setPlaceholder(t('modules.scheduledmessages.panel.pickPlaceholder'))
    .addOptions(
      config.messages.map((message) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(describeSchedule(message.schedule).slice(0, 100))
          .setValue(message.id)
          .setDescription(message.content.slice(0, 100)),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.scheduledmessages.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderEdit(message: ScheduledMessage): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.scheduledmessages.panel.editTitle'),
    description: t('modules.scheduledmessages.panel.editIntro'),
  }).addFields(
    {
      name: t('modules.scheduledmessages.panel.channelField'),
      value: `<#${message.channelId}>`,
      inline: true,
    },
    {
      name: t('modules.scheduledmessages.panel.scheduleField'),
      value: describeSchedule(message.schedule),
      inline: true,
    },
    {
      name: t('modules.scheduledmessages.panel.embedField'),
      value: message.asEmbed
        ? t('modules.scheduledmessages.panel.on')
        : t('modules.scheduledmessages.panel.off'),
      inline: true,
    },
    {
      name: t('modules.scheduledmessages.panel.contentField'),
      value: message.content.slice(0, 1024),
    },
  );

  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'cadence', message.id))
    .setPlaceholder(t('modules.scheduledmessages.panel.cadencePlaceholder'))
    .addOptions(
      SCHEDULE_TYPES.map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(typeLabel(type))
          .setValue(type)
          .setDefault(type === message.schedule.type),
      ),
    );

  const components: PanelRow[] = [row().addComponents(typeSelect)];

  if (message.schedule.type === 'weekly') {
    const weekday = message.schedule.weekday;
    const daySelect = new StringSelectMenuBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'weekday', message.id))
      .setPlaceholder(t('modules.scheduledmessages.panel.weekdayPlaceholder'))
      .addOptions(
        [0, 1, 2, 3, 4, 5, 6].map((day) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(weekdayLabel(day))
            .setValue(String(day))
            .setDefault(day === weekday),
        ),
      );
    components.push(row().addComponents(daySelect));
  }

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'chan', message.id))
    .setPlaceholder(t('modules.scheduledmessages.panel.channelPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1)
    .setDefaultChannels([message.channelId]);
  components.push(row().addComponents(channelSelect));

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'content', message.id))
        .setLabel(t('modules.scheduledmessages.panel.editContent'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'time', message.id))
        .setLabel(t('modules.scheduledmessages.panel.editTime'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'embed', message.id))
        .setLabel(t('modules.scheduledmessages.panel.toggleEmbed'))
        .setStyle(message.asEmbed ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'sendnow', message.id))
        .setLabel(t('modules.scheduledmessages.panel.sendNow'))
        .setStyle(ButtonStyle.Secondary),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'remove', message.id))
        .setLabel(t('modules.scheduledmessages.panel.delete'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
        .setLabel(t('modules.scheduledmessages.panel.back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

function contentModal(message: ScheduledMessage): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'contentmodal', message.id))
    .setTitle(t('modules.scheduledmessages.panel.contentTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('content')
          .setLabel(t('modules.scheduledmessages.panel.contentInput'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
          .setValue(message.content),
      ),
    );
}

function timeModal(message: ScheduledMessage): ModalBuilder {
  const schedule = message.schedule;
  const isInterval = schedule.type === 'interval';
  const value = schedule.type === 'interval' ? String(schedule.hours) : schedule.time;
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'timemodal', message.id))
    .setTitle(t('modules.scheduledmessages.panel.timeTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel(
            isInterval
              ? t('modules.scheduledmessages.panel.hoursInput')
              : t('modules.scheduledmessages.panel.timeInput'),
          )
          .setStyle(TextInputStyle.Short)
          .setMaxLength(5)
          .setRequired(true)
          .setValue(value),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

function patchMessage(
  config: ScheduledmessagesConfig,
  id: string,
  patch: Partial<ScheduledMessage>,
): ScheduledMessage[] {
  return config.messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
}

function find(
  config: ScheduledmessagesConfig,
  id: string | undefined,
): ScheduledMessage | undefined {
  return config.messages.find((message) => message.id === id);
}

async function handle({ interaction, ctx, guildId, action, params, renderPage }: PanelHandlerArgs) {
  const guild = interaction.inCachedGuild() ? interaction.guild : null;

  switch (action) {
    case 'add': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      const config = await getScheduledmessagesConfig(ctx, guildId);
      if (!channelId || config.messages.length >= MAX_MESSAGES) {
        await interaction.update(await renderPage());
        return;
      }
      const schedule: Schedule = { type: 'daily', time: '12:00' };
      const message: ScheduledMessage = {
        id: randomUUID().slice(0, 8),
        channelId,
        content: t('modules.scheduledmessages.panel.defaultContent'),
        asEmbed: false,
        schedule,
        lastPosted: initialLastPosted(schedule),
      };
      await updateScheduledmessagesConfig(ctx, guildId, {
        messages: [...config.messages, message],
      });
      await interaction.update(renderEdit(message));
      return;
    }
    case 'manage': {
      if (!interaction.isButton()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      if (config.messages.length === 0) {
        await interaction.update(await renderPage());
        return;
      }
      await interaction.update(renderList(config));
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'pick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const message = find(config, interaction.values[0]);
      await interaction.update(message ? renderEdit(message) : renderList(config));
      return;
    }
    case 'cadence': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const current = find(config, params[0]);
      if (!current) {
        await interaction.update(renderList(config));
        return;
      }
      const schedule = changeType(current.schedule, interaction.values[0] as ScheduleType);
      const messages = patchMessage(config, params[0] ?? '', {
        schedule,
        lastPosted: initialLastPosted(schedule),
      });
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      await interaction.update(renderEdit({ ...current, schedule }));
      return;
    }
    case 'weekday': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const current = find(config, params[0]);
      if (!current || current.schedule.type !== 'weekly') {
        await interaction.update(renderList(config));
        return;
      }
      const schedule: Schedule = {
        type: 'weekly',
        weekday: Number.parseInt(interaction.values[0] ?? '1', 10),
        time: current.schedule.time,
      };
      const messages = patchMessage(config, params[0] ?? '', { schedule });
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      await interaction.update(renderEdit({ ...current, schedule }));
      return;
    }
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const channelId = interaction.values[0];
      if (!channelId) {
        await interaction.update(renderList(config));
        return;
      }
      const messages = patchMessage(config, params[0] ?? '', { channelId });
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      const message = find({ ...config, messages }, params[0]);
      await interaction.update(message ? renderEdit(message) : renderList({ ...config, messages }));
      return;
    }
    case 'content': {
      if (!interaction.isButton()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const message = find(config, params[0]);
      if (!message) {
        await interaction.update(renderList(config));
        return;
      }
      await interaction.showModal(contentModal(message));
      return;
    }
    case 'contentmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const content = interaction.fields.getTextInputValue('content').trim().slice(0, 2000) || ' ';
      const messages = patchMessage(config, params[0] ?? '', { content });
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      const message = find({ ...config, messages }, params[0]);
      await interaction.update(message ? renderEdit(message) : renderList({ ...config, messages }));
      return;
    }
    case 'time': {
      if (!interaction.isButton()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const message = find(config, params[0]);
      if (!message) {
        await interaction.update(renderList(config));
        return;
      }
      await interaction.showModal(timeModal(message));
      return;
    }
    case 'timemodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const current = find(config, params[0]);
      if (!current) {
        await interaction.update(renderList(config));
        return;
      }
      const raw = interaction.fields.getTextInputValue('value').trim();
      let schedule = current.schedule;
      if (current.schedule.type === 'interval') {
        const hours = Number.parseInt(raw, 10);
        schedule = {
          type: 'interval',
          hours: Number.isFinite(hours) ? Math.min(Math.max(hours, 1), 168) : 24,
        };
      } else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
        schedule = { ...current.schedule, time: raw };
      }
      const messages = patchMessage(config, params[0] ?? '', {
        schedule,
        lastPosted: initialLastPosted(schedule),
      });
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      await interaction.update(renderEdit({ ...current, schedule }));
      return;
    }
    case 'embed': {
      if (!interaction.isButton()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const current = find(config, params[0]);
      if (!current) {
        await interaction.update(renderList(config));
        return;
      }
      const messages = patchMessage(config, params[0] ?? '', { asEmbed: !current.asEmbed });
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      const message = find({ ...config, messages }, params[0]);
      await interaction.update(message ? renderEdit(message) : renderList({ ...config, messages }));
      return;
    }
    case 'sendnow': {
      if (!interaction.isButton()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const message = find(config, params[0]);
      if (!message || !guild) {
        await interaction.reply({
          content: t('modules.scheduledmessages.panel.sendFailed'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const ok = await sendNow(ctx, guild, message);
      await interaction.reply({
        content: ok
          ? t('modules.scheduledmessages.panel.sendOk')
          : t('modules.scheduledmessages.panel.sendFailed'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case 'remove': {
      if (!interaction.isButton()) return;
      const config = await getScheduledmessagesConfig(ctx, guildId);
      const messages = config.messages.filter((message) => message.id !== params[0]);
      await updateScheduledmessagesConfig(ctx, guildId, { messages });
      await interaction.update(
        messages.length ? renderList({ ...config, messages }) : await renderPage(),
      );
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Messages récurrents ». */
export const scheduledmessagesPanel: ConfigPanel = { render, handle };
