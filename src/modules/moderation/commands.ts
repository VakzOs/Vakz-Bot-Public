import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { formatDuration, parseDuration } from '../../lib/duration.js';
import { getHistory, notifyUser, recordSanction, targetError } from './service.js';

const MAX_TIMEOUT_MS = 28 * 86_400_000;

type CachedInteraction = ChatInputCommandInteraction<'cached'>;

function botLacks(interaction: CachedInteraction, permission: bigint): boolean {
  return !interaction.guild.members.me?.permissions.has(permission);
}

async function ephemeral(interaction: CachedInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** `/warn` — avertit un membre (enregistré, journalisé, MP optionnel). */
export const warn: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription(t('modules.moderation.commands.warn.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.moderation.opt.member')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription(t('modules.moderation.opt.reason')).setMaxLength(500),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return ephemeral(interaction, t('modules.moderation.notInGuild'));

    const issue = targetError(interaction.guild, interaction.user.id, target);
    if (issue) return ephemeral(interaction, t(`modules.moderation.targetError.${issue}`));

    await notifyUser(ctx, interaction.guild, user, 'warn', reason);
    await recordSanction(ctx, interaction.guild, {
      type: 'warn',
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
    await interaction.reply({
      content: t('modules.moderation.result.warn', { user: `<@${user.id}>` }),
    });
  },
};

/** `/kick` — expulse un membre. */
export const kick: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription(t('modules.moderation.commands.kick.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.moderation.opt.member')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription(t('modules.moderation.opt.reason')).setMaxLength(500),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return ephemeral(interaction, t('modules.moderation.notInGuild'));

    const issue = targetError(interaction.guild, interaction.user.id, target);
    if (issue) return ephemeral(interaction, t(`modules.moderation.targetError.${issue}`));
    if (botLacks(interaction, PermissionFlagsBits.KickMembers)) {
      return ephemeral(interaction, t('modules.moderation.botNoPerm'));
    }

    await notifyUser(ctx, interaction.guild, user, 'kick', reason);
    try {
      await target.kick(reason ?? undefined);
    } catch {
      return ephemeral(interaction, t('modules.moderation.actionFailed'));
    }
    await recordSanction(ctx, interaction.guild, {
      type: 'kick',
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
    await interaction.reply({
      content: t('modules.moderation.result.kick', { user: `**${user.tag}**` }),
    });
  },
};

/** `/ban` — bannit un membre (ou un utilisateur par son ID). */
export const ban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription(t('modules.moderation.commands.ban.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.moderation.opt.member')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription(t('modules.moderation.opt.reason')).setMaxLength(500),
    )
    .addIntegerOption((o) =>
      o
        .setName('jours_messages')
        .setDescription(t('modules.moderation.opt.deleteDays'))
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison');
    const deleteDays = interaction.options.getInteger('jours_messages') ?? 0;

    if (botLacks(interaction, PermissionFlagsBits.BanMembers)) {
      return ephemeral(interaction, t('modules.moderation.botNoPerm'));
    }

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (target) {
      const issue = targetError(interaction.guild, interaction.user.id, target);
      if (issue) return ephemeral(interaction, t(`modules.moderation.targetError.${issue}`));
    }

    await notifyUser(ctx, interaction.guild, user, 'ban', reason);
    try {
      await interaction.guild.members.ban(user.id, {
        reason: reason ?? undefined,
        deleteMessageSeconds: deleteDays * 86_400,
      });
    } catch {
      return ephemeral(interaction, t('modules.moderation.actionFailed'));
    }
    await recordSanction(ctx, interaction.guild, {
      type: 'ban',
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
    await interaction.reply({
      content: t('modules.moderation.result.ban', { user: `**${user.tag}**` }),
    });
  },
};

/** `/unban` — lève le bannissement d'un utilisateur (par son ID). */
export const unban: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription(t('modules.moderation.commands.unban.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) =>
      o.setName('utilisateur').setDescription(t('modules.moderation.opt.userId')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription(t('modules.moderation.opt.reason')).setMaxLength(500),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const userId = interaction.options.getString('utilisateur', true).trim();
    const reason = interaction.options.getString('raison');

    if (!/^\d{17,20}$/.test(userId)) {
      return ephemeral(interaction, t('modules.moderation.invalidUserId'));
    }
    if (botLacks(interaction, PermissionFlagsBits.BanMembers)) {
      return ephemeral(interaction, t('modules.moderation.botNoPerm'));
    }

    try {
      await interaction.guild.bans.remove(userId, reason ?? undefined);
    } catch {
      return ephemeral(interaction, t('modules.moderation.notBanned'));
    }
    await recordSanction(ctx, interaction.guild, {
      type: 'unban',
      userId,
      moderatorId: interaction.user.id,
      reason,
    });
    await interaction.reply({ content: t('modules.moderation.result.unban', { user: `<@${userId}>` }) });
  },
};

/** `/timeout` — réduit un membre au silence pour une durée (ex. 10m, 1h, 1j). */
export const timeout: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription(t('modules.moderation.commands.timeout.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.moderation.opt.member')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('duree').setDescription(t('modules.moderation.opt.duration')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription(t('modules.moderation.opt.reason')).setMaxLength(500),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison');
    const durationInput = interaction.options.getString('duree', true);

    const parsed = parseDuration(durationInput);
    if (parsed === null) return ephemeral(interaction, t('modules.moderation.invalidDuration'));
    const durationMs = Math.min(parsed, MAX_TIMEOUT_MS);

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return ephemeral(interaction, t('modules.moderation.notInGuild'));

    const issue = targetError(interaction.guild, interaction.user.id, target);
    if (issue) return ephemeral(interaction, t(`modules.moderation.targetError.${issue}`));
    if (botLacks(interaction, PermissionFlagsBits.ModerateMembers)) {
      return ephemeral(interaction, t('modules.moderation.botNoPerm'));
    }

    const expiresAt = new Date(Date.now() + durationMs);
    await notifyUser(ctx, interaction.guild, user, 'timeout', reason, expiresAt);
    try {
      await target.timeout(durationMs, reason ?? undefined);
    } catch {
      return ephemeral(interaction, t('modules.moderation.actionFailed'));
    }
    await recordSanction(ctx, interaction.guild, {
      type: 'timeout',
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt,
    });
    await interaction.reply({
      content: t('modules.moderation.result.timeout', {
        user: `<@${user.id}>`,
        duration: formatDuration(durationMs),
      }),
    });
  },
};

/** `/untimeout` — lève le silence d'un membre. */
export const untimeout: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription(t('modules.moderation.commands.untimeout.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.moderation.opt.member')).setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('raison').setDescription(t('modules.moderation.opt.reason')).setMaxLength(500),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target) return ephemeral(interaction, t('modules.moderation.notInGuild'));

    try {
      await target.timeout(null, reason ?? undefined);
    } catch {
      return ephemeral(interaction, t('modules.moderation.actionFailed'));
    }
    await recordSanction(ctx, interaction.guild, {
      type: 'untimeout',
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
    await interaction.reply({
      content: t('modules.moderation.result.untimeout', { user: `<@${user.id}>` }),
    });
  },
};

/** `/historique` — affiche le casier d'un membre. */
export const historique: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('historique')
    .setDescription(t('modules.moderation.commands.history.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('membre').setDescription(t('modules.moderation.opt.member')).setRequired(true),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre', true);
    const rows = await getHistory(ctx, interaction.guildId, user.id);

    if (rows.length === 0) {
      return ephemeral(interaction, t('modules.moderation.history.empty', { user: `<@${user.id}>` }));
    }

    const lines = rows.map((row) => {
      const date = `<t:${Math.floor(row.createdAt.getTime() / 1000)}:d>`;
      const reason = row.reason || t('modules.moderation.log.noReason');
      return `**${t(`modules.moderation.types.${row.type}`)}** · ${date} · <@${row.moderatorId}>\n${reason}`;
    });

    const embed = infoEmbed({
      title: t('modules.moderation.history.title', { user: user.tag }),
      description: lines.join('\n\n').slice(0, 4000),
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export const moderationCommands: SlashCommand[] = [
  warn,
  kick,
  ban,
  unban,
  timeout,
  untimeout,
  historique,
];
