import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Interaction,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { t } from './i18n.js';
import { Colors, infoEmbed } from '../lib/embeds.js';
import type { BotContext, BotModule, PanelPage, PanelRow } from './module.js';
import type { ModuleRegistry } from './loader.js';

const NS = 'cfg';
const HOME_PAGE_SIZE = 25;
const MAX_OPTION_DESCRIPTION = 100;
const MAX_MODULE_PREVIEW = 6;

type CategoryId = 'security' | 'community' | 'engagement' | 'operations' | 'fun';

interface CategoryMeta {
  id: CategoryId;
  emoji: string;
  color: number;
  labelKey: string;
  descriptionKey: string;
}

interface ModuleVisual {
  category: CategoryId;
  emoji: string;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: 'security',
    emoji: '\u{1F6E1}\u{FE0F}',
    color: Colors.error,
    labelKey: 'modules.core.config.categories.security.label',
    descriptionKey: 'modules.core.config.categories.security.description',
  },
  {
    id: 'community',
    emoji: '\u{1F465}',
    color: Colors.success,
    labelKey: 'modules.core.config.categories.community.label',
    descriptionKey: 'modules.core.config.categories.community.description',
  },
  {
    id: 'engagement',
    emoji: '\u{2728}',
    color: Colors.warning,
    labelKey: 'modules.core.config.categories.engagement.label',
    descriptionKey: 'modules.core.config.categories.engagement.description',
  },
  {
    id: 'operations',
    emoji: '\u{1F9F0}',
    color: Colors.info,
    labelKey: 'modules.core.config.categories.operations.label',
    descriptionKey: 'modules.core.config.categories.operations.description',
  },
  {
    id: 'fun',
    emoji: '\u{1F3AE}',
    color: Colors.accent,
    labelKey: 'modules.core.config.categories.fun.label',
    descriptionKey: 'modules.core.config.categories.fun.description',
  },
];

const MODULE_VISUALS: Record<string, ModuleVisual> = {
  automod: { category: 'security', emoji: '\u{1F6E1}\u{FE0F}' },
  moderation: { category: 'security', emoji: '\u{1F528}' },
  logs: { category: 'security', emoji: '\u{1F4DC}' },
  reports: { category: 'security', emoji: '\u{1F6A9}' },
  rules: { category: 'security', emoji: '\u{1F4D8}' },
  verification: { category: 'security', emoji: '\u{2705}' },
  configbackup: { category: 'security', emoji: '\u{1F4BE}' },

  welcome: { category: 'community', emoji: '\u{1F44B}' },
  birthdays: { category: 'community', emoji: '\u{1F382}' },
  suggestions: { category: 'community', emoji: '\u{1F4A1}' },
  tickets: { category: 'community', emoji: '\u{1F39F}\u{FE0F}' },
  reactionroles: { category: 'community', emoji: '\u{1F3AD}' },
  interactivemessages: { category: 'community', emoji: '\u{1F9E9}' },
  interserver: { category: 'community', emoji: '\u{1F310}' },
  stickymessages: { category: 'community', emoji: '\u{1F4CC}' },
  autoroles: { category: 'community', emoji: '\u{1F3F7}\u{FE0F}' },
  streamer: { category: 'community', emoji: '\u{1F3A7}' },

  levels: { category: 'engagement', emoji: '\u{1F4C8}' },
  economy: { category: 'engagement', emoji: '\u{1FA99}' },
  giveaways: { category: 'engagement', emoji: '\u{1F381}' },
  advent: { category: 'engagement', emoji: '\u{1F384}' },
  starboard: { category: 'engagement', emoji: '\u{2B50}' },
  customcommands: { category: 'engagement', emoji: '\u{1F5E3}\u{FE0F}' },
  wordreactions: { category: 'engagement', emoji: '\u{1F4AC}' },
  messageprofiles: { category: 'engagement', emoji: '\u{1F5E8}\u{FE0F}' },

  reminders: { category: 'operations', emoji: '\u{23F0}' },
  scheduledmessages: { category: 'operations', emoji: '\u{1F4C5}' },
  serverstats: { category: 'operations', emoji: '\u{1F4CA}' },
  tempvoice: { category: 'operations', emoji: '\u{1F399}\u{FE0F}' },
  streamalerts: { category: 'operations', emoji: '\u{1F4E1}' },
  freegames: { category: 'operations', emoji: '\u{1F579}\u{FE0F}' },
  patchnotes: { category: 'operations', emoji: '\u{1F4F0}' },
  info: { category: 'operations', emoji: '\u{2139}\u{FE0F}' },

  games: { category: 'fun', emoji: '\u{1F3AE}' },
  items: { category: 'fun', emoji: '\u{1F392}' },
  route: { category: 'fun', emoji: '\u{1F9ED}' },
  bingo: { category: 'fun', emoji: '\u{1F3B0}' },
  music: { category: 'fun', emoji: '\u{1F3B5}' },
};

