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
import type { AutomodAction, AutomodConfig } from './config.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getAutomodConfig, updateAutomodConfig } from './config.js';
import { createHoneypotChannel, syncHoneypotMessage } from './service.js';

const TOGGLE_RULES = ['spam', 'invites', 'links', 'badWords', 'mentions', 'caps'] as const;
type ToggleRule = (typeof TOGGLE_RULES)[number];
const ACTIONS: AutomodAction[] = ['delete', 'warn', 'timeout', 'kick', 'ban'];

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function enabled(value: boolean): string {
  return value ? t('modules.automod.panel.on') : t('modules.automod.panel.off');
}

function ruleLine(config: AutomodConfig, rule: ToggleRule): string {
  return t('modules.automod.panel.ruleLine', {
    rule: t(`modules.automod.rules.${rule}`),
    status: enabled(config[rule].enabled),
    action: t(`modules.automod.actions.${config[rule].action}`),
  });
}

function ruleButton(config: AutomodConfig, rule: ToggleRule): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'toggle', rule))
    .setLabel(t(`modules.automod.rules.${rule}`))
    .setStyle(config[rule].enabled ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function settingsModal(config: AutomodConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'settingsmodal'))
    .setTitle(t('modules.automod.panel.settingsTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('badWords')
          .setLabel(t('modules.automod.panel.badWordsField'))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue(config.badWords.words.join(', ')),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('allowlist')
          .setLabel(t('modules.automod.panel.allowlistField'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(config.links.allowlist.join(', ')),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('spam')
          .setLabel(t('modules.automod.panel.spamField'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20)
          .setValue(`${config.spam.maxMessages}/${config.spam.windowSeconds}`),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('limits')
          .setLabel(t('modules.automod.panel.limitsField'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
          .setValue(
            `${config.mentions.maxMentions}/${config.caps.minLength}/${config.caps.percent}`,
          ),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('timeouts')
          .setLabel(t('modules.automod.panel.timeoutsField'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
          .setValue(
            `${config.spam.timeoutMinutes}/${config.badWords.timeoutMinutes}/${config.mentions.timeoutMinutes}`,
          ),
      ),
    );
}

function actionModal(config: AutomodConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'actionsmodal'))
    .setTitle(t('modules.automod.panel.actionsTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('actions')
          .setLabel(t('modules.automod.panel.actionsField'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setValue(
            `${config.spam.action}/${config.invites.action}/${config.links.action}/${config.badWords.action}/${config.mentions.action}/${config.caps.action}`,
          ),
      ),
    );
}

function parseAction(value: string | undefined, fallback: AutomodAction): AutomodAction {
  return ACTIONS.includes(value as AutomodAction) ? (value as AutomodAction) : fallback;
}
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parsePair(value: string, fallbackA: number, fallbackB: number): [number, number] {
  const [rawA, rawB] = value.split(/[/;,\s]+/).filter(Boolean);
  const a = Number(rawA);
  const b = Number(rawB);
  return [Number.isFinite(a) ? a : fallbackA, Number.isFinite(b) ? b : fallbackB];
}

function parseTriple(
  value: string,
  fallbackA: number,
  fallbackB: number,
  fallbackC: number,
): [number, number, number] {
  const [rawA, rawB, rawC] = value.split(/[/;,\s]+/).filter(Boolean);
  const a = Number(rawA);
  const b = Number(rawB);
  const c = Number(rawC);
  return [
    Number.isFinite(a) ? a : fallbackA,
    Number.isFinite(b) ? b : fallbackB,
    Number.isFinite(c) ? c : fallbackC,
  ];
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getAutomodConfig(ctx, guildId);
  const embed = infoEmbed({
    title: t('modules.automod.label'),
    description: t('modules.automod.panel.intro'),
  }).addFields(
    {
      name: t('modules.automod.panel.logChannel'),
      value: config.logChannelId ? `<#${config.logChannelId}>` : t('modules.automod.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.automod.panel.honeypotChannel'),
      value: config.honeypot.channelId
        ? `<#${config.honeypot.channelId}>`
        : t('modules.automod.panel.notSet'),
      inline: true,
    },
    {
      name: t('modules.automod.panel.rulesField'),
      value: TOGGLE_RULES.map((rule) => ruleLine(config, rule)).join('\n'),
    },
    {
      name: t('modules.automod.rules.honeypot'),
      value: t('modules.automod.panel.honeypotLine', {
        status: enabled(config.honeypot.enabled),
        message: config.honeypot.messageId
          ? t('modules.automod.panel.published')
          : t('modules.automod.panel.notPublished'),
      }),
    },
  );

  return {
    embed,
    components: [
      row().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'logchan'))
          .setPlaceholder(t('modules.automod.panel.logPlaceholder'))
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(0)
          .setMaxValues(1),
      ),
      row().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'hpchan'))
          .setPlaceholder(t('modules.automod.panel.honeypotPlaceholder'))
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1),
      ),
      row().addComponents(
        ruleButton(config, 'spam'),
        ruleButton(config, 'invites'),
        ruleButton(config, 'links'),
        ruleButton(config, 'badWords'),
        ruleButton(config, 'mentions'),
      ),
      row().addComponents(
        ruleButton(config, 'caps'),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'togglehp'))
          .setLabel(t('modules.automod.rules.honeypot'))
          .setStyle(config.honeypot.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'settings'))
          .setLabel(t('modules.automod.panel.settings'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'actions'))
          .setLabel(t('modules.automod.panel.actions'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'setupphp'))
          .setLabel(t('modules.automod.panel.setupHoneypot'))
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

