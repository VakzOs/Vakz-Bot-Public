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
import { resolveEmojiInput } from '../../lib/emoji.js';
import {
  BUTTON_STYLES,
  type ButtonStyleName,
  type InteractiveButton,
  type InteractiveMessagesConfig,
  type InteractivePanel,
  MODULE_NAME,
  getInteractiveMessagesConfig,
  updateInteractiveMessagesConfig,
} from './config.js';
import { isValidHttpUrl, publishPanel } from './service.js';

const MAX_PANELS = 25;
const MAX_BUTTONS = 25;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function d(key: string, vars?: Record<string, string | number>): string {
  return t(`modules.interactivemessages.panel.${key}`, vars);
}

function findPanel(config: InteractiveMessagesConfig, id: string): InteractivePanel | undefined {
  return config.panels.find((panel) => panel.id === id);
}

function patchPanels(
  config: InteractiveMessagesConfig,
  id: string,
  patch: Partial<InteractivePanel>,
): InteractivePanel[] {
  return config.panels.map((panel) => (panel.id === id ? { ...panel, ...patch } : panel));
}

function colorToHex(color: number | null): string {
  return color === null ? d('colorDefault') : `#${color.toString(16).padStart(6, '0')}`;
}

function parseColor(input: string): number | null {
  const value = input.trim().replace(/^#/, '');
  if (!value) return null;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return Number.parseInt(value, 16);
}

function buttonSummary(panel: InteractivePanel): string {
  if (!panel.buttons.length) return d('noButtons');
  return panel.buttons
    .map((button) => {
      const emoji = button.emoji ? `${button.emoji} ` : '';
      const target =
        button.type === 'role'
          ? button.roleId
            ? `<@&${button.roleId}>`
            : d('roleMissing')
          : (button.url ?? '');
      const kind = button.type === 'role' ? d('kindRole') : d('kindLink');
      return `• ${emoji}**${button.label}** — ${kind} → ${target}`;
    })
    .join('\n');
}

// --- Page principale (liste) ------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getInteractiveMessagesConfig(ctx, guildId);

  const list = config.panels.length
    ? config.panels
        .map((panel) => {
          const channel = panel.channelId ? `<#${panel.channelId}>` : d('notSet');
          const status = panel.messageId ? d('published') : d('notPublished');
          return `• **${panel.name}** — ${channel} · ${status} · ${d('buttonCount', {
            count: panel.buttons.length,
          })}`;
        })
        .join('\n')
    : d('noPanels');

  const embed = infoEmbed({
    title: t('modules.interactivemessages.label'),
    description: d('intro'),
  }).addFields({ name: d('panelsField'), value: list });

  const components: PanelRow[] = [];
  if (config.panels.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
          .setPlaceholder(d('pickPlaceholder'))
          .addOptions(
            config.panels.slice(0, 25).map((panel) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(panel.name.slice(0, 100))
                .setValue(panel.id)
                .setDescription((panel.title || panel.description || d('noContent')).slice(0, 100)),
            ),
          ),
      ),
    );
  }
  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'create'))
        .setLabel(d('createButton'))
        .setEmoji('➕')
        .setStyle(ButtonStyle.Success),
    ),
  );

  return { embed, components };
}

// --- Sous-page : édition d'un panneau ---------------------------------------

