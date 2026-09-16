import { MessageFlags } from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME } from './config.js';
import { buildGiveawayEmbed, buildJoinRow, countEntries, toggleEntry } from './service.js';

/** Gère le bouton « Participer » d'un tirage (`giveaways|join|<id>`). */
export const giveawaysComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inCachedGuild()) return;
    const [, action, id] = interaction.customId.split('|');
    if (action !== 'join' || !id) return;

    if (!(await ctx.config.isEnabled(interaction.guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('modules.giveaways.feedback.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const giveaway = await ctx.db.giveaway.findUnique({ where: { id } });
    if (!giveaway || giveaway.status !== 'active') {
      await interaction.reply({
        content: t('modules.giveaways.feedback.ended'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (giveaway.requiredRoleId && !interaction.member.roles.cache.has(giveaway.requiredRoleId)) {
      await interaction.reply({
        content: t('modules.giveaways.feedback.needRole', {
          role: `<@&${giveaway.requiredRoleId}>`,
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const joined = await toggleEntry(ctx, id, interaction.user.id);
    const count = await countEntries(ctx, id);
    await interaction.reply({
      content: joined
        ? t('modules.giveaways.feedback.joined')
        : t('modules.giveaways.feedback.left'),
      flags: MessageFlags.Ephemeral,
    });
    await interaction.message
      .edit({
        embeds: [buildGiveawayEmbed(giveaway, count)],
        components: buildJoinRow(giveaway, count),
      })
      .catch(() => undefined);
  },
};
