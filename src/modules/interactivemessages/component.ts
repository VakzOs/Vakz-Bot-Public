import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { BotContext, ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME } from './config.js';

const REASON = 'Message interactif : bouton de rôle';

/**
 * Gestionnaire des boutons publiés dans un message interactif. Seuls les boutons
 * de rôle ont un `customId` (`interactivemessages|role|<roleId>`) : un clic
 * ajoute ou retire le rôle. Les boutons lien sont gérés nativement par Discord.
 */
export const interactiveMessagesComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx: BotContext) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    const [, kind, roleId] = interaction.customId.split('|');
    if (kind !== 'role' || !roleId) return;

    const reply = (key: string, vars?: Record<string, string | number>) =>
      interaction.reply({ content: t(key, vars), flags: MessageFlags.Ephemeral });

    if (!(await ctx.config.isEnabled(interaction.guildId, MODULE_NAME))) {
      await reply('modules.interactivemessages.feedback.disabled');
      return;
    }

    const guild = interaction.guild;
    const role =
      guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      await reply('modules.interactivemessages.feedback.roleGone');
      return;
    }

    const me = guild.members.me;
    if (
      !me ||
      !me.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.position >= me.roles.highest.position
    ) {
      await reply('modules.interactivemessages.feedback.cannotAssign');
      return;
    }

    const member = interaction.member;
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, REASON);
        await reply('modules.interactivemessages.feedback.removed', { role: `<@&${roleId}>` });
      } else {
        await member.roles.add(roleId, REASON);
        await reply('modules.interactivemessages.feedback.added', { role: `<@&${roleId}>` });
      }
    } catch (error) {
      ctx.logger.warn({ err: error, roleId }, 'Message interactif : échec du toggle de rôle');
      await reply('modules.interactivemessages.feedback.error');
    }
  },
};
