import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, getRulesConfig } from './config.js';
import { logAcceptance } from './service.js';

/**
 * Gère le clic sur le bouton « J'accepte le règlement » (`rules|accept`) :
 * attribue le rôle d'accès (si configuré), enregistre l'acceptation versionnée
 * et journalise éventuellement l'évènement.
 */
export const rulesComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    if (interaction.customId.split('|')[1] !== 'accept') return;

    const guildId = interaction.guildId;
    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('modules.rules.feedback.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await getRulesConfig(ctx, guildId);
    const guild = interaction.guild;
    const member = interaction.member;

    // Vérifie l'attribution du rôle d'accès (si un rôle est configuré).
    if (config.roleId) {
      const role =
        guild.roles.cache.get(config.roleId) ??
        (await guild.roles.fetch(config.roleId).catch(() => null));
      if (!role) {
        await interaction.reply({
          content: t('modules.rules.feedback.roleGone'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      if (
        !me ||
        !me.permissions.has(PermissionFlagsBits.ManageRoles) ||
        role.position >= me.roles.highest.position
      ) {
        await interaction.reply({
          content: t('modules.rules.feedback.cannotAssign'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const existing = await ctx.db.ruleAcceptance.findUnique({
      where: { guildId_userId: { guildId, userId: member.id } },
    });
    const hasRole = config.roleId ? member.roles.cache.has(config.roleId) : true;
    const upToDate = !!existing && existing.version >= config.version && hasRole;

    if (upToDate) {
      await interaction.reply({
        content: t('modules.rules.feedback.alreadyUpToDate'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      if (config.roleId && !hasRole) await member.roles.add(config.roleId);
      await ctx.db.ruleAcceptance.upsert({
        where: { guildId_userId: { guildId, userId: member.id } },
        update: { version: config.version, acceptedAt: new Date() },
        create: { guildId, userId: member.id, version: config.version },
      });
    } catch (error) {
      ctx.logger.warn({ err: error, guildId, userId: member.id }, 'Échec acceptation règlement');
      await interaction.reply({
        content: t('modules.rules.feedback.error'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const revalidated = !!existing && existing.version < config.version;
    await interaction.reply({
      content: revalidated
        ? t('modules.rules.feedback.revalidated')
        : t('modules.rules.feedback.accepted'),
      flags: MessageFlags.Ephemeral,
    });

    // Journalisation après la réponse : un éventuel salon de logs lent ne doit
    // pas retarder l'accusé de réception de l'interaction (fenêtre de 3 s).
    await logAcceptance(ctx, guild, config, member.id);
  },
};
