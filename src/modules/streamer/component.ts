import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, getStreamerConfig } from './config.js';
import { buildButtonRow, buildStreamerEmbed } from './menu.js';

/** Gère le bouton Activer/Désactiver du panneau « Mode streameur » (`sm|toggle`). */
export const streamerComponent: ComponentHandler = {
  prefix: 'sm',
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    if (interaction.customId.split('|')[1] !== 'toggle') return;

    const guildId = interaction.guildId;
    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('modules.streamer.feedback.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await getStreamerConfig(ctx, guildId);
    if (!config.roleId) {
      await interaction.reply({
        content: t('modules.streamer.feedback.notConfigured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    const member = interaction.member;
    const role =
      guild.roles.cache.get(config.roleId) ??
      (await guild.roles.fetch(config.roleId).catch(() => null));
    if (!role) {
      await interaction.reply({
        content: t('modules.streamer.feedback.roleGone'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (
      !me ||
      !me.permissions.has(PermissionFlagsBits.ManageRoles) ||
      !me.permissions.has(PermissionFlagsBits.DeafenMembers) ||
      role.position >= me.roles.highest.position
    ) {
      await interaction.reply({
        content: t('modules.streamer.feedback.cannot'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const active = member.roles.cache.has(config.roleId);

    if (!active && !member.voice.channelId) {
      await interaction.reply({
        content: t('modules.streamer.feedback.notInVoice'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      if (!active) {
        await member.roles.add(config.roleId, 'Mode streameur');
        await member.voice.setDeaf(true, 'Mode streameur');
        if (member.voice.serverMute) {
          await member.voice.setMute(false, 'Mode streameur').catch(() => undefined);
        }
      } else {
        await member.roles.remove(config.roleId, 'Mode streameur');
        if (member.voice.channelId && member.voice.serverDeaf) {
          await member.voice.setDeaf(false, 'Mode streameur').catch(() => undefined);
        }
      }

      await interaction.update({
        embeds: [buildStreamerEmbed(config, guild)],
        components: [buildButtonRow()],
      });
      await interaction.followUp({
        content: active
          ? t('modules.streamer.feedback.disabledUser')
          : t('modules.streamer.feedback.enabledUser'),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      ctx.logger.warn(
        { err: error, userId: member.id, guildId },
        'Échec du basculement du mode streameur',
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: t('modules.streamer.feedback.error'),
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
