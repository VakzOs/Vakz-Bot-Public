import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import type { Suggestion } from '@prisma/client';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, withEmoji } from '../../lib/embeds.js';
import { addBalance } from '../economy/service.js';
import { addToInventory, getItem } from '../items/service.js';
import { MODULE_NAME, type SuggestionsConfig } from './config.js';
import { parseGameMetadata } from './steam.js';

export type VoteValue = 'up' | 'down';

/** Listes des votants pour/contre une suggestion. */
export interface VoteState {
  up: string[];
  down: string[];
}

const STATUS_COLORS: Record<string, number> = {
  pending: Colors.info,
  approved: Colors.success,
  rejected: Colors.error,
  considered: Colors.warning,
};

const MAX_VOTERS_SHOWN = 25;

/** Une suggestion accompagnée d'un lien Steam est une « proposition de jeu ». */
export function isGameProposal(suggestion: Suggestion): boolean {
  return parseGameMetadata(suggestion.metadata) !== null;
}

function formatVoters(ids: string[]): string {
  if (ids.length === 0) return '—';
  const shown = ids
    .slice(0, MAX_VOTERS_SHOWN)
    .map((id) => `<@${id}>`)
    .join(' ');
  return ids.length > MAX_VOTERS_SHOWN ? `${shown} … (+${ids.length - MAX_VOTERS_SHOWN})` : shown;
}

/** Couleur d'un embed selon l'orientation des votes (vert positif, rouge négatif). */
function dynamicVoteColor(votes: VoteState): number {
  const total = votes.up.length + votes.down.length;
  if (total === 0) return Colors.info;
  const ratio = votes.up.length / total;
  if (ratio >= 0.66) return Colors.success;
  if (ratio <= 0.34) return Colors.error;
  return Colors.warning;
}

/** Embed d'une suggestion. Les propositions de jeu listent les votants et n'ont
 * pas de statut/validation ; les suggestions standard gardent statut + décision. */
export function buildSuggestionEmbed(
  suggestion: Suggestion,
  votes: VoteState,
  options: { dynamicColor?: boolean } = {},
): EmbedBuilder {
  const game = parseGameMetadata(suggestion.metadata);
  const embed = new EmbedBuilder()
    .setTitle(withEmoji(t('modules.suggestions.embed.title'), Emojis.tip))
    .setDescription(suggestion.content)
    .setFooter({ text: t('modules.suggestions.embed.footer', { id: suggestion.id.slice(0, 8) }) })
    .setTimestamp(suggestion.createdAt);

  if (game) {
    embed.setColor(Colors.brand);
    if (game.image) embed.setImage(game.image);
    const price = game.isFree
      ? t('modules.suggestions.steam.free')
      : (game.price ?? t('modules.suggestions.steam.unknownPrice'));
    embed.addFields({
      name: t('modules.suggestions.steam.gameField'),
      value: `**[${game.name}](${game.url})** — ${price}`,
    });
    if (game.description) {
      embed.addFields({
        name: t('modules.suggestions.steam.aboutField'),
        value: game.description.slice(0, 300),
      });
    }
    embed.addFields(
      {
        name: t('modules.suggestions.embed.author'),
        value: `<@${suggestion.authorId}>`,
      },
      {
        name: t('modules.suggestions.embed.votesFor', { count: votes.up.length }),
        value: formatVoters(votes.up),
        inline: true,
      },
      {
        name: t('modules.suggestions.embed.votesAgainst', { count: votes.down.length }),
        value: formatVoters(votes.down),
        inline: true,
      },
    );
    return embed;
  }

  const color =
    options.dynamicColor && suggestion.status === 'pending'
      ? dynamicVoteColor(votes)
      : (STATUS_COLORS[suggestion.status] ?? Colors.info);
  embed.setColor(color).addFields(
    {
      name: t('modules.suggestions.embed.author'),
      value: `<@${suggestion.authorId}>`,
      inline: true,
    },
    {
      name: t('modules.suggestions.embed.status'),
      value: t(`modules.suggestions.status.${suggestion.status}`),
      inline: true,
    },
    {
      name: t('modules.suggestions.embed.votes'),
      value: `👍 ${votes.up.length} · 👎 ${votes.down.length}`,
      inline: true,
    },
  );

  if (suggestion.decidedBy) {
    const reason = suggestion.reason?.trim();
    embed.addFields({
      name: t('modules.suggestions.embed.decision'),
      value: t('modules.suggestions.embed.decisionValue', {
        moderator: `<@${suggestion.decidedBy}>`,
        reason: reason && reason.length > 0 ? reason : t('modules.suggestions.embed.noReason'),
      }),
    });
  }
  return embed;
}

/**
 * Rangées de boutons : votes 👍/👎 (toujours), et — uniquement pour une
 * suggestion standard — les actions staff (approuver/refuser/à l'étude).
 */
