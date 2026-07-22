import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  MODULE_NAME,
  type MessageProfile,
  type MessageprofilesConfig,
  findProfile,
  getMessageprofilesConfig,
  updateMessageprofilesConfig,
} from './config.js';

const MAX_PROFILES = 20;

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

// --- Page principale --------------------------------------------------------

function render(config: MessageprofilesConfig): { embed: EmbedBuilder; components: PanelRow[] } {
  const list = config.profiles.length
    ? config.profiles.map((profile) => `• **${profile.name}**`).join('\n')
    : t('modules.messageprofiles.panel.noProfiles');

  const embed = infoEmbed({
    title: t('modules.messageprofiles.label'),
    description: t('modules.messageprofiles.panel.intro'),
  }).addFields({ name: t('modules.messageprofiles.panel.listField'), value: list.slice(0, 1024) });

  const components: PanelRow[] = [
    row().addComponents(
      new ButtonBuilder()
        .setCustomId(panelCustomId(MODULE_NAME, 'add'))
        .setLabel(t('modules.messageprofiles.panel.add'))
        .setStyle(ButtonStyle.Success),
    ),
  ];
  if (config.profiles.length) {
    components.push(
      row().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'pick'))
          .setPlaceholder(t('modules.messageprofiles.panel.pickPlaceholder'))
          .addOptions(
            config.profiles
              .slice(0, 25)
              .map((profile) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(profile.name.slice(0, 100))
                  .setValue(profile.id),
              ),
          ),
      ),
    );
  }
  return { embed, components };
}

function renderEdit(profile: MessageProfile): { embeds: EmbedBuilder[]; components: PanelRow[] } {
  const embed = infoEmbed({
    title: t('modules.messageprofiles.panel.editTitle', { name: profile.name }),
    description: t('modules.messageprofiles.panel.editIntro'),
  }).addFields({
    name: t('modules.messageprofiles.panel.avatarField'),
    value: profile.avatarUrl || t('modules.messageprofiles.panel.avatarDefault'),
  });
  if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);

  return {
    embeds: [embed],
    components: [
      row().addComponents(
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'edit', profile.id))
          .setLabel(t('modules.messageprofiles.panel.edit'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'delete', profile.id))
          .setLabel(t('modules.messageprofiles.panel.delete'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(panelCustomId(MODULE_NAME, 'home'))
          .setLabel(t('modules.messageprofiles.panel.back'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function profileModal(action: string, profile?: MessageProfile): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, action, profile?.id ?? ''))
    .setTitle(t('modules.messageprofiles.panel.modalTitle'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel(t('modules.messageprofiles.panel.nameField'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true)
          .setValue(profile?.name ?? ''),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('avatar')
          .setLabel(t('modules.messageprofiles.panel.avatarInput'))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(500)
          .setRequired(false)
          .setValue(profile?.avatarUrl ?? '')
          .setPlaceholder('https://…'),
      ),
    );
}

// --- Routeur ----------------------------------------------------------------

async function showEdit(
  interaction: PanelHandlerArgs['interaction'],
  ctx: BotContext,
  guildId: string,
  profileId: string,
): Promise<void> {
  const config = await getMessageprofilesConfig(ctx, guildId);
  const profile = findProfile(config, profileId);
  const view = profile ? renderEdit(profile) : render(config);
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
    case 'home': {
      if (!interaction.isButton()) return;
      await interaction.update(await renderPage());
      return;
    }
    case 'add': {
      if (!interaction.isButton()) return;
      const config = await getMessageprofilesConfig(ctx, guildId);
      if (config.profiles.length >= MAX_PROFILES) {
        await interaction.reply({
          content: t('modules.messageprofiles.panel.tooMany', { max: MAX_PROFILES }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(profileModal('addmodal'));
      return;
    }
    case 'addmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const name = interaction.fields.getTextInputValue('name').trim();
      if (!name) {
        await interaction.update(await renderPage());
        return;
      }
      const config = await getMessageprofilesConfig(ctx, guildId);
      const profiles = [
        ...config.profiles,
        {
          id: randomUUID().slice(0, 8),
          name,
          avatarUrl: interaction.fields.getTextInputValue('avatar').trim(),
        },
      ];
      await updateMessageprofilesConfig(ctx, guildId, { profiles });
      await interaction.update(await renderPage());
      return;
    }
    case 'pick': {
      if (!interaction.isStringSelectMenu()) return;
      const profileId = interaction.values[0];
      if (!profileId) return;
      await showEdit(interaction, ctx, guildId, profileId);
      return;
    }
    case 'edit': {
      if (!interaction.isButton()) return;
      const profileId = params[0];
      if (!profileId) return;
      const config = await getMessageprofilesConfig(ctx, guildId);
      const profile = findProfile(config, profileId);
      if (!profile) return;
      await interaction.showModal(profileModal('editmodal', profile));
      return;
    }
    case 'editmodal': {
      if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
      const profileId = params[0];
      if (!profileId) return;
      const config = await getMessageprofilesConfig(ctx, guildId);
      const name = interaction.fields.getTextInputValue('name').trim();
      const avatarUrl = interaction.fields.getTextInputValue('avatar').trim();
      const profiles = config.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, name: name || profile.name, avatarUrl } : profile,
      );
      await updateMessageprofilesConfig(ctx, guildId, { profiles });
      await showEdit(interaction, ctx, guildId, profileId);
      return;
    }
    case 'delete': {
      if (!interaction.isButton()) return;
      const config = await getMessageprofilesConfig(ctx, guildId);
      const profiles = config.profiles.filter((profile) => profile.id !== params[0]);
      await updateMessageprofilesConfig(ctx, guildId, { profiles });
      await interaction.update(await renderPage());
      return;
    }
    default:
      return;
  }
}

/** Panneau de configuration interactif du module « Profils de messages ». */
export const messageprofilesPanel: ConfigPanel = {
  render: async (ctx, guildId) => render(await getMessageprofilesConfig(ctx, guildId)),
  handle,
};
