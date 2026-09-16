import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { findProfile, getMessageprofilesConfig } from './config.js';
import { sayAsProfile } from './service.js';

/** `/dire` — publie un message sous l'identité d'un profil configuré (staff). */
export const dire: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('dire')
    .setDescription(t('modules.messageprofiles.command.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) =>
      o
        .setName('profil')
        .setDescription(t('modules.messageprofiles.command.profileOpt'))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription(t('modules.messageprofiles.command.messageOpt'))
        .setRequired(true)
        .setMaxLength(2000),
    )
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription(t('modules.messageprofiles.command.channelOpt'))
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        ),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const config = await getMessageprofilesConfig(ctx, interaction.guildId);
    const profile = findProfile(config, interaction.options.getString('profil', true));
    if (!profile) {
      await interaction.reply({
        content: t('modules.messageprofiles.command.unknownProfile'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({
        content: t('modules.messageprofiles.command.badChannel'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = interaction.options.getString('message', true);
    const result = await sayAsProfile(ctx, channel, profile, message);
    await interaction.editReply({
      content: t(`modules.messageprofiles.command.result.${result}`, {
        channel: `<#${channel.id}>`,
        name: profile.name,
      }),
    });
  },
  async autocomplete(interaction, ctx) {
    if (!interaction.inCachedGuild()) {
      await interaction.respond([]);
      return;
    }
    const config = await getMessageprofilesConfig(ctx, interaction.guildId);
    const query = interaction.options.getFocused().toLowerCase();
    const choices = config.profiles
      .filter((profile) => profile.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((profile) => ({ name: profile.name.slice(0, 100), value: profile.id }));
    await interaction.respond(choices);
  },
};

export const messageprofilesCommands: SlashCommand[] = [dire];
