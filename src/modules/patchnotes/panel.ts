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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { PATCH_SOURCES, getPatchSource, patchSourceLabel, type PatchSource } from './catalog.js';
import {
  MODULE_NAME,
  getPatchnotesConfig,
  sourcePageCount,
  updatePatchnotesConfig,
  upsertSubscription,
  type PatchnotesConfig,
} from './config.js';
import {
  buildPatchNoteEmbed,
  fetchPatchNotes,
  publishLatestPatchNotes,
  type PublishLatestPatchNotesResult,
} from './service.js';

const PAGE_SIZE = 25;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function sourceMatches(source: PatchSource, query: string): boolean {
  if (!query) return true;
  const normalized = normalize(query);
  const haystack = normalize(`${source.name} ${source.category} ${source.id} ${source.kind}`);
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

function filteredSources(query: string): PatchSource[] {
  return PATCH_SOURCES.filter((source) => sourceMatches(source, query.trim()));
}

function activeSources(config: PatchnotesConfig): PatchSource[] {
  return config.subscriptions
    .map((sub) => getPatchSource(sub.sourceId))
    .filter((source): source is PatchSource => Boolean(source));
}

function listedSources(config: PatchnotesConfig, selected: PatchSource): PatchSource[] {
  if (config.displayMode === 'active') {
    const active = activeSources(config);
    return active.length ? active : [selected];
  }
  const matches = filteredSources(config.searchQuery);
  return matches.length ? matches : [selected];
}

function currentPage(config: PatchnotesConfig, total: number): number {
  return Math.min(Math.max(config.page, 0), sourcePageCount(PAGE_SIZE, total) - 1);
}

function selectedSubscription(config: PatchnotesConfig) {
  return config.subscriptions.find((sub) => sub.sourceId === config.selectedSourceId);
}

function sourceOption(sourceId: string): string {
  const source = getPatchSource(sourceId);
  return source ? `${source.name} - ${source.category}` : sourceId;
}

function subscriptionList(config: PatchnotesConfig): string {
  if (config.subscriptions.length === 0) return t('modules.patchnotes.panel.noSubs');
  return config.subscriptions
    .map((sub) => {
      const role = sub.roleId ? ` - <@&${sub.roleId}>` : '';
      return `- **${patchSourceLabel(sub.sourceId)}** -> <#${sub.channelId}>${role}`;
    })
    .join('\n')
    .slice(0, 1024);
}

function publishFailureMessage(
  reason: PublishLatestPatchNotesResult['reason'],
  sourceName: string,
  channelId: string,
): string {
  const channel = `<#${channelId}>`;
  switch (reason) {
    case 'noNotes':
      return t('modules.patchnotes.panel.publishFailedNoNotes', { source: sourceName });
    case 'channelUnavailable':
      return t('modules.patchnotes.panel.publishFailedChannel', { channel });
    case 'missingPermissions':
      return t('modules.patchnotes.panel.publishFailedPermissions', { channel });
    case 'missingSource':
      return t('modules.patchnotes.panel.publishFailedSource');
    case 'missingChannel':
      return t('modules.patchnotes.panel.publishMissingChannel');
    case 'sendFailed':
    default:
      return t('modules.patchnotes.panel.publishFailedSend', { channel });
  }
}
function searchModal(query: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('query')
    .setLabel(t('modules.patchnotes.panel.searchField'))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false)
    .setPlaceholder(t('modules.patchnotes.panel.searchPlaceholder'));
  if (query) input.setValue(query);

  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'searchModal'))
    .setTitle(t('modules.patchnotes.panel.searchTitle'))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getPatchnotesConfig(ctx, guildId);
  const selected = getPatchSource(config.selectedSourceId) ?? PATCH_SOURCES[0]!;
  const sources = listedSources(config, selected);
  const page = currentPage(config, sources.length);
  const pageCount = sourcePageCount(PAGE_SIZE, sources.length);
  const sub = selectedSubscription(config);
  const searchMatches = filteredSources(config.searchQuery).length;

  const embed = infoEmbed({
    title: t('modules.patchnotes.label'),
    description: t('modules.patchnotes.panel.intro'),
  }).addFields(
    {
      name: t('modules.patchnotes.panel.selectedField'),
      value: `**${sourceOption(selected.id)}**\n${sub?.channelId ? `<#${sub.channelId}>` : t('modules.patchnotes.panel.pickChannelHint')}`,
      inline: false,
    },
    {
      name: t('modules.patchnotes.panel.subsField'),
      value: subscriptionList(config),
      inline: false,
    },
  );

  if (config.displayMode === 'active') {
    embed.addFields({
      name: t('modules.patchnotes.panel.modeField'),
      value: t('modules.patchnotes.panel.activeModeValue', { count: config.subscriptions.length }),
      inline: false,
    });
  } else if (config.searchQuery) {
    embed.addFields({
      name: t('modules.patchnotes.panel.searchActiveField'),
      value: t('modules.patchnotes.panel.searchActiveValue', {
        query: config.searchQuery,
        count: searchMatches,
      }),
      inline: false,
    });
  }

  embed.addFields({
    name: t('modules.patchnotes.panel.listField'),
    value: t('modules.patchnotes.panel.listStatus', {
      page: page + 1,
      pages: pageCount,
      total: sources.length,
    }),
    inline: true,
  });

  const pageSources = sources.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const sourceSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'source', String(page)))
    .setPlaceholder(
      config.displayMode === 'active'
        ? t('modules.patchnotes.panel.activePlaceholder', { page: page + 1, pages: pageCount })
        : t('modules.patchnotes.panel.sourcePlaceholder', { page: page + 1, pages: pageCount }),
    )
    .addOptions(
      pageSources.map((source) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(source.name, 100))
          .setValue(source.id)
          .setDescription(truncate(`${source.category} - ${source.kind.toUpperCase()}`, 100))
          .setDefault(source.id === selected.id),
      ),
    );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'channel'))
    .setPlaceholder(t('modules.patchnotes.panel.channelPlaceholder', { source: selected.name }))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'role'))
    .setPlaceholder(t('modules.patchnotes.panel.rolePlaceholder'))
    .setMinValues(0)
    .setMaxValues(1);
  const components: PanelRow[] = [
    row().addComponents(sourceSelect),
    row().addComponents(channelSelect),
    row().addComponents(roleSelect),
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'page', String(page - 1)))
        .setLabel(t('modules.patchnotes.panel.previous'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(
          panelCustomId(MODULE_NAME, config.displayMode === 'active' ? 'deleteSelected' : 'search'),
        )
        .setLabel(
          config.displayMode === 'active'
            ? t('modules.patchnotes.panel.deleteSelected')
            : t('modules.patchnotes.panel.search'),
        )
        .setStyle(config.displayMode === 'active' ? ButtonStyle.Danger : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'toggleMode'))
        .setLabel(
          config.displayMode === 'active'
            ? t('modules.patchnotes.panel.catalogMode')
            : t('modules.patchnotes.panel.activeMode'),
        )
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, sub?.channelId ? 'publish' : 'preview'))
        .setLabel(
          sub?.channelId
            ? t('modules.patchnotes.panel.publish')
            : t('modules.patchnotes.panel.preview'),
        )
        .setStyle(sub?.channelId ? ButtonStyle.Success : ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'page', String(page + 1)))
        .setLabel(t('modules.patchnotes.panel.next'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
    ),
  ];

  return { embed, components };
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
    case 'source': {
      if (!interaction.isStringSelectMenu()) return;
      const sourceId = interaction.values[0];
      if (!sourceId || !getPatchSource(sourceId)) return;
      await updatePatchnotesConfig(ctx, guildId, {
        selectedSourceId: sourceId,
        page: Number.parseInt(params[0] ?? '0', 10) || 0,
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'search': {
      if (!interaction.isButton()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      await interaction.showModal(searchModal(config.searchQuery));
      return;
    }
    case 'searchModal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const searchQuery = interaction.fields.getTextInputValue('query').trim();
      const config = await getPatchnotesConfig(ctx, guildId);
      const matches = filteredSources(searchQuery);
      const selectedSourceId = matches.some((source) => source.id === config.selectedSourceId)
        ? config.selectedSourceId
        : (matches[0]?.id ?? config.selectedSourceId);
      await updatePatchnotesConfig(ctx, guildId, {
        searchQuery,
        selectedSourceId,
        page: 0,
        displayMode: 'catalog',
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'toggleMode': {
      if (!interaction.isButton()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      const displayMode = config.displayMode === 'active' ? 'catalog' : 'active';
      const active = activeSources(config);
      if (displayMode === 'active' && active.length === 0) {
        await interaction.reply({
          content: t('modules.patchnotes.panel.noActiveSubs'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const selectedSourceId =
        displayMode === 'active' && !active.some((source) => source.id === config.selectedSourceId)
          ? active[0]!.id
          : config.selectedSourceId;
      await updatePatchnotesConfig(ctx, guildId, { displayMode, selectedSourceId, page: 0 });
      await interaction.update(await renderPage());
      return;
    }
    case 'page': {
      if (!interaction.isButton()) return;
      await updatePatchnotesConfig(ctx, guildId, {
        page: Number.parseInt(params[0] ?? '0', 10) || 0,
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'channel': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      const sourceId = config.selectedSourceId;
      const channelId = interaction.values[0] ?? '';
      const subscriptions = channelId
        ? upsertSubscription(config, sourceId, { channelId })
        : config.subscriptions.filter((sub) => sub.sourceId !== sourceId);
      await updatePatchnotesConfig(ctx, guildId, { subscriptions });
      await interaction.update(await renderPage());
      return;
    }
    case 'role': {
      if (!interaction.isRoleSelectMenu()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      const sourceId = config.selectedSourceId;
      const subscriptions = upsertSubscription(config, sourceId, {
        channelId: selectedSubscription(config)?.channelId,
        roleId: interaction.values[0] ?? null,
      });
      await updatePatchnotesConfig(ctx, guildId, { subscriptions });
      await interaction.update(await renderPage());
      return;
    }
    case 'deleteSelected': {
      if (!interaction.isButton()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      const subscriptions = config.subscriptions.filter(
        (sub) => sub.sourceId !== config.selectedSourceId,
      );
      const active = subscriptions
        .map((sub) => getPatchSource(sub.sourceId))
        .filter((source): source is PatchSource => Boolean(source));
      await updatePatchnotesConfig(ctx, guildId, {
        subscriptions,
        selectedSourceId: active[0]?.id ?? config.selectedSourceId,
        displayMode: active.length > 0 ? config.displayMode : 'catalog',
        page: 0,
      });
      await interaction.update(await renderPage());
      return;
    }
    case 'preview': {
      if (!interaction.isButton()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      const source = getPatchSource(config.selectedSourceId);
      if (!source) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const notes = await fetchPatchNotes(source);
      if (notes.length === 0) {
        await interaction.editReply({ content: t('modules.patchnotes.panel.noPreview') });
        return;
      }
      await interaction.editReply({
        content: t('modules.patchnotes.panel.previewTitle', { source: source.name }),
        embeds: notes.slice(0, 3).map((note) => buildPatchNoteEmbed(note, source)),
      });
      return;
    }
    case 'publish': {
      if (!interaction.isButton()) return;
      const config = await getPatchnotesConfig(ctx, guildId);
      const sub = selectedSubscription(config);
      if (!sub?.channelId) {
        await interaction.reply({
          content: t('modules.patchnotes.panel.publishMissingChannel'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const source = getPatchSource(sub.sourceId);
      const result = await publishLatestPatchNotes(ctx, sub, 1);
      if (result.sent === 0) {
        await interaction.editReply({
          content: publishFailureMessage(
            result.reason,
            source?.name ?? sub.sourceId,
            sub.channelId,
          ),
        });
        return;
      }
      await interaction.editReply({
        content: t('modules.patchnotes.panel.publishDone', {
          count: result.sent,
          channel: `<#${sub.channelId}>`,
        }),
      });
      return;
    }
    default:
      return;
  }
}

export const patchnotesPanel: ConfigPanel = { render, handle };
