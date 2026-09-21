import {
  ChannelType,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type VoiceChannel,
} from 'discord.js';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { getTempRecord, postPanel, refreshPanel, transferOwnership } from './service.js';

async function ephemeral(interaction: ChatInputCommandInteraction, key: string): Promise<void> {
  await interaction.reply({ content: t(key), flags: MessageFlags.Ephemeral });
}

export const voc: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voc')
    .setDescription(t('modules.tempvoice.command.description'))
    .addSubcommand((s) => s.setName('panneau').setDescription(t('modules.tempvoice.command.panel')))
    .addSubcommand((s) =>
      s.setName('revendiquer').setDescription(t('modules.tempvoice.command.claim')),
    )
    .addSubcommand((s) =>
      s
        .setName('transferer')
        .setDescription(t('modules.tempvoice.command.transfer'))
        .addUserOption((o) =>
          o
            .setName('membre')
            .setDescription(t('modules.tempvoice.command.transferMember'))
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('nom')
        .setDescription(t('modules.tempvoice.command.rename'))
        .addStringOption((o) =>
          o
            .setName('nom')
            .setDescription(t('modules.tempvoice.command.renameValue'))
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('limite')
        .setDescription(t('modules.tempvoice.command.limit'))
        .addIntegerOption((o) =>
          o
            .setName('nombre')
            .setDescription(t('modules.tempvoice.command.limitValue'))
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99),
        ),
    ),

  async execute(interaction, ctx: BotContext) {
    if (!interaction.inCachedGuild()) return;
    const voice = interaction.member.voice.channel;
    if (!voice || voice.type !== ChannelType.GuildVoice) {
      await ephemeral(interaction, 'modules.tempvoice.command.notInVoice');
      return;
    }
    const channel = voice as VoiceChannel;
    const record = await getTempRecord(ctx, channel.id);
    if (!record) {
      await ephemeral(interaction, 'modules.tempvoice.command.notTemp');
      return;
    }

    const sub = interaction.options.getSubcommand();
    const isController =
      interaction.user.id === record.ownerId ||
      interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (sub === 'revendiquer') {
      if (channel.members.has(record.ownerId)) {
        await ephemeral(interaction, 'modules.tempvoice.control.ownerPresent');
        return;
      }
      await transferOwnership(ctx, channel, interaction.user.id);
      await refreshPanel(ctx, channel);
      await ephemeral(interaction, 'modules.tempvoice.command.claimed');
      return;
    }

    if (!isController) {
      await ephemeral(interaction, 'modules.tempvoice.control.notOwner');
      return;
    }

    switch (sub) {
      case 'panneau': {
        await postPanel(ctx, channel, record.ownerId);
        await ephemeral(interaction, 'modules.tempvoice.command.panelPosted');
        return;
      }
      case 'transferer': {
        const target = interaction.options.getUser('membre', true);
        if (!channel.members.has(target.id)) {
          await ephemeral(interaction, 'modules.tempvoice.control.transferAbsent');
          return;
        }
        await transferOwnership(ctx, channel, target.id);
        await refreshPanel(ctx, channel);
        await ephemeral(interaction, 'modules.tempvoice.command.transferred');
        return;
      }
      case 'nom': {
        const name = interaction.options.getString('nom', true).trim().slice(0, 100);
        if (name) await channel.setName(name).catch(() => undefined);
        await refreshPanel(ctx, channel);
        await ephemeral(interaction, 'modules.tempvoice.command.renamed');
        return;
      }
      case 'limite': {
        const limit = interaction.options.getInteger('nombre', true);
        await channel.setUserLimit(Math.min(99, Math.max(0, limit))).catch(() => undefined);
        await refreshPanel(ctx, channel);
        await ephemeral(interaction, 'modules.tempvoice.command.limitSet');
        return;
      }
      default:
        return;
    }
  },
};
