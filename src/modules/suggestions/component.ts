import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME, getSuggestionsConfig } from './config.js';
import {
  buildComponents,
  buildSuggestionEmbed,
  getVotes,
  grantSuggestionReward,
  isGameProposal,
  isStaff,
  recordVote,
} from './service.js';

const STATUS_BY_ACTION: Record<string, 'approved' | 'rejected' | 'considered'> = {
  approve: 'approved',
  reject: 'rejected',
  consider: 'considered',
};

/**
 * Gère les boutons d'une suggestion (`suggestions|<action>|<id>`) : votes 👍/👎
 * (en place) et décisions du staff (approuver / refuser / à l'étude) via un
 * modal de raison optionnelle.
 */
export const suggestionsComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const guildId = interaction.guildId;
    const parts = interaction.customId.split('|');
    const action = parts[1] ?? '';

    if (!(await ctx.config.isEnabled(guildId, MODULE_NAME))) {
      await interaction.reply({
        content: t('modules.suggestions.feedback.disabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await getSuggestionsConfig(ctx, guildId);

    // Vote 👍 / 👎 : mise à jour du message en place.
    if ((action === 'up' || action === 'down') && interaction.isButton()) {
      const id = parts[2];
      if (!id) return;
      const record = await ctx.db.suggestion.findUnique({ where: { id } });
      if (!record) {
        await interaction.reply({
          content: t('modules.suggestions.feedback.gone'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await recordVote(ctx, id, interaction.user.id, action);
      const votes = await getVotes(ctx, id);
      await interaction.update({
        embeds: [buildSuggestionEmbed(record, votes, { dynamicColor: config.dynamicColor })],
        components: buildComponents(id, votes, isGameProposal(record)),
      });
      return;
    }

    // Action staff : ouvre un modal de décision (raison optionnelle).
    if (
      (action === 'approve' || action === 'reject' || action === 'consider') &&
      interaction.isButton()
    ) {
      const id = parts[2];
      if (!id) return;
      if (!isStaff(interaction.member, config)) {
        await interaction.reply({
          content: t('modules.suggestions.feedback.staffOnly'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const status = STATUS_BY_ACTION[action];
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`${MODULE_NAME}|decide|${status}|${id}`)
          .setTitle(t(`modules.suggestions.modal.${action}`))
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(t('modules.suggestions.modal.reasonField'))
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(false),
            ),
          ),
      );
      return;
    }

    // Soumission du modal de décision.
    if (action === 'decide' && interaction.isModalSubmit()) {
      const status = parts[2];
      const id = parts[3];
      if (!status || !id) return;
      if (!isStaff(interaction.member, config)) {
        await interaction.reply({
          content: t('modules.suggestions.feedback.staffOnly'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const reason = interaction.fields.getTextInputValue('reason').trim();
      const before = await ctx.db.suggestion.findUnique({ where: { id } });
      const record = await ctx.db.suggestion
        .update({
          where: { id },
          data: { status, decidedBy: interaction.user.id, reason: reason || null },
        })
        .catch(() => null);
      if (!record) {
        await interaction.reply({
          content: t('modules.suggestions.feedback.gone'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Récompense l'auteur à la première approbation (pas de double-récompense).
      let rewardText: string | null = null;
      if (status === 'approved' && before?.status !== 'approved') {
        rewardText = await grantSuggestionReward(ctx, guildId, record.authorId, config);
      }

      const votes = await getVotes(ctx, id);
      if (record.messageId) {
        const channel = await interaction.guild.channels.fetch(record.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(record.messageId).catch(() => null);
          await message
            ?.edit({
              embeds: [buildSuggestionEmbed(record, votes, { dynamicColor: config.dynamicColor })],
              components: buildComponents(id, votes, isGameProposal(record)),
            })
            .catch(() => undefined);
        }
      }

      const decided = t('modules.suggestions.feedback.decided', {
        status: t(`modules.suggestions.status.${status}`),
      });
      await interaction.reply({
        content: rewardText
          ? `${decided}\n${t('modules.suggestions.reward.granted', { reward: rewardText })}`
          : decided,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
