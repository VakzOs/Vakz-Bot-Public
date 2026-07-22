import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
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
  type CustomCommand,
  type CustomcommandsConfig,
  MATCH_TYPES,
  MAX_COMMANDS,
  MODULE_NAME,
  type MatchType,
  getCustomcommandsConfig,
  updateCustomcommandsConfig,
} from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

function matchLabel(match: MatchType): string {
  return t(`modules.customcommands.match.${match}`);
}

function commandLine(command: CustomCommand): string {
  const scope = command.channelId ? ` · <#${command.channelId}>` : '';
  return `\`${command.trigger}\` — ${matchLabel(command.match)}${scope}`;
}

// --- Page principale --------------------------------------------------------

async function render(ctx: BotContext, guildId: string) {
  const config = await getCustomcommandsConfig(ctx, guildId);

  const list = config.commands.length
    ? config.commands.map(commandLine).join('\n')
    : t('modules.customcommands.panel.noCommands');

  const embed = infoEmbed({
    title: t('modules.customcommands.label'),
    description: t('modules.customcommands.panel.intro'),
  }).addFields({
    name: t('modules.customcommands.panel.listField', { count: config.commands.length }),
    value: list.slice(0, 1024),
  });

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add'))
        .setLabel(t('modules.customcommands.panel.add'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(config.commands.length >= MAX_COMMANDS),
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
        .setLabel(t('modules.customcommands.panel.manage'))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(config.commands.length === 0),
    ),
  ];

  return { embed, components };
}

// --- Sous-pages -------------------------------------------------------------

