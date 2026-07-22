import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../../core/module.js';
import { t } from '../../../core/i18n.js';
import { infoEmbed } from '../../../lib/embeds.js';

/** `/roleinfo` — informations sur un rôle. */
export const roleinfo: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription(t('modules.info.roleinfo.description'))
    .addRoleOption((o) =>
      o.setName('role').setDescription(t('modules.info.opt.role')).setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const role = interaction.options.getRole('role');
    if (!role) return;

    const created = Math.floor(role.createdTimestamp / 1000);
    const yes = t('modules.info.yes');
    const no = t('modules.info.no');
    const permissions = role.permissions.has(PermissionFlagsBits.Administrator)
      ? t('modules.info.roleinfo.admin')
      : t('modules.info.roleinfo.permCount', { count: role.permissions.toArray().length });

    const embed = infoEmbed({ title: t('modules.info.roleinfo.title', { role: role.name }) })
      .setColor(role.color || null)
      .addFields(
        { name: t('modules.info.field.id'), value: `\`${role.id}\``, inline: true },
        {
          name: t('modules.info.field.color'),
          value: `\`${role.hexColor}\``,
          inline: true,
        },
        { name: t('modules.info.field.members'), value: `**${role.members.size}**`, inline: true },
        {
          name: t('modules.info.field.position'),
          value: `**${role.position}**`,
          inline: true,
        },
        { name: t('modules.info.roleinfo.hoisted'), value: role.hoist ? yes : no, inline: true },
        {
          name: t('modules.info.roleinfo.mentionable'),
          value: role.mentionable ? yes : no,
          inline: true,
        },
        {
          name: t('modules.info.roleinfo.managed'),
          value: role.managed ? yes : no,
          inline: true,
        },
        {
          name: t('modules.info.field.created'),
          value: `<t:${created}:D> (<t:${created}:R>)`,
          inline: true,
        },
        { name: t('modules.info.roleinfo.permissions'), value: permissions, inline: false },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
