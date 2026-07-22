import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
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
  type StickyMessage,
  type StickymessagesConfig,
  findSticky,
  getStickymessagesConfig,
  removeSticky,
  upsertSticky,
} from './config.js';
import { cancelRepost, repostSticky } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function preview(content: string, max = 80): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// --- Page principale --------------------------------------------------------

function render(config: StickymessagesConfig): { embed: EmbedBuilder; components: PanelRow[] } {
  const list = config.stickies.length
    ? config.stickies
        .map(
          (sticky) =>
            `<#${sticky.channelId}> — ${sticky.embed ? '🖼️' : '📝'} ${preview(sticky.content)}`,
        )
        .join('\n')
    : t('modules.stickymessages.panel.noSticky');

  const embed = infoEmbed({
    title: t('modules.stickymessages.label'),
    description: t('modules.stickymessages.panel.intro'),
  }).addFields({ name: t('modules.stickymessages.panel.listField'), value: list.slice(0, 1024) });

  const components: PanelRow[] = [
    row().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
        .setPlaceholder(t('modules.stickymessages.panel.pickPlaceholder'))
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];
  return { embed, components };
}

// --- Sous-page : édition d'un salon -----------------------------------------

function renderEdit(
  channelId: string,
  sticky: StickyMessage | undefined,
): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.stickymessages.panel.editTitle'),
    description: t('modules.stickymessages.panel.editIntro', { channel: `<#${channelId}>` }),
  }).addFields(
    {
      name: t('modules.stickymessages.panel.contentField'),
      value: sticky?.content
        ? preview(sticky.content, 300)
        : t('modules.stickymessages.panel.empty'),
    },
    {
      name: t('modules.stickymessages.panel.formatField'),
      value: sticky?.embed
        ? t('modules.stickymessages.panel.formatEmbed')
        : t('modules.stickymessages.panel.formatText'),
      inline: true,
    },
  );

  const buttons = row().addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'edittext', channelId))
      .setLabel(t('modules.stickymessages.panel.editText'))
      .setStyle(ButtonStyle.Primary),
  );
  if (sticky) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'embed', channelId))
        .setLabel(t('modules.stickymessages.panel.embedToggle'))
        .setStyle(sticky.embed ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'delete', channelId))
        .setLabel(t('modules.stickymessages.panel.delete'))
        .setStyle(ButtonStyle.Danger),
    );
  }
  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(panelCustomId(MODULE_NAME, 'back'))
      .setLabel(t('modules.stickymessages.panel.back'))
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [buttons] };
}

function textModal(channelId: string, current: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'textmodal', channelId))
    .setTitle(t('modules.stickymessages.panel.modalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('content')
          .setLabel(t('modules.stickymessages.panel.modalField'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
          .setValue(current)
          .setPlaceholder(t('modules.stickymessages.panel.modalPlaceholder')),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

async function showEdit(
  interaction: PanelHandlerArgs['interaction'],
  ctx: BotContext,
  guildId: string,
  channelId: string,
): Promise<void> {
  const config = await getStickymessagesConfig(ctx, guildId);
  const view = renderEdit(channelId, findSticky(config, channelId));
  if (interaction.isMessageComponent()) await interaction.update(view);
  else if (interaction.isModalSubmit() && interaction.isFromMessage())
    await interaction.update(view);
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
    case 'pick': {
      if (!interaction.isChannelSelectMenu()) return;
      const channelId = interaction.values[0];
      if (!channelId) return;
      await showEdit(interaction, ctx, guildId, channelId);
      return;
    }
    case 'back': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'edittext': {
      if (!interaction.isButton()) return;
      const channelId = params[0];
      if (!channelId) return;
      const config = await getStickymessagesConfig(ctx, guildId);
      await interaction.showModal(
        textModal(channelId, findSticky(config, channelId)?.content ?? ''),
      );
      return;
    }
    case 'textmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const channelId = params[0];
      if (!channelId) return;
      const content = interaction.fields.getTextInputValue('content').trim();
      if (content) {
        await upsertSticky(ctx, guildId, channelId, { content });
        // Poste (ou remet à jour) immédiatement le sticky dans le salon.
        await repostSticky(ctx, guildId, channelId);
      }
      await showEdit(interaction, ctx, guildId, channelId);
      return;
    }
    case 'embed': {
      if (!interaction.isButton()) return;
      const channelId = params[0];
      if (!channelId) return;
      const config = await getStickymessagesConfig(ctx, guildId);
      const sticky = findSticky(config, channelId);
      if (sticky) {
        await upsertSticky(ctx, guildId, channelId, { embed: !sticky.embed });
        await repostSticky(ctx, guildId, channelId);
      }
      await showEdit(interaction, ctx, guildId, channelId);
      return;
    }
    case 'delete': {
      if (!interaction.isButton()) return;
      const channelId = params[0];
      if (!channelId) return;
      cancelRepost(channelId);
      const lastMessageId = await removeSticky(ctx, guildId, channelId);
      if (lastMessageId) {
        const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased() && !channel.isDMBased()) {
          await channel.messages.delete(lastMessageId).catch(() => undefined);
        }
      }
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Messages épinglés ». */
export const stickymessagesPanel: ConfigPanel = {
  render: async (ctx, guildId) => render(await getStickymessagesConfig(ctx, guildId)),
  handle,
};
