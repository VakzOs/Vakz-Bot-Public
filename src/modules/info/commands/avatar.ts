import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../../core/module.js';
import { t } from '../../../core/i18n.js';
import { infoEmbed } from '../../../lib/embeds.js';

/** `/avatar` — affiche l'avatar (en grand) d'un membre ou de soi-même. */
export const avatar: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription(t('modules.info.avatar.description'))
    .addUserOption((o) => o.setName('membre').setDescription(t('modules.info.opt.member'))),
  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const globalUrl = user.displayAvatarURL({ size: 1024 });

    const embed = infoEmbed({ title: t('modules.info.avatar.title', { user: user.tag }) })
      .setImage(globalUrl)
      .setDescription(`[${t('modules.info.avatar.link')}](${globalUrl})`);

    // Avatar spécifique au serveur, s'il diffère de l'avatar global.
    if (interaction.inCachedGuild()) {
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const serverUrl = member?.avatarURL({ size: 1024 });
      if (serverUrl && serverUrl !== globalUrl) {
        embed.setThumbnail(serverUrl);
        embed.setDescription(
          `[${t('modules.info.avatar.link')}](${globalUrl}) · [${t('modules.info.avatar.serverLink')}](${serverUrl})`,
        );
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
};