function renderPanelEdit(panel: InteractivePanel): {
  embeds: EmbedBuilder[];
  components: PanelRow[];
} {
  const embed = infoEmbed({
    title: d('editTitle', { name: panel.name }),
    description: d('editIntro'),
  }).addFields(
    {
      name: d('channelField'),
      value: panel.channelId ? `<#${panel.channelId}>` : d('notSet'),
      inline: true,
    },
    {
      name: d('statusField'),
      value: panel.messageId ? d('published') : d('notPublished'),
      inline: true,
    },
    { name: d('colorField'), value: colorToHex(panel.color), inline: true },
    {
      name: d('contentField'),
      value: (panel.title ? `**${panel.title}**\n` : '') + (panel.description || d('noContent')),
    },
    { name: d('buttonsField'), value: buttonSummary(panel) },
  );

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'chan', panel.id))
        .setPlaceholder(d('channelPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    row().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'addrole', panel.id))
        .setPlaceholder(d('addRolePlaceholder'))
        .setMinValues(0)
        .setMaxValues(10),
    ),
  ];

  if (panel.buttons.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'btnpick', panel.id))
          .setPlaceholder(d('buttonPickPlaceholder'))
          .addOptions(
            panel.buttons.slice(0, 25).map((button) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(button.label.slice(0, 100))
                .setValue(button.id)
                .setDescription(
                  (button.type === 'role' ? d('kindRole') : d('kindLink')).slice(0, 100),
                ),
            ),
          ),
      ),
    );
  }

  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'content', panel.id))
        .setLabel(d('editContent'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'addlink', panel.id))
        .setLabel(d('addLink'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'publish', panel.id))
        .setLabel(d('publish'))
        .setStyle(ButtonStyle.Success),
    ),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'delete', panel.id))
        .setLabel(d('deletePanel'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'home'))
        .setLabel(d('back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

// --- Sous-page : édition d'un bouton ----------------------------------------

function renderButtonEdit(
  panel: InteractivePanel,
  button: InteractiveButton,
): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const target =
    button.type === 'role'
      ? button.roleId
        ? `<@&${button.roleId}>`
        : d('roleMissing')
      : (button.url ?? d('notSet'));

  const embed = infoEmbed({
    title: d('buttonEditTitle', { label: button.label }),
    description: d('buttonEditIntro'),
  }).addFields(
    {
      name: d('kindField'),
      value: button.type === 'role' ? d('kindRole') : d('kindLink'),
      inline: true,
    },
    { name: d('targetField'), value: target, inline: true },
    { name: d('emojiField'), value: button.emoji || d('notSet'), inline: true },
  );

  const components: PanelRow[] = [];
  if (button.type === 'role') {
    embed.addFields({ name: d('styleField'), value: d(`style_${button.style}`), inline: true });
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'style', panel.id, button.id))
          .setPlaceholder(d('stylePlaceholder'))
          .addOptions(
            BUTTON_STYLES.map((style) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(d(`style_${style}`))
                .setValue(style)
                .setDefault(style === button.style),
            ),
          ),
      ),
    );
  }
  components.push(
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'btnmod', panel.id, button.id))
        .setLabel(d('editButton'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'btndel', panel.id, button.id))
        .setLabel(d('deleteButton'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'backpanel', panel.id))
        .setLabel(d('back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

// --- Modals -----------------------------------------------------------------

function textRow(
  id: string,
  label: string,
  style: TextInputStyle,
  opts: Partial<{ value: string; max: number; required: boolean; placeholder: string }> = {},
): ActionRowBuilder<TextInputBuilder> {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (opts.value) field.setValue(opts.value);
  if (opts.max) field.setMaxLength(opts.max);
  field.setRequired(opts.required ?? false);
  if (opts.placeholder) field.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

function createModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'createmodal'))
    .setTitle(d('createTitle'))
    .addComponents(
      textRow('name', d('nameField'), TextInputStyle.Short, { max: 100, required: true }),
      textRow('title', d('titleField'), TextInputStyle.Short, { max: 256 }),
      textRow('description', d('descriptionField'), TextInputStyle.Paragraph, { max: 2000 }),
    );
}

function contentModal(panel: InteractivePanel): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'contentmodal', panel.id))
    .setTitle(d('contentTitle'))
    .addComponents(
      textRow('title', d('titleField'), TextInputStyle.Short, { max: 256, value: panel.title }),
      textRow('description', d('descriptionField'), TextInputStyle.Paragraph, {
        max: 2000,
        value: panel.description,
      }),
      textRow('color', d('colorInputField'), TextInputStyle.Short, {
        max: 7,
        value: panel.color !== null ? colorToHex(panel.color) : '',
        placeholder: '#5865f2',
      }),
    );
}

function linkModal(panelId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'linkmodal', panelId))
    .setTitle(d('linkTitle'))
    .addComponents(
      textRow('label', d('labelField'), TextInputStyle.Short, { max: 80, required: true }),
      textRow('url', d('urlField'), TextInputStyle.Short, {
        max: 512,
        required: true,
        placeholder: 'https://…',
      }),
      textRow('emoji', d('emojiInputField'), TextInputStyle.Short, {
        max: 64,
        placeholder: '😀 ou :nom:',
      }),
    );
}

