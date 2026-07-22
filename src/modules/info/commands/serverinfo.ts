import { ChannelType, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../../core/module.js';
import { t } from '../../../core/i18n.js';
import { infoEmbed } from '../../../lib/embeds.js';

/** `/serverinfo` — informations générales sur le serveur. */
export const serverinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription(t('modules.info.serverinfo.description')),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);

    const channels = guild.channels.cache;
    const text = channels.filter(
      (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement,
    ).size;
    const voice = channels.filter(
      (c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice,
    ).size;
    const categories = channels.filter((c) => c.type === ChannelType.GuildCategory).size;

    const created = Math.floor(guild.createdTimestamp / 1000);

    const embed = infoEmbed({ title: t('modules.info.serverinfo.title', { server: guild.name }) })
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: t('modules.info.field.id'), value: `\`${guild.id}\``, inline: true },
        {
          name: t('modules.info.field.owner'),
          value: owner ? `<@${owner.id}>` : '—',
          inline: true,
        },
        {
          name: t('modules.info.field.created'),
          value: `<t:${created}:D> (<t:${created}:R>)`,
          inline: true,
        },
        {
          name: t('modules.info.field.members'),
          value: `**${guild.memberCount}**`,
          inline: true,
        },
        {
          name: t('modules.info.field.boosts'),
          value: t('modules.info.boostValue', {
            count: guild.premiumSubscriptionCount ?? 0,
            tier: guild.premiumTier,
          }),
          inline: true,
        },
        {
          name: t('modules.info.field.roles', { count: guild.roles.cache.size - 1 }),
          value: `**${guild.roles.cache.size - 1}**`,
          inline: true,
        },
        {
          name: t('modules.info.field.channels'),
          value: t('modules.info.channelValue', { text, voice, categories }),
          inline: false,
        },
        {
          name: t('modules.info.field.emojis'),
          value: `**${guild.emojis.cache.size}**`,
          inline: true,
        },
      );

    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));

    await interaction.reply({ embeds: [embed] });
  },
};
