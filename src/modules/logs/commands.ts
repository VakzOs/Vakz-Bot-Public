import {
  type EmbedBuilder,
  type GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type User,
} from 'discord.js';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Emojis, infoEmbed, listLines, rankLabel } from '../../lib/embeds.js';
import { logClearAction } from './service.js';
import { isInviteTrackingEnabled } from './config.js';
import {
  countTrackedJoins,
  inviterStats,
  lastJoinOf,
  recentlyInvitedBy,
  topInviters,
} from './invites.js';

const MAX_DELETE = 100;
const BULK_DELETE_LIMIT_MS = 14 * 86_400_000;

function botCanManageMessages(channel: GuildTextBasedChannel): boolean {
  return (
    channel.guild.members.me?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages) ??
    false
  );
}

export const clear: SlashCommand = {
  data: () =>
    new SlashCommandBuilder()
      .setName(t('modules.logs.noms.purger'))
      .setDescription(t('modules.logs.clear.description'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((option) =>
        option
          .setName(t('modules.logs.noms.nombre'))
          .setDescription(t('modules.logs.clear.opt.count'))
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(MAX_DELETE),
      )
      .addUserOption((option) =>
        option
          .setName(t('modules.logs.noms.membre'))
          .setDescription(t('modules.logs.clear.opt.member')),
      )
      .addStringOption((option) =>
        option
          .setName(t('modules.logs.noms.raison'))
          .setDescription(t('modules.logs.clear.opt.reason'))
          .setMaxLength(300),
      ),

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const channel = interaction.channel;
    if (!channel?.isTextBased() || channel.isDMBased()) {
      await interaction.reply({
        content: t('modules.logs.clear.invalidChannel'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!botCanManageMessages(channel)) {
      await interaction.reply({
        content: t('modules.logs.clear.botNoPerm'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const count = interaction.options.getInteger('nombre', true);
    const member = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    const cutoff = Date.now() - BULK_DELETE_LIMIT_MS;
    const fetched = await channel.messages.fetch({ limit: MAX_DELETE });
    const targets = fetched
      .filter((message) => !message.pinned)
      .filter((message) => message.createdTimestamp > cutoff)
      .filter((message) => !member || message.author.id === member.id)
      .first(count);

    if (targets.length === 0) {
      await interaction.editReply({ content: t('modules.logs.clear.none') });
      return;
    }

    let deleted;
    try {
      deleted = await channel.bulkDelete(targets, true);
    } catch {
      await interaction.editReply({ content: t('modules.logs.clear.failed') });
      return;
    }

    await logClearAction(ctx, interaction.guild, {
      channelId: channel.id,
      moderatorId: interaction.user.id,
      count: deleted.size,
      targetUserId: member?.id ?? null,
      reason,
    });

    await interaction.editReply({
      content: t('modules.logs.clear.done', { count: deleted.size }),
    });
  },
};

/**
 * `/invitations` — qui a fait entrer qui.
 *
 * Réservée à « Gérer le serveur » : le suivi vit dans un module de journal, et
 * savoir par qui chaque membre est arrivé n'a pas à circuler librement.
 */
export const invitations: SlashCommand = {
  data: () =>
    new SlashCommandBuilder()
      .setName(t('modules.logs.noms.invitations'))
      .setDescription(t('modules.logs.invitations.description'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addUserOption((option) =>
        option
          .setName(t('modules.logs.noms.membre'))
          .setDescription(t('modules.logs.invitations.opt.member')),
      ),

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;

    if (!(await isInviteTrackingEnabled(ctx, guildId))) {
      await interaction.reply({
        content: t('modules.logs.invitations.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = interaction.options.getUser('membre');
    await interaction.deferReply();
    await interaction.editReply({
      embeds: [
        target
          ? await memberInvitesEmbed(ctx, guildId, target)
          : await guildInvitesEmbed(ctx, guildId),
      ],
    });
  },
};

/** Le bilan d'un membre : par qui il est arrivé, et qui il a fait entrer. */
async function memberInvitesEmbed(
  ctx: BotContext,
  guildId: string,
  target: User,
): Promise<EmbedBuilder> {
  const [join, stats, recent] = await Promise.all([
    lastJoinOf(ctx, guildId, target.id),
    inviterStats(ctx, guildId, target.id),
    recentlyInvitedBy(ctx, guildId, target.id, 5),
  ]);

  const embed = infoEmbed({
    title: t('modules.logs.invitations.member.title', { user: target.username }),
    emoji: Emojis.link,
  }).setThumbnail(target.displayAvatarURL({ size: 128 }));

  embed.addFields({
    name: t('modules.logs.invitations.member.invitedBy'),
    value: join
      ? `${join.inviterId ? `<@${join.inviterId}>` : t(`modules.logs.sources.${join.source}`)} · <t:${Math.floor(join.joinedAt.getTime() / 1000)}:D>`
      : t('modules.logs.invitations.member.untracked'),
  });

  embed.addFields({
    name: t('modules.logs.invitations.member.invited'),
    value: t('modules.logs.invites.tally', { total: stats.total, present: stats.present }),
  });

  if (recent.length > 0) {
    embed.addFields({
      name: t('modules.logs.invitations.member.recent'),
      value: listLines(
        recent.map(
          (entry) =>
            `<@${entry.userId}> · <t:${Math.floor(entry.joinedAt.getTime() / 1000)}:D>${
              entry.leftAt ? ` · ${t('modules.logs.invitations.gone')}` : ''
            }`,
        ),
      ),
    });
  }

  return embed;
}

/** Le classement du serveur, quand aucun membre n'est nommé. */
async function guildInvitesEmbed(ctx: BotContext, guildId: string): Promise<EmbedBuilder> {
  const [top, tracked] = await Promise.all([
    topInviters(ctx, guildId, 10),
    countTrackedJoins(ctx, guildId),
  ]);

  if (top.length === 0) {
    return infoEmbed({
      title: t('modules.logs.invitations.top.title'),
      description: t('modules.logs.invitations.top.empty'),
      emoji: Emojis.link,
    });
  }

  const lines = top.map(
    (entry, index) =>
      `${rankLabel(index)} <@${entry.inviterId}> — ${t('modules.logs.invites.tally', {
        total: entry.total,
        present: entry.present,
      })}`,
  );

  return infoEmbed({
    title: t('modules.logs.invitations.top.title'),
    description: lines.join('\n'),
    emoji: Emojis.link,
  }).setFooter({ text: t('modules.logs.invitations.top.tracked', { count: tracked }) });
}
