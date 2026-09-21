import {
  type GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { logClearAction } from './service.js';

const MAX_DELETE = 100;
const BULK_DELETE_LIMIT_MS = 14 * 86_400_000;

function botCanManageMessages(channel: GuildTextBasedChannel): boolean {
  return (
    channel.guild.members.me?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages) ??
    false
  );
}

export const clear: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription(t('modules.logs.clear.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('nombre')
        .setDescription(t('modules.logs.clear.opt.count'))
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_DELETE),
    )
    .addUserOption((option) =>
      option.setName('membre').setDescription(t('modules.logs.clear.opt.member')),
    )
    .addStringOption((option) =>
      option.setName('raison').setDescription(t('modules.logs.clear.opt.reason')).setMaxLength(300),
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
