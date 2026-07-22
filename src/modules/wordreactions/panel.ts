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
  MATCH_TYPES,
  MAX_RULES,
  MODULE_NAME,
  type MatchType,
  type WordReaction,
  type WordreactionsConfig,
  getWordreactionsConfig,
  updateWordreactionsConfig,
} from './config.js';
import { parseEmojis } from './service.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function matchLabel(match: MatchType): string {
  return t(`modules.wordreactions.match.${match}`);
}

function ruleLine(rule: WordReaction): string {
  const scope = rule.channelId ? ` · <#${rule.channelId}>` : '';
  return `\`${rule.trigger}\` ${rule.emojis.join(' ')} — ${matchLabel(rule.match)}${scope}`;
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getWordreactionsConfig(ctx, guildId);

  const list = config.rules.length
    ? config.rules.map(ruleLine).join('\n')
    : t('modules.wordreactions.panel.noRules');

  const embed = infoEmbed({
    title: t('modules.wordreactions.label'),
    description: t('modules.wordreactions.panel.intro'),
  }).addFields({
    name: t('modules.wordreactions.panel.listField', { count: config.rules.length }),
    value: list.slice(0, 1024),
  });

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add'))
        .setLabel(t('modules.wordreactions.panel.add'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(config.rules.length >= MAX_RULES),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
        .setLabel(t('modules.wordreactions.panel.manage'))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(config.rules.length === 0),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages -------------------------------------------------------------

function renderList(config: WordreactionsConfig): {
  embeds: EmbedBuilder[];
  components: PanelRow[];
} {
  const embed = infoEmbed({
    title: t('modules.wordreactions.panel.listTitle'),
    description: t('modules.wordreactions.panel.listIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
    .setPlaceholder(t('modules.wordreactions.panel.pickPlaceholder'))
    .addOptions(
      config.rules.map((rule) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(rule.trigger.slice(0, 100))
          .setValue(rule.id)
          .setDescription(rule.emojis.join(' ').slice(0, 100)),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.wordreactions.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderEdit(rule: WordReaction): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.wordreactions.panel.editTitle'),
    description: t('modules.wordreactions.panel.editIntro'),
  }).addFields(
    {
      name: t('modules.wordreactions.panel.triggerField'),
      value: `\`${rule.trigger}\``,
      inline: true,
    },
    {
      name: t('modules.wordreactions.panel.matchField'),
      value: matchLabel(rule.match),
      inline: true,
    },
    {
      name: t('modules.wordreactions.panel.channelField'),
      value: rule.channelId ? `<#${rule.channelId}>` : t('modules.wordreactions.panel.anyChannel'),
      inline: true,
    },
    { name: t('modules.wordreactions.panel.emojisField'), value: rule.emojis.join(' ') || '—' },
  );

  const matchSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'match', rule.id))
    .setPlaceholder(t('modules.wordreactions.panel.matchPlaceholder'))
    .addOptions(
      MATCH_TYPES.map((match) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(matchLabel(match))
          .setValue(match)
          .setDefault(match === rule.match),
      ),
    );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'chan', rule.id))
    .setPlaceholder(t('modules.wordreactions.panel.channelPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (rule.channelId) channelSelect.setDefaultChannels([rule.channelId]);

  return {
    embeds: [embed],
    components: [
      row().addComponents(matchSelect),
      row().addComponents(channelSelect),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'edit', rule.id))
          .setLabel(t('modules.wordreactions.panel.editRule'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'remove', rule.id))
          .setLabel(t('modules.wordreactions.panel.delete'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
          .setLabel(t('modules.wordreactions.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function ruleModal(action: 'addmodal' | 'editmodal', rule?: WordReaction): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, action, rule?.id ?? ''))
    .setTitle(t('modules.wordreactions.panel.modalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('trigger')
          .setLabel(t('modules.wordreactions.panel.triggerInput'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setValue(rule?.trigger ?? ''),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('emojis')
          .setLabel(t('modules.wordreactions.panel.emojisInput'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(200)
          .setRequired(true)
          .setValue(rule?.emojis.join(' ') ?? ''),
      ),
    );
  return modal;
}

// --- Routeur ----------------------------------------------------------------

function patchRule(
  config: WordreactionsConfig,
  id: string,
  patch: Partial<WordReaction>,
): WordReaction[] {
  return config.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule));
}

function find(config: WordreactionsConfig, id: string | undefined): WordReaction | undefined {
  return config.rules.find((rule) => rule.id === id);
}

async function handle({ interaction, ctx, guildId, action, params, renderPage }: PanelHandlerArgs) {
  const guild = interaction.inCachedGuild() ? interaction.guild : undefined;
  switch (action) {
    case 'add': {
      if (!interaction.isButton()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      if (config.rules.length >= MAX_RULES) {
        await interaction.update(await renderPage());
        return;
      }
      await interaction.showModal(ruleModal('addmodal'));
      return;
    }
    case 'addmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      const trigger = interaction.fields.getTextInputValue('trigger').trim().slice(0, 100);
      const emojis = parseEmojis(interaction.fields.getTextInputValue('emojis'), guild);
      if (!trigger || emojis.length === 0) {
        await interaction.reply({
          content: t('modules.wordreactions.panel.invalidEmojis'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const rule: WordReaction = {
        id: randomUUID().slice(0, 8),
        trigger,
        match: 'word',
        emojis,
        channelId: null,
      };
      await updateWordreactionsConfig(ctx, guildId, { rules: [...config.rules, rule] });
      await interaction.update(renderEdit(rule));
      return;
    }
    case 'manage': {
      if (!interaction.isButton()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      if (config.rules.length === 0) {
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
      const config = await getWordreactionsConfig(ctx, guildId);
      const rule = find(config, interaction.values[0]);
      await interaction.update(rule ? renderEdit(rule) : renderList(config));
      return;
    }
    case 'match': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      const rules = patchRule(config, params[0] ?? '', {
        match: interaction.values[0] as MatchType,
      });
      await updateWordreactionsConfig(ctx, guildId, { rules });
      const rule = find({ ...config, rules }, params[0]);
      await interaction.update(rule ? renderEdit(rule) : renderList({ ...config, rules }));
      return;
    }
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      const rules = patchRule(config, params[0] ?? '', {
        channelId: interaction.values[0] ?? null,
      });
      await updateWordreactionsConfig(ctx, guildId, { rules });
      const rule = find({ ...config, rules }, params[0]);
      await interaction.update(rule ? renderEdit(rule) : renderList({ ...config, rules }));
      return;
    }
    case 'edit': {
      if (!interaction.isButton()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      const rule = find(config, params[0]);
      if (!rule) {
        await interaction.update(renderList(config));
        return;
      }
      await interaction.showModal(ruleModal('editmodal', rule));
      return;
    }
    case 'editmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      const current = find(config, params[0]);
      if (!current) {
        await interaction.update(renderList(config));
        return;
      }
      const trigger = interaction.fields.getTextInputValue('trigger').trim().slice(0, 100);
      const emojis = parseEmojis(interaction.fields.getTextInputValue('emojis'), guild);
      const rules = patchRule(config, params[0] ?? '', {
        trigger: trigger || current.trigger,
        emojis: emojis.length > 0 ? emojis : current.emojis,
      });
      await updateWordreactionsConfig(ctx, guildId, { rules });
      const rule = find({ ...config, rules }, params[0]);
      await interaction.update(rule ? renderEdit(rule) : renderList({ ...config, rules }));
      return;
    }
    case 'remove': {
      if (!interaction.isButton()) return;
      const config = await getWordreactionsConfig(ctx, guildId);
      const rules = config.rules.filter((rule) => rule.id !== params[0]);
      await updateWordreactionsConfig(ctx, guildId, { rules });
      await interaction.update(
        rules.length ? renderList({ ...config, rules }) : await renderPage(),
      );
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Réactions de mots ». */
export const wordreactionsPanel: ConfigPanel = { render, handle };