function buttonModal(button: InteractiveButton): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'btnmodmodal', button.id))
    .setTitle(d('buttonModalTitle'))
    .addComponents(
      textRow('label', d('labelField'), TextInputStyle.Short, {
        max: 80,
        required: true,
        value: button.label,
      }),
      textRow('emoji', d('emojiInputField'), TextInputStyle.Short, {
        max: 64,
        value: button.emoji,
        placeholder: '😀 ou :nom:',
      }),
    );
  if (button.type === 'link') {
    modal.addComponents(
      textRow('url', d('urlField'), TextInputStyle.Short, {
        max: 512,
        required: true,
        value: button.url ?? '',
        placeholder: 'https://…',
      }),
    );
  }
  return modal;
}

// --- Routeur ----------------------------------------------------------------

/** Recompose la sous-vue d'un panneau depuis la config à jour (ou la liste). */
async function updatePanelView(
  interaction: PanelHandlerArgs['interaction'],
  ctx: BotContext,
  guildId: string,
  panelId: string,
  renderPage: PanelHandlerArgs['renderPage'],
): Promise<void> {
  const config = await getInteractiveMessagesConfig(ctx, guildId);
  const panel = findPanel(config, panelId);
  const view = panel ? renderPanelEdit(panel) : await renderPage();
  if (interaction.isMessageComponent()) {
    await interaction.update(view);
  } else if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(view);
  }
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  params,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  const panelId = params[0] ?? '';

  switch (action) {
    case 'create': {
      if (!interaction.isButton()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      if (config.panels.length >= MAX_PANELS) {
        await interaction.reply({
          content: d('tooManyPanels', { max: MAX_PANELS }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(createModal());
      return;
    }
    case 'createmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel: InteractivePanel = {
        id: randomUUID().slice(0, 8),
        name: interaction.fields.getTextInputValue('name').trim().slice(0, 100) || d('untitled'),
        channelId: null,
        messageId: null,
        title: interaction.fields.getTextInputValue('title').trim().slice(0, 256),
        description: interaction.fields.getTextInputValue('description').trim().slice(0, 2000),
        color: null,
        buttons: [],
      };
      await updateInteractiveMessagesConfig(ctx, guildId, { panels: [...config.panels, panel] });
      await interaction.update(renderPanelEdit(panel));
      return;
    }
    case 'pick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, interaction.values[0] ?? '');
      await interaction.update(panel ? renderPanelEdit(panel) : await renderPage());
      return;
    }
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panels = patchPanels(config, panelId, { channelId: interaction.values[0] ?? null });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'content': {
      if (!interaction.isButton()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel) return;
      await interaction.showModal(contentModal(panel));
      return;
    }
    case 'contentmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panels = patchPanels(config, panelId, {
        title: interaction.fields.getTextInputValue('title').trim().slice(0, 256),
        description: interaction.fields.getTextInputValue('description').trim().slice(0, 2000),
        color: parseColor(interaction.fields.getTextInputValue('color')),
      });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'addrole': {
      if (!interaction.isRoleSelectMenu() || !interaction.inCachedGuild()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel) return;
      const existingRoleIds = new Set(
        panel.buttons.filter((b) => b.type === 'role').map((b) => b.roleId),
      );
      const additions: InteractiveButton[] = [];
      for (const roleId of interaction.values) {
        if (existingRoleIds.has(roleId)) continue;
        if (panel.buttons.length + additions.length >= MAX_BUTTONS) break;
        const roleName = interaction.guild.roles.cache.get(roleId)?.name ?? roleId;
        additions.push({
          id: randomUUID().slice(0, 8),
          type: 'role',
          label: roleName.slice(0, 80),
          emoji: '',
          roleId,
          url: null,
          style: 'secondary',
        });
      }
      if (additions.length) {
        const panels = patchPanels(config, panelId, {
          buttons: [...panel.buttons, ...additions],
        });
        await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      }
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'addlink': {
      if (!interaction.isButton()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel) return;
      if (panel.buttons.length >= MAX_BUTTONS) {
        await interaction.reply({
          content: d('tooManyButtons', { max: MAX_BUTTONS }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(linkModal(panel.id));
      return;
    }
    case 'linkmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const url = interaction.fields.getTextInputValue('url').trim();
      if (!isValidHttpUrl(url)) {
        await interaction.reply({ content: d('badUrl'), flags: MessageFlags.Ephemeral });
        return;
      }
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel) {
        await interaction.reply({ content: d('panelGone'), flags: MessageFlags.Ephemeral });
        return;
      }
      const emojiInput = interaction.fields.getTextInputValue('emoji');
      const button: InteractiveButton = {
        id: randomUUID().slice(0, 8),
        type: 'link',
        label:
          interaction.fields.getTextInputValue('label').trim().slice(0, 80) || url.slice(0, 80),
        emoji: interaction.inCachedGuild()
          ? resolveEmojiInput(emojiInput, interaction.guild)
          : emojiInput.trim(),
        roleId: null,
        url: url.slice(0, 512),
        style: 'secondary',
      };
      const panels = patchPanels(config, panelId, { buttons: [...panel.buttons, button] });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'btnpick': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      const button = panel?.buttons.find((b) => b.id === interaction.values[0]);
      await interaction.update(
        panel && button ? renderButtonEdit(panel, button) : await renderPage(),
      );
      return;
    }
    case 'backpanel': {
      if (!interaction.isButton()) return;
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'style': {
      if (!interaction.isStringSelectMenu()) return;
      const buttonId = params[1] ?? '';
      const style = interaction.values[0] as ButtonStyleName | undefined;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel || !style || !BUTTON_STYLES.includes(style)) return;
      const buttons = panel.buttons.map((b) => (b.id === buttonId ? { ...b, style } : b));
      const panels = patchPanels(config, panelId, { buttons });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      const updated = findPanel({ ...config, panels }, panelId);
      const button = updated?.buttons.find((b) => b.id === buttonId);
      await interaction.update(
        updated && button ? renderButtonEdit(updated, button) : await renderPage(),
      );
      return;
    }
    case 'btnmod': {
      if (!interaction.isButton()) return;
      const buttonId = params[1] ?? '';
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const button = findPanel(config, panelId)?.buttons.find((b) => b.id === buttonId);
      if (!button) return;
      await interaction.showModal(buttonModal(button));
      return;
    }
    case 'btnmodmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const buttonId = params[0] ?? '';
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = config.panels.find((p) => p.buttons.some((b) => b.id === buttonId));
      if (!panel) return;
      const emojiInput = interaction.fields.getTextInputValue('emoji');
      const emoji = interaction.inCachedGuild()
        ? resolveEmojiInput(emojiInput, interaction.guild)
        : emojiInput.trim();
      const buttons = panel.buttons.map((b) => {
        if (b.id !== buttonId) return b;
        const label = interaction.fields.getTextInputValue('label').trim().slice(0, 80) || b.label;
        if (b.type === 'link') {
          const url = interaction.fields.getTextInputValue('url').trim();
          return { ...b, label, emoji, url: isValidHttpUrl(url) ? url.slice(0, 512) : b.url };
        }
        return { ...b, label, emoji };
      });
      const panels = patchPanels(config, panel.id, { buttons });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      const updated = findPanel({ ...config, panels }, panel.id);
      const button = updated?.buttons.find((b) => b.id === buttonId);
      await interaction.update(
        updated && button ? renderButtonEdit(updated, button) : await renderPage(),
      );
      return;
    }
    case 'btndel': {
      if (!interaction.isButton()) return;
      const buttonId = params[1] ?? '';
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel) return;
      const panels = patchPanels(config, panelId, {
        buttons: panel.buttons.filter((b) => b.id !== buttonId),
      });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'publish': {
      if (!interaction.isButton() || !interaction.inCachedGuild()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      const panel = findPanel(config, panelId);
      if (!panel) return;
      const result = await publishPanel(interaction.guild, panel, ctx.logger);
      if (!result.ok) {
        await interaction.reply({
          content: d(`publishError.${result.error}`),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const panels = patchPanels(config, panelId, { messageId: result.messageId });
      await updateInteractiveMessagesConfig(ctx, guildId, { panels });
      await updatePanelView(interaction, ctx, guildId, panelId, renderPage);
      return;
    }
    case 'delete': {
      if (!interaction.isButton()) return;
      const config = await getInteractiveMessagesConfig(ctx, guildId);
      await updateInteractiveMessagesConfig(ctx, guildId, {
        panels: config.panels.filter((panel) => panel.id !== panelId),
      });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Messages interactifs ». */
export const interactiveMessagesPanel: ConfigPanel = { render, handle };