function renderList(config: CustomcommandsConfig): {
  embeds: EmbedBuilder[];
  components: PanelRow[];
} {
  const embed = infoEmbed({
    title: t('modules.customcommands.panel.listTitle'),
    description: t('modules.customcommands.panel.listIntro'),
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
    .setPlaceholder(t('modules.customcommands.panel.pickPlaceholder'))
    .addOptions(
      config.commands.map((command) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(command.trigger.slice(0, 100))
          .setValue(command.id)
          .setDescription(command.response.slice(0, 100)),
      ),
    );
  return {
    embeds: [embed],
    components: [
      row().addComponents(select),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.customcommands.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderEdit(command: CustomCommand): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.customcommands.panel.editTitle'),
    description: t('modules.customcommands.panel.editIntro'),
  }).addFields(
    {
      name: t('modules.customcommands.panel.triggerField'),
      value: `\`${command.trigger}\``,
      inline: true,
    },
    {
      name: t('modules.customcommands.panel.matchField'),
      value: matchLabel(command.match),
      inline: true,
    },
    {
      name: t('modules.customcommands.panel.channelField'),
      value: command.channelId
        ? `<#${command.channelId}>`
        : t('modules.customcommands.panel.anyChannel'),
      inline: true,
    },
    {
      name: t('modules.customcommands.panel.embedField'),
      value: command.asEmbed
        ? t('modules.customcommands.panel.on')
        : t('modules.customcommands.panel.off'),
      inline: true,
    },
    {
      name: t('modules.customcommands.panel.deleteField'),
      value: command.deleteTrigger
        ? t('modules.customcommands.panel.on')
        : t('modules.customcommands.panel.off'),
      inline: true,
    },
    {
      name: t('modules.customcommands.panel.cooldownField'),
      value: command.cooldown > 0 ? `${command.cooldown}s` : t('modules.customcommands.panel.off'),
      inline: true,
    },
    {
      name: t('modules.customcommands.panel.responseField'),
      value: command.response.slice(0, 1024),
    },
  );

  const matchSelect = new StringSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'match', command.id))
    .setPlaceholder(t('modules.customcommands.panel.matchPlaceholder'))
    .addOptions(
      MATCH_TYPES.map((match) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(matchLabel(match))
          .setValue(match)
          .setDefault(match === command.match),
      ),
    );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'chan', command.id))
    .setPlaceholder(t('modules.customcommands.panel.channelPlaceholder'))
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (command.channelId) channelSelect.setDefaultChannels([command.channelId]);

  return {
    embeds: [embed],
    components: [
      row().addComponents(matchSelect),
      row().addComponents(channelSelect),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'resp', command.id))
          .setLabel(t('modules.customcommands.panel.editResponse'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'embed', command.id))
          .setLabel(t('modules.customcommands.panel.toggleEmbed'))
          .setStyle(command.asEmbed ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'del', command.id))
          .setLabel(t('modules.customcommands.panel.toggleDelete'))
          .setStyle(command.deleteTrigger ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'cd', command.id))
          .setLabel(t('modules.customcommands.panel.editCooldown'))
          .setStyle(ButtonStyle.Secondary),
      ),
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'remove', command.id))
          .setLabel(t('modules.customcommands.panel.delete'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'manage'))
          .setLabel(t('modules.customcommands.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function createModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'addmodal'))
    .setTitle(t('modules.customcommands.panel.createTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('trigger')
          .setLabel(t('modules.customcommands.panel.triggerInput'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('response')
          .setLabel(t('modules.customcommands.panel.responseInput'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true),
      ),
    );
}

function responseModal(command: CustomCommand): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'respmodal', command.id))
    .setTitle(t('modules.customcommands.panel.responseTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('response')
          .setLabel(t('modules.customcommands.panel.responseInput'))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
          .setValue(command.response),
      ),
    );
}

function cooldownModal(command: CustomCommand): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'cdmodal', command.id))
    .setTitle(t('modules.customcommands.panel.cooldownTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('cooldown')
          .setLabel(t('modules.customcommands.panel.cooldownInput'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true)
          .setValue(String(command.cooldown)),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

function patchCommand(
  config: CustomcommandsConfig,
  id: string,
  patch: Partial<CustomCommand>,
): CustomCommand[] {
  return config.commands.map((command) => (command.id === id ? { ...command, ...patch } : command));
}

async function handle({ interaction, ctx, guildId, action, params, renderPage }: PanelHandlerArgs) {
  switch (action) {
    case 'add': {
      if (!interaction.isButton()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      if (config.commands.length >= MAX_COMMANDS) {
        await interaction.update(await renderPage());
        return;
      }
      await interaction.showModal(createModal());
      return;
    }
    case 'addmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const trigger = interaction.fields.getTextInputValue('trigger').trim().slice(0, 100);
      const response = interaction.fields.getTextInputValue('response').trim().slice(0, 2000);
      if (!trigger || !response || config.commands.length >= MAX_COMMANDS) {
        await interaction.update(await renderPage());
        return;
      }
      const command: CustomCommand = {
        id: randomUUID().slice(0, 8),
        trigger,
        match: 'contains',
        response,
        asEmbed: false,
        channelId: null,
        deleteTrigger: false,
        cooldown: 0,
      };
      await updateCustomcommandsConfig(ctx, guildId, { commands: [...config.commands, command] });
      await interaction.update(renderEdit(command));
      return;
    }
    case 'manage': {
      if (!interaction.isButton()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      if (config.commands.length === 0) {
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
      const config = await getCustomcommandsConfig(ctx, guildId);
      const command = config.commands.find((candidate) => candidate.id === interaction.values[0]);
      await interaction.update(command ? renderEdit(command) : renderList(config));
      return;
    }
    case 'match': {
      if (!interaction.isStringSelectMenu()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const commands = patchCommand(config, params[0] ?? '', {
        match: interaction.values[0] as MatchType,
      });
      await updateCustomcommandsConfig(ctx, guildId, { commands });
      const command = commands.find((candidate) => candidate.id === params[0]);
      await interaction.update(command ? renderEdit(command) : renderList({ ...config, commands }));
      return;
    }
    case 'chan': {
      if (!interaction.isChannelSelectMenu()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const commands = patchCommand(config, params[0] ?? '', {
        channelId: interaction.values[0] ?? null,
      });
      await updateCustomcommandsConfig(ctx, guildId, { commands });
      const command = commands.find((candidate) => candidate.id === params[0]);
      await interaction.update(command ? renderEdit(command) : renderList({ ...config, commands }));
      return;
    }
    case 'embed':
    case 'del': {
      if (!interaction.isButton()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const current = config.commands.find((candidate) => candidate.id === params[0]);
      if (!current) {
        await interaction.update(renderList(config));
        return;
      }
      const patch =
        action === 'embed'
          ? { asEmbed: !current.asEmbed }
          : { deleteTrigger: !current.deleteTrigger };
      const commands = patchCommand(config, params[0] ?? '', patch);
      await updateCustomcommandsConfig(ctx, guildId, { commands });
      const command = commands.find((candidate) => candidate.id === params[0]);
      await interaction.update(command ? renderEdit(command) : renderList({ ...config, commands }));
      return;
    }
    case 'resp': {
      if (!interaction.isButton()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const command = config.commands.find((candidate) => candidate.id === params[0]);
      if (!command) {
        await interaction.update(renderList(config));
        return;
      }
      await interaction.showModal(responseModal(command));
      return;
    }
    case 'respmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const response = interaction.fields.getTextInputValue('response').trim().slice(0, 2000);
      const commands = patchCommand(config, params[0] ?? '', { response: response || ' ' });
      await updateCustomcommandsConfig(ctx, guildId, { commands });
      const command = commands.find((candidate) => candidate.id === params[0]);
      await interaction.update(command ? renderEdit(command) : renderList({ ...config, commands }));
      return;
    }
    case 'cd': {
      if (!interaction.isButton()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const command = config.commands.find((candidate) => candidate.id === params[0]);
      if (!command) {
        await interaction.update(renderList(config));
        return;
      }
      await interaction.showModal(cooldownModal(command));
      return;
    }
    case 'cdmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const raw = Number.parseInt(interaction.fields.getTextInputValue('cooldown').trim(), 10);
      const cooldown = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 3600) : 0;
      const commands = patchCommand(config, params[0] ?? '', { cooldown });
      await updateCustomcommandsConfig(ctx, guildId, { commands });
      const command = commands.find((candidate) => candidate.id === params[0]);
      await interaction.update(command ? renderEdit(command) : renderList({ ...config, commands }));
      return;
    }
    case 'remove': {
      if (!interaction.isButton()) return;
      const config = await getCustomcommandsConfig(ctx, guildId);
      const commands = config.commands.filter((command) => command.id !== params[0]);
      await updateCustomcommandsConfig(ctx, guildId, { commands });
      await interaction.update(
        commands.length ? renderList({ ...config, commands }) : await renderPage(),
      );
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Commandes personnalisées ». */
export const customcommandsPanel: ConfigPanel = { render, handle };