async function handle({ interaction, ctx, guildId, action, params, renderPage }: PanelHandlerArgs) {
  if (action === 'logchan') {
    if (!interaction.isChannelSelectMenu()) return;
    await updateAutomodConfig(ctx, guildId, { logChannelId: interaction.values[0] ?? null });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'hpchan') {
    if (!interaction.isChannelSelectMenu()) return;
    const config = await getAutomodConfig(ctx, guildId);
    await updateAutomodConfig(ctx, guildId, {
      honeypot: { ...config.honeypot, channelId: interaction.values[0] ?? null, messageId: null },
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'toggle') {
    if (!interaction.isButton()) return;
    const rule = params[0] as ToggleRule | undefined;
    if (!rule || !TOGGLE_RULES.includes(rule)) return;
    const config = await getAutomodConfig(ctx, guildId);
    await updateAutomodConfig(ctx, guildId, {
      [rule]: { ...config[rule], enabled: !config[rule].enabled },
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'togglehp') {
    if (!interaction.isButton()) return;
    const config = await getAutomodConfig(ctx, guildId);
    await updateAutomodConfig(ctx, guildId, {
      honeypot: { ...config.honeypot, enabled: !config.honeypot.enabled },
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'actions') {
    if (!interaction.isButton()) return;
    const config = await getAutomodConfig(ctx, guildId);
    await interaction.showModal(actionModal(config));
    return;
  }

  if (action === 'actionsmodal') {
    if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
    const config = await getAutomodConfig(ctx, guildId);
    const [spam, invites, links, badWords, mentions, caps] = interaction.fields
      .getTextInputValue('actions')
      .split(/[/;,\s]+/)
      .map((item) => item.trim() as AutomodAction);

    await updateAutomodConfig(ctx, guildId, {
      spam: { ...config.spam, action: parseAction(spam, config.spam.action) },
      invites: { ...config.invites, action: parseAction(invites, config.invites.action) },
      links: { ...config.links, action: parseAction(links, config.links.action) },
      badWords: { ...config.badWords, action: parseAction(badWords, config.badWords.action) },
      mentions: { ...config.mentions, action: parseAction(mentions, config.mentions.action) },
      caps: { ...config.caps, action: parseAction(caps, config.caps.action) },
    });
    await interaction.update(await renderPage());
    return;
  }
  if (action === 'settings') {
    if (!interaction.isButton()) return;
    const config = await getAutomodConfig(ctx, guildId);
    await interaction.showModal(settingsModal(config));
    return;
  }

  if (action === 'settingsmodal') {
    if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
    const config = await getAutomodConfig(ctx, guildId);
    const [maxMessages, windowSeconds] = parsePair(
      interaction.fields.getTextInputValue('spam'),
      config.spam.maxMessages,
      config.spam.windowSeconds,
    );
    const [maxMentions, capsMinLength, capsPercent] = parseTriple(
      interaction.fields.getTextInputValue('limits'),
      config.mentions.maxMentions,
      config.caps.minLength,
      config.caps.percent,
    );
    const [spamTimeout, badTimeout, mentionTimeout] = parseTriple(
      interaction.fields.getTextInputValue('timeouts'),
      config.spam.timeoutMinutes,
      config.badWords.timeoutMinutes,
      config.mentions.timeoutMinutes,
    );

    await updateAutomodConfig(ctx, guildId, {
      spam: {
        ...config.spam,
        maxMessages: clamp(maxMessages, 2, 20),
        windowSeconds: clamp(windowSeconds, 3, 60),
        timeoutMinutes: clamp(spamTimeout, 1, 40320),
      },
      links: {
        ...config.links,
        allowlist: parseList(interaction.fields.getTextInputValue('allowlist')),
      },
      badWords: {
        ...config.badWords,
        words: parseList(interaction.fields.getTextInputValue('badWords')),
        timeoutMinutes: clamp(badTimeout, 1, 40320),
      },
      mentions: {
        ...config.mentions,
        maxMentions: clamp(maxMentions, 3, 50),
        timeoutMinutes: clamp(mentionTimeout, 1, 40320),
      },
      caps: {
        ...config.caps,
        minLength: clamp(capsMinLength, 8, 300),
        percent: clamp(capsPercent, 50, 100),
      },
    });
    await interaction.update(await renderPage());
    return;
  }

  if (action === 'setupphp') {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    const config = await getAutomodConfig(ctx, guildId);
    let channelId = config.honeypot.channelId;

    if (!channelId) {
      const channel = await createHoneypotChannel(interaction.guild);
      if (!channel) {
        await interaction.reply({
          content: t('modules.automod.panel.createFailed'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      channelId = channel.id;
    }

    const updated = await updateAutomodConfig(ctx, guildId, {
      honeypot: { ...config.honeypot, enabled: true, channelId, messageId: null },
    });
    const messageId = await syncHoneypotMessage(ctx, interaction.guild, updated);
    if (!messageId) {
      await interaction.reply({
        content: t('modules.automod.panel.publishFailed'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await updateAutomodConfig(ctx, guildId, { honeypot: { ...updated.honeypot, messageId } });
    await interaction.update(await renderPage());
  }
}

export const automodPanel: ConfigPanel = { render, handle };
