import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getAutorolesConfig } from './config.js';
import { assignAutoRoles, setVoiceRoles } from './service.js';

/** Attribue les rôles automatiques à l'arrivée d'un membre. */
export const onMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(ctx, member) {
    if (!(await ctx.config.isEnabled(member.guild.id, MODULE_NAME))) return;
    const config = await getAutorolesConfig(ctx, member.guild.id);
    const roleIds = member.user.bot ? config.botRoleIds : config.roleIds;
    await assignAutoRoles(ctx, member, roleIds);
  },
});

/**
 * Gère le rôle en vocal : attribué en rejoignant un salon vocal, retiré en
 * quittant tout salon vocal. Les simples déplacements entre salons n'y touchent
 * pas (dans les deux cas le membre reste en vocal).
 */
export const onVoiceStateUpdate = defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(ctx, oldState, newState) {
    const joined = !oldState.channelId && !!newState.channelId;
    const left = !!oldState.channelId && !newState.channelId;
    if (!joined && !left) return;

    const member = newState.member ?? oldState.member;
    if (!member) return;
    if (!(await ctx.config.isEnabled(member.guild.id, MODULE_NAME))) return;

    const config = await getAutorolesConfig(ctx, member.guild.id);
    if (config.voiceRoleIds.length === 0) return;
    await setVoiceRoles(ctx, member, config.voiceRoleIds, joined);
  },
});