const MODULE_ORDER = Object.keys(MODULE_VISUALS);

/** Indique si un customId relève du système de configuration `/config`. */
export function isConfigCustomId(customId: string): boolean {
  return customId.startsWith(`${NS}|`);
}

function id(scope: string, action: string, ...params: string[]): string {
  return [NS, scope, action, ...params].join('|');
}

/** Construit un customId pour le panneau d'un module (utilisé par les modules). */
export function panelCustomId(moduleName: string, action: string, ...params: string[]): string {
  return id(moduleName, action, ...params);
}

function newRow(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function moduleStatus(internal: boolean | undefined, enabled: boolean): string {
  if (internal) return t('modules.core.config.statusInternal');
  return enabled ? t('modules.core.config.statusEnabled') : t('modules.core.config.statusDisabled');
}

function moduleRank(moduleName: string): number {
  const index = MODULE_ORDER.indexOf(moduleName);
  return index === -1 ? 999 : index;
}

/** Visuel (catégorie + emoji) d'un module — aussi utilisé par l'API web. */
export function moduleVisual(moduleName: string): ModuleVisual {
  return MODULE_VISUALS[moduleName] ?? { category: 'operations', emoji: '\u{2699}\u{FE0F}' };
}

function categoryMeta(categoryId: CategoryId): CategoryMeta {
  return CATEGORIES.find((category) => category.id === categoryId) ?? CATEGORIES[0]!;
}

function modulesForCategory(modules: BotModule[], categoryId: CategoryId): BotModule[] {
  return modules
    .filter((module) => !module.internal && moduleVisual(module.name).category === categoryId)
    .sort((a, b) => moduleRank(a.name) - moduleRank(b.name));
}

function countEnabled(modules: BotModule[], states: Map<string, boolean>): number {
  return modules.filter((module) => states.get(module.name) ?? false).length;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

function optionDescription(value: string): string {
  return truncate(value.replace(/\s+/g, ' ').trim(), MAX_OPTION_DESCRIPTION);
}

function moduleLine(
  module: BotModule,
  states: Map<string, boolean>,
  includeStatus = true,
  includeEmoji = true,
): string {
  const visual = moduleVisual(module.name);
  const prefix = includeEmoji ? `${visual.emoji} ` : '';
  const label = `${prefix}**${t(module.labelKey)}**`;
  if (!includeStatus) return label;
  return `${label} \u2014 ${moduleStatus(module.internal, states.get(module.name) ?? false)}`;
}

function categoryStatusIndicator(enabled: number, total: number): string {
  if (enabled === 0) return '\u{1F534}';
  if (enabled === total) return '\u{1F7E2}';
  return '\u{1F7E1}';
}

function homeModuleLine(module: BotModule): string {
  return `\u2022 ${t(module.labelKey)}`;
}

function categoryFieldValue(categoryModules: BotModule[], states: Map<string, boolean>): string {
  const activeModules = categoryModules.filter((module) => states.get(module.name) ?? false);
  const disabledCount = categoryModules.length - activeModules.length;
  const preview = activeModules.slice(0, MAX_MODULE_PREVIEW).map(homeModuleLine);

  if (activeModules.length > MAX_MODULE_PREVIEW) {
    preview.push(
      t('modules.core.config.moreModules', {
        count: activeModules.length - MAX_MODULE_PREVIEW,
      }),
    );
  }

  preview.push(t('modules.core.config.disabledModules', { count: disabledCount }));

  return `${t('modules.core.config.categoryStatus', {
    enabled: activeModules.length,
    total: categoryModules.length,
    indicator: categoryStatusIndicator(activeModules.length, categoryModules.length),
  })}\n${preview.join('\n')}`;
}

function moduleSelectOption(
  module: BotModule,
  states: Map<string, boolean>,
): StringSelectMenuOptionBuilder {
  const enabled = states.get(module.name) ?? false;
  return new StringSelectMenuOptionBuilder()
    .setLabel(truncate(t(module.labelKey), 100))
    .setValue(module.name)
    .setEmoji(moduleVisual(module.name).emoji)
    .setDescription(
      optionDescription(`${moduleStatus(module.internal, enabled)} · ${t(module.descriptionKey)}`),
    );
}

/** Page d'accueil de `/config` : catégories de modules, plus légère qu'une liste brute. */
export async function renderHome(
  ctx: BotContext,
  guildId: string,
  guildName: string,
  modules: BotModule[],
  _page = 0,
): Promise<PanelPage> {
  const states = await ctx.config.listStates(guildId);
  const configurable = modules.filter((module) => !module.internal);

  const availableCategories = CATEGORIES.map((category) => ({
    category,
    modules: modulesForCategory(configurable, category.id),
  })).filter((entry) => entry.modules.length > 0);

  const totalEnabled = countEnabled(configurable, states);
  const embed = infoEmbed({
    title: t('modules.core.config.title'),
    description: t('modules.core.config.intro', {
      guild: guildName,
      enabled: totalEnabled,
      total: configurable.length,
    }),
  })
    .setColor(Colors.brand)
    .setFooter({ text: t('modules.core.config.footer') });

  for (const { category, modules: categoryModules } of availableCategories) {
    embed.addFields({
      name: `${category.emoji} ${t(category.labelKey)}`,
      value: categoryFieldValue(categoryModules, states),
      inline: false,
    });
  }

  if (configurable.length === 0) {
    embed.addFields({ name: 'Modules', value: t('modules.core.config.noModules') });
    return { embeds: [embed], components: [] };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(id('home', 'category'))
    .setPlaceholder(t('modules.core.config.categorySelectPlaceholder'))
    .addOptions(
      availableCategories.map(({ category, modules: categoryModules }) => {
        const enabled = countEnabled(categoryModules, states);
        return new StringSelectMenuOptionBuilder()
          .setLabel(t(category.labelKey))
          .setValue(category.id)
          .setEmoji(category.emoji)
          .setDescription(
            optionDescription(
              t(category.descriptionKey, { enabled, total: categoryModules.length }),
            ),
          );
      }),
    );

  return { embeds: [embed], components: [newRow().addComponents(select)] };
}

async function renderCategoryPage(
  ctx: BotContext,
  guildId: string,
  guildName: string,
  modules: BotModule[],
  categoryId: CategoryId,
  page = 0,
): Promise<PanelPage> {
  const states = await ctx.config.listStates(guildId);
  const meta = categoryMeta(categoryId);
  const categoryModules = modulesForCategory(modules, categoryId);
  const pageCount = Math.max(1, Math.ceil(categoryModules.length / HOME_PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  const slice = categoryModules.slice(
    current * HOME_PAGE_SIZE,
    current * HOME_PAGE_SIZE + HOME_PAGE_SIZE,
  );

  const embed = infoEmbed({
    title: t('modules.core.config.categoryTitle', {
      emoji: meta.emoji,
      category: t(meta.labelKey),
    }),
    description: t('modules.core.config.categoryIntro', { guild: guildName }),
  })
    .setColor(meta.color)
    .addFields({
      name: t('modules.core.config.categoryModulesField'),
      value: slice.map((module) => moduleLine(module, states)).join('\n'),
    })
    .setFooter({
      text: t('modules.core.config.categoryFooter', {
        page: current + 1,
        pages: pageCount,
      }),
    });

  const select = new StringSelectMenuBuilder()
    .setCustomId(id('home', 'module', categoryId, String(current)))
    .setPlaceholder(t('modules.core.config.moduleSelectPlaceholder'))
    .addOptions(slice.map((module) => moduleSelectOption(module, states)));

  const navigation = newRow().addComponents(
    new ButtonBuilder()
      .setCustomId(id('home', 'back'))
      .setLabel(t('modules.core.config.homeButton'))
      .setEmoji('\u{1F3E0}')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(id('home', 'categoryPage', categoryId, String(current - 1)))
      .setLabel(t('modules.core.config.previousButton'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === 0),
    new ButtonBuilder()
      .setCustomId(id('home', 'categoryPage', categoryId, String(current + 1)))
      .setLabel(t('modules.core.config.nextButton'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current === pageCount - 1),
  );

  return { embeds: [embed], components: [newRow().addComponents(select), navigation] };
}

/** Page d'un module : chrome (activer/désactiver/retour) + panneau du module. */
export async function renderModulePage(
  ctx: BotContext,
  guildId: string,
  module: BotModule,
): Promise<PanelPage> {
  const enabled = await ctx.config.isEnabled(guildId, module.name);
  const visual = moduleVisual(module.name);
  const category = categoryMeta(visual.category);

  const toggle = enabled
    ? new ButtonBuilder()
        .setCustomId(id('home', 'disable', module.name))
        .setLabel(t('modules.core.config.disableButton'))
        .setEmoji('\u{23F8}\u{FE0F}')
        .setStyle(ButtonStyle.Danger)
    : new ButtonBuilder()
        .setCustomId(id('home', 'enable', module.name))
        .setLabel(t('modules.core.config.enableButton'))
        .setEmoji('\u{25B6}\u{FE0F}')
        .setStyle(ButtonStyle.Success);

  const chrome = newRow().addComponents(
    toggle,
    new ButtonBuilder()
      .setCustomId(id('home', 'back'))
      .setLabel(t('modules.core.config.back'))
      .setEmoji('\u{1F3E0}')
      .setStyle(ButtonStyle.Secondary),
  );

  if (module.configPanel && enabled) {
    const panel = await module.configPanel.render(ctx, guildId);
    panel.embed.setColor(category.color).setAuthor({
      name: `${visual.emoji} ${t(module.labelKey)} \u00b7 ${category.emoji} ${t(category.labelKey)}`,
    });
    return { embeds: [panel.embed], components: [chrome, ...panel.components] };
  }

  const embed = infoEmbed({
    title: `${visual.emoji} ${t(module.labelKey)}`,
    description: t(module.descriptionKey),
  })
    .setColor(category.color)
    .addFields(
      {
        name: t('modules.core.config.statusField'),
        value: moduleStatus(module.internal, enabled),
        inline: true,
      },
      {
        name: t('modules.core.config.categoryField'),
        value: `${category.emoji} ${t(category.labelKey)}`,
        inline: true,
      },
      {
        name: t('modules.core.config.nextStepField'),
        value: enabled ? t('modules.core.config.noPanel') : t('modules.core.config.enableHint'),
      },
    );
  return { embeds: [embed], components: [chrome] };
}

/**
 * Routeur central des interactions de `/config` (boutons, menus, sélecteurs de
 * salon, modals). Sans état : tout est relu depuis la base à chaque interaction.
 */
export async function handleConfigInteraction(
  interaction: Interaction,
  ctx: BotContext,
  registry: ModuleRegistry,
): Promise<void> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: t('modules.core.config.notAllowed'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [, scope, action = '', ...params] = interaction.customId.split('|');
  const guildName = interaction.guild?.name ?? '';

  if (scope === 'home') {
    if (action === 'category' && interaction.isStringSelectMenu()) {
      const categoryId = interaction.values[0] as CategoryId | undefined;
      if (categoryId) {
        await interaction.update(
          await renderCategoryPage(ctx, guildId, guildName, registry.modules, categoryId),
        );
      }
      return;
    }
    if ((action === 'module' || action === 'select') && interaction.isStringSelectMenu()) {
      const module = registry.modules.find((m) => m.name === interaction.values[0]);
      if (module) await interaction.update(await renderModulePage(ctx, guildId, module));
      return;
    }
    if (action === 'back' && interaction.isMessageComponent()) {
      await interaction.update(await renderHome(ctx, guildId, guildName, registry.modules));
      return;
    }
    if (action === 'categoryPage' && interaction.isButton()) {
      const categoryId = params[0] as CategoryId | undefined;
      const page = Number.parseInt(params[1] ?? '0', 10) || 0;
      if (categoryId) {
        await interaction.update(
          await renderCategoryPage(ctx, guildId, guildName, registry.modules, categoryId, page),
        );
      }
      return;
    }
    if (action === 'page' && interaction.isButton()) {
      const page = Number.parseInt(params[0] ?? '0', 10) || 0;
      await interaction.update(await renderHome(ctx, guildId, guildName, registry.modules, page));
      return;
    }
    if (action === 'noop') return;
    if ((action === 'enable' || action === 'disable') && interaction.isButton()) {
      const module = registry.modules.find((m) => m.name === params[0]);
      if (!module || module.internal) return;
      await ctx.config.setEnabled(
        guildId,
        module.name,
        action === 'enable',
        module.defaultConfig ?? {},
      );
      await interaction.update(await renderModulePage(ctx, guildId, module));
      return;
    }
    return;
  }

  const module = registry.modules.find((m) => m.name === scope);
  if (!module?.configPanel) return;

  try {
    await module.configPanel.handle({
      interaction,
      ctx,
      guildId,
      action,
      params,
      renderPage: () => renderModulePage(ctx, guildId, module),
    });
  } catch (error) {
    ctx.logger.error(
      { err: error, module: module.name, action },
      'Échec du panneau de configuration',
    );
    if (interaction.isRepliable()) {
      // On garde le détail technique côté logs uniquement (ci-dessus) : ne jamais
      // exposer `error.message` à l'utilisateur final (fuite d'infos internes).
      const payload = {
        content: t('errors.generic'),
        flags: MessageFlags.Ephemeral as const,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => undefined);
      } else {
        await interaction.reply(payload).catch(() => undefined);
      }
    }
  }
}
