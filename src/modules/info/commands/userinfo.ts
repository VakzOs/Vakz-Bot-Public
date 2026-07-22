import { SlashCommandBuilder, type GuildMember } from 'discord.js';
import type { SlashCommand } from '../../../core/module.js';
import { t } from '../../../core/i18n.js';
import { infoEmbed } from '../../../lib/embeds.js';

/** Horodatage Discord relatif + absolu, ou « — » si inconnu. */
function stamp(date: Date | null): string {
  if (!date) return '—';
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:D> (<t:${unix}:R>)`;
}

/** Liste (tronquée) des rôles d'un membre, hors @everyone. */
function roleList(member: GuildMember): string {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => `<@&${role.id}>`);
  if (roles.length === 0) return '—';
  const shown = roles.slice(0, 20).join(' ');
  return roles.length > 20 ? `${shown} … (+${roles.length - 20})` : shown;
}

/** `/userinfo` — informations sur un membre (ou soi-même). */
export const userinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription(t('modules.info.userinfo.description'))
    .addUserOption((o) => o.setName('membre').setDescription(t('modules.info.opt.member'))),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = infoEmbed({ title: t('modules.info.userinfo.title', { user: user.tag }) })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: t('modules.info.field.id'), value: `\`${user.id}\``, inline: true },
        {
          name: t('modules.info.field.bot'),
          value: user.bot ? t('modules.info.yes') : t('modules.info.no'),
          inline: true,
        },
        {
          name: t('modules.info.field.created'),
          value: stamp(user.createdAt),
          inline: false,
        },
      );

    if (member) {
      embed.addFields(
        { name: t('modules.info.field.joined'), value: stamp(member.joinedAt), inline: false },
        {
          name: t('modules.info.field.roles', { count: member.roles.cache.size - 1 }),
          value: roleList(member),
          inline: false,
        },
      );
      if (member.premiumSince) {
        embed.addFields({
          name: t('modules.info.field.boosting'),
          value: stamp(member.premiumSince),
          inline: false,
        });
      }
      if (member.displayHexColor && member.displayHexColor !== '#000000') {
        embed.setColor(member.displayHexColor);
      }
    }

    await interaction.reply({ embeds: [embed] });
  },
};