export function buildComponents(
  id: string,
  votes: VoteState,
  isGame: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const voteRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|up|${id}`)
      .setLabel(`👍 ${votes.up.length}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|down|${id}`)
      .setLabel(`👎 ${votes.down.length}`)
      .setStyle(ButtonStyle.Danger),
  );
  if (isGame) return [voteRow];

  const staffRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|approve|${id}`)
      .setLabel(t('modules.suggestions.button.approve'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|reject|${id}`)
      .setLabel(t('modules.suggestions.button.reject'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${MODULE_NAME}|consider|${id}`)
      .setLabel(t('modules.suggestions.button.consider'))
      .setStyle(ButtonStyle.Secondary),
  );
  return [voteRow, staffRow];
}

/** Récupère les listes de votants (pour/contre) d'une suggestion. */
export async function getVotes(ctx: BotContext, suggestionId: string): Promise<VoteState> {
  const rows = await ctx.db.suggestionVote.findMany({ where: { suggestionId } });
  const state: VoteState = { up: [], down: [] };
  for (const row of rows) {
    (row.value === 'up' ? state.up : state.down).push(row.userId);
  }
  return state;
}

/** Enregistre/bascule le vote d'un membre (un seul vote par membre, annulable). */
export async function recordVote(
  ctx: BotContext,
  suggestionId: string,
  userId: string,
  value: VoteValue,
): Promise<void> {
  const existing = await ctx.db.suggestionVote.findUnique({
    where: { suggestionId_userId: { suggestionId, userId } },
  });
  if (!existing) {
    await ctx.db.suggestionVote.create({ data: { suggestionId, userId, value } });
  } else if (existing.value === value) {
    await ctx.db.suggestionVote.delete({ where: { id: existing.id } });
  } else {
    await ctx.db.suggestionVote.update({ where: { id: existing.id }, data: { value } });
  }
}

/** Indique si un membre peut statuer sur les suggestions (staff). */
export function isStaff(member: GuildMember, config: SuggestionsConfig): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return !!config.staffRoleId && member.roles.cache.has(config.staffRoleId);
}

/** Nombre de suggestions en attente d'un membre (pour la limite). */
export function countPending(ctx: BotContext, guildId: string, authorId: string): Promise<number> {
  return ctx.db.suggestion.count({ where: { guildId, authorId, status: 'pending' } });
}

/**
 * Récompense l'auteur d'une suggestion approuvée : pièces (économie) et/ou objet
 * (inventaire), selon la config. Renvoie un texte récapitulatif (ou `null`).
 */
export async function grantSuggestionReward(
  ctx: BotContext,
  guildId: string,
  authorId: string,
  config: SuggestionsConfig,
): Promise<string | null> {
  const parts: string[] = [];
  if (config.rewardCoins > 0) {
    await addBalance(ctx, guildId, authorId, config.rewardCoins);
    parts.push(t('modules.suggestions.reward.coins', { coins: config.rewardCoins }));
  }
  if (config.rewardItemId) {
    const item = await getItem(ctx, guildId, config.rewardItemId);
    if (item) {
      await addToInventory(ctx, guildId, authorId, config.rewardItemId, 1);
      parts.push(
        t('modules.suggestions.reward.item', {
          item: item.emoji ? `${item.emoji} ${item.name}` : item.name,
        }),
      );
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

export interface RankedSuggestion {
  suggestion: Suggestion;
  up: number;
  down: number;
  score: number;
}

/** Suggestions les mieux notées (score = 👍 − 👎) du serveur. */
export async function topSuggestions(
  ctx: BotContext,
  guildId: string,
  limit = 10,
): Promise<RankedSuggestion[]> {
  const suggestions = await ctx.db.suggestion.findMany({
    where: { guildId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  if (suggestions.length === 0) return [];

  const grouped = await ctx.db.suggestionVote.groupBy({
    by: ['suggestionId', 'value'],
    where: { suggestionId: { in: suggestions.map((s) => s.id) } },
    _count: { _all: true },
  });
  const counts = new Map<string, { up: number; down: number }>();
  for (const row of grouped) {
    const entry = counts.get(row.suggestionId) ?? { up: 0, down: 0 };
    if (row.value === 'up') entry.up = row._count._all;
    else entry.down = row._count._all;
    counts.set(row.suggestionId, entry);
  }

  return suggestions
    .map((suggestion) => {
      const { up, down } = counts.get(suggestion.id) ?? { up: 0, down: 0 };
      return { suggestion, up, down, score: up - down };
    })
    .sort((a, b) => b.score - a.score || b.up - a.up)
    .slice(0, limit);
}

/** Recherche de suggestions par mot-clé dans le contenu. */
export async function searchSuggestions(
  ctx: BotContext,
  guildId: string,
  keyword: string,
  limit = 10,
): Promise<Suggestion[]> {
  return ctx.db.suggestion.findMany({
    where: { guildId, content: { contains: keyword } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Lien vers le message d'une suggestion (ou `null` si non publié). */
export function suggestionLink(guildId: string, suggestion: Suggestion): string | null {
  return suggestion.messageId
    ? `https://discord.com/channels/${guildId}/${suggestion.channelId}/${suggestion.messageId}`
    : null;
}
