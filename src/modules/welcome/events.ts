import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getWelcomeConfig } from './config.js';
import { sendGreeting } from './greet.js';

/** Message d'accueil à l'arrivée d'un membre. */
export const onMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(ctx, member) {
    if (member.user.bot) return;
    if (!(await ctx.config.isEnabled(member.guild.id, MODULE_NAME))) return;
    const config = await getWelcomeConfig(ctx, member.guild.id);
    await sendGreeting(member, config.welcome, 'welcome');
  },
});

/** Message d'au revoir au départ d'un membre. */
export const onMemberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async execute(ctx, member) {
    if (member.user?.bot) return;
    if (!(await ctx.config.isEnabled(member.guild.id, MODULE_NAME))) return;
    const config = await getWelcomeConfig(ctx, member.guild.id);
    await sendGreeting(member, config.leave, 'leave');
  },
});
