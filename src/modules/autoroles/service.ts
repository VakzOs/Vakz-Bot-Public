import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { BotContext } from '../../core/module.js';

/**
 * Attribue une liste de rôles à un membre, en respectant la permission
 * « Gérer les rôles » et la hiérarchie. Journalise les rôles ignorés.
 */
export async function assignAutoRoles(
  ctx: BotContext,
  member: GuildMember,
  roleIds: string[],
): Promise<void> {
  if (roleIds.length === 0) return;

  const me = member.guild.members.me ?? (await member.guild.members.fetchMe().catch(() => null));
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    ctx.logger.warn(
      { guildId: member.guild.id },
      'Rôles auto : permission « Gérer les rôles » manquante pour le bot',
    );
    return;
  }

  const botHighest = me.roles.highest.position;
  const toAdd: string[] = [];
  for (const roleId of roleIds) {
    if (member.roles.cache.has(roleId)) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role) continue;
    if (role.position >= botHighest) {
      ctx.logger.warn(
        { guildId: member.guild.id, role: role.name },
        'Rôle auto au-dessus du rôle du bot : ignoré',
      );
      continue;
    }
    toAdd.push(roleId);
  }

  if (toAdd.length === 0) return;
  try {
    await member.roles.add(toAdd);
  } catch (error) {
    ctx.logger.warn({ err: error, guildId: member.guild.id }, 'Échec d’attribution de rôles auto');
  }
}

/**
 * Ajoute (`present = true`) ou retire (`present = false`) des rôles à un membre,
 * en respectant « Gérer les rôles » et la hiérarchie. Utilisé pour le rôle en
 * vocal (attribué à l'entrée, retiré à la sortie).
 */
export async function setVoiceRoles(
  ctx: BotContext,
  member: GuildMember,
  roleIds: string[],
  present: boolean,
): Promise<void> {
  if (roleIds.length === 0) return;

  const me = member.guild.members.me ?? (await member.guild.members.fetchMe().catch(() => null));
  if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles)) return;

  const botHighest = me.roles.highest.position;
  const targets = roleIds.filter((roleId) => {
    const role = member.guild.roles.cache.get(roleId);
    if (!role || role.position >= botHighest) return false;
    return present ? !member.roles.cache.has(roleId) : member.roles.cache.has(roleId);
  });
  if (targets.length === 0) return;

  try {
    if (present) await member.roles.add(targets);
    else await member.roles.remove(targets);
  } catch (error) {
    ctx.logger.warn({ err: error, guildId: member.guild.id }, 'Échec du rôle en vocal');
  }
}
