import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Emojis, infoEmbed, rankLabel } from '../../lib/embeds.js';
import { getSuggestionsConfig, MODULE_NAME, memberLimit } from './config.js';
import {
  buildComponents,
  buildSuggestionEmbed,
  countPending,
  searchSuggestions,
  suggestionLink,
  topSuggestions,
} from './service.js';
import { extractAppId, fetchSteamGame, gameToMetadata, type SteamGame } from './steam.js';

/** `/suggestion` — soumettre une suggestion (avec lien Steam optionnel). */
export const suggestion: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription(t('modules.suggestions.command.description'))
    .addStringOption((o) =>
      o
        .setName('texte')
        .setDescription(t('modules.suggestions.command.textOpt'))
        .setRequired(true)
        .setMaxLength(1000),
    )
    .addStringOption((o) =>
      o
        .setName('steam')
        .setDescription(t('modules.suggestions.command.steamOpt'))
        .setMaxLength(200),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const config = await getSuggestionsConfig(ctx, guildId);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (config.channelIds.length === 0) {
      await interaction.editReply({ content: t('modules.suggestions.notConfigured') });
      return;
    }

    if (!config.channelIds.includes(interaction.channelId)) {
      await interaction.editReply({
        content: t('modules.suggestions.wrongChannel', {
          channels: config.channelIds.map((id) => `<#${id}>`).join(', '),
        }),
      });
      return;
    }

    const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({ content: t('modules.suggestions.channelGone') });
      return;
    }

    // Limite de suggestions en attente (par membre / par rôle).
    const limit = memberLimit(config, interaction.member);
    if (limit > 0) {
      const pending = await countPending(ctx, guildId, interaction.user.id);
      if (pending >= limit) {
        await interaction.editReply({
          content: t('modules.suggestions.limitReached', { max: limit }),
        });
        return;
      }
    }

    // Lien Steam optionnel : on enrichit la suggestion avec les infos du jeu.
    let metadata: string | null = null;
    let game: SteamGame | null = null;
    const steamLink = interaction.options.getString('steam');
    if (steamLink) {
      const appId = extractAppId(steamLink);
      if (!appId) {
        await interaction.editReply({ content: t('modules.suggestions.invalidSteam') });
        return;
      }
      game = await fetchSteamGame(appId);
      if (!game) {
        await interaction.editReply({ content: t('modules.suggestions.steamFetchFailed') });
        return;
      }
      metadata = gameToMetadata(game);
    }

    const text = interaction.options.getString('texte', true).trim();
    const record = await ctx.db.suggestion.create({
      data: {
        guildId,
        channelId: interaction.channelId,
        authorId: interaction.user.id,
        content: text,
        metadata,
      },
    });

    try {
      const sent = await channel.send({
        embeds: [
          buildSuggestionEmbed(record, { up: [], down: [] }, { dynamicColor: config.dynamicColor }),
        ],
        components: buildComponents(record.id, { up: [], down: [] }, metadata !== null),
      });
      await ctx.db.suggestion.update({ where: { id: record.id }, data: { messageId: sent.id } });

      if (config.createThread && channel.type === ChannelType.GuildText) {
        // Le fil reprend le nom du jeu (proposition) ou le texte de la suggestion.
        const threadName = (game?.name ?? text).slice(0, 100) || 'Suggestion';
        await sent.startThread({ name: threadName }).catch(() => undefined);
      }

      await interaction.editReply({
        content: t('modules.suggestions.submitted', { url: sent.url }),
      });
    } catch (error) {
      await ctx.db.suggestion.delete({ where: { id: record.id } }).catch(() => undefined);
      ctx.logger.warn({ err: error, guildId, module: MODULE_NAME }, 'Envoi de suggestion échoué');
      await interaction.editReply({ content: t('modules.suggestions.sendError') });
    }
  },
};

function truncate(value: string, max = 80): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** `/suggestions classement|rechercher` — classement et recherche des suggestions. */
export const suggestionsList: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('suggestions')
    .setDescription(t('modules.suggestions.list.description'))
    .addSubcommand((s) =>
      s.setName('classement').setDescription(t('modules.suggestions.list.rankingDescription')),
    )
    .addSubcommand((s) =>
      s
        .setName('rechercher')
        .setDescription(t('modules.suggestions.list.searchDescription'))
        .addStringOption((o) =>
          o
            .setName('mot')
            .setDescription(t('modules.suggestions.list.keywordOpt'))
            .setRequired(true)
            .setMaxLength(100),
        ),
    ),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'classement') {
      const top = await topSuggestions(ctx, guildId, 10);
      if (top.length === 0) {
        await interaction.reply({
          content: t('modules.suggestions.list.empty'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const lines = top.map((entry, index) => {
        const link = suggestionLink(guildId, entry.suggestion);
        const label = truncate(entry.suggestion.content);
        const text = link ? `[${label}](${link})` : label;
        return `${rankLabel(index)} ${text} — 👍 ${entry.up} · 👎 ${entry.down}`;
      });
      const embed = infoEmbed({
        title: t('modules.suggestions.list.rankingTitle'),
        description: lines.join('\n'),
        emoji: Emojis.trophy,
      });
      await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }

    // sub === 'rechercher'
    const keyword = interaction.options.getString('mot', true).trim();
    const results = await searchSuggestions(ctx, guildId, keyword, 10);
    if (results.length === 0) {
      await interaction.reply({
        content: t('modules.suggestions.list.noMatch', { keyword }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = results.map((record) => {
      const link = suggestionLink(guildId, record);
      const label = truncate(record.content);
      const status = t(`modules.suggestions.status.${record.status}`);
      const text = link ? `[${label}](${link})` : label;
      return `• ${text} — *${status}*`;
    });
    const embed = infoEmbed({
      title: t('modules.suggestions.list.searchTitle', { keyword: truncate(keyword, 40) }),
      description: lines.join('\n'),
      emoji: Emojis.search,
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
