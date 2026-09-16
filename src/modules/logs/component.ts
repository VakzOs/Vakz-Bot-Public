import { MessageFlags, PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME } from './config.js';
import { asRollbackKind, restoreRollback, type RollbackKind } from './rollback.js';

function canRollback(member: GuildMember, kind: RollbackKind): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (kind === 'messageDelete') return member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (kind === 'channelDelete') return member.permissions.has(PermissionFlagsBits.ManageChannels);
  // `roleDelete` recrée le rôle avec son bitfield de permissions d'origine
  // (potentiellement Administrateur) : on exige donc « Gérer le serveur »,
  // déjà couvert plus haut. « Gérer les rôles » seul ne suffit pas.
  return false;
}

export const logsComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;

    const [, action, id] = interaction.customId.split('|');
    if (action !== 'rollback' || !id) return;

    if (!(await ctx.config.isEnabled(interaction.guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('errors.moduleDisabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const record = await ctx.db.logRollback.findUnique({ where: { id } });
    if (!record || record.guildId !== interaction.guildId) {
      await interaction.reply({
        content: t('modules.logs.rollback.missing'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (record.usedAt) {
      await interaction.reply({
        content: t('modules.logs.rollback.used'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const kind = asRollbackKind(record.kind);
    if (!kind) {
      await interaction.reply({
        content: t('modules.logs.rollback.unsupported'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!canRollback(interaction.member, kind)) {
      await interaction.reply({
        content: t('modules.logs.rollback.notAllowed'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await restoreRollback(
      interaction.guild,
      kind,
      record.payload,
      interaction.user.id,
    );
    if (!result.ok) {
      await interaction.editReply({ content: t(`modules.logs.rollback.${result.error}`) });
      return;
    }

    await ctx.db.logRollback.update({
      where: { id: record.id },
      data: { usedBy: interaction.user.id, usedAt: new Date() },
    });

    await interaction.message.edit({ components: [] }).catch(() => undefined);
    await interaction.editReply({ content: t('modules.logs.rollback.done') });
  },
};
