import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Giveaway } from '@prisma/client';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, brandedEmbed, successEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, type GiveawaysConfig, getGiveawaysConfig } from './config.js';

/** Remplace les variables `{clé}` d'un gabarit configurable. */
function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/** Gagnants actuels d'un tirage (désérialisés depuis `winnerIds`). */
export function parseWinners(giveaway: Giveaway): string[] {
  try {
    const parsed = JSON.parse(giveaway.winnerIds) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Embed d'un tirage (lot, hôte, fin, participants ; gagnants si terminé). */
export function buildGiveawayEmbed(giveaway: Giveaway, entryCount: number): EmbedBuilder {
  const ended = giveaway.status === 'ended';
  const embed = brandedEmbed({
    color: ended ? Colors.warning : Colors.brand,
    title: t('modules.giveaways.embed.title', { prize: giveaway.prize }),
    description: ended
      ? t('modules.giveaways.embed.endedIntro')
      : t('modules.giveaways.embed.intro', { count: giveaway.winnerCount }),
    footer: t('modules.giveaways.embed.footer', { id: giveaway.id.slice(0, 6) }),
  }).addFields(
    { name: t('modules.giveaways.embed.host'), value: `<@${giveaway.hostId}>`, inline: true },
    {
      name: t('modules.giveaways.embed.winners'),
      value: String(giveaway.winnerCount),
      inline: true,
    },
    {
      name: ended ? t('modules.giveaways.embed.endedAt') : t('modules.giveaways.embed.endsAt'),
      value: `<t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R>`,
      inline: true,
    },
    { name: t('modules.giveaways.embed.participants'), value: String(entryCount), inline: true },
  );

  if (giveaway.requiredRoleId) {
    embed.addFields({
      name: t('modules.giveaways.embed.requiredRole'),
      value: `<@&${giveaway.requiredRoleId}>`,
      inline: true,
    });
  }
  if (ended) {
    const winners = parseWinners(giveaway);
    embed.addFields({
      name: t('modules.giveaways.embed.result'),
      value: winners.length
        ? winners.map((w) => `<@${w}>`).join(', ')
        : t('modules.giveaways.embed.noWinner'),
    });
  }
  return embed;
}

/** Rangée du bouton « Participer » (retirée quand le tirage est terminé). */
export function buildJoinRow(
  giveaway: Giveaway,
  entryCount: number,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (giveaway.status === 'ended') return [];
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${MODULE_NAME}|join|${giveaway.id}`)
        .setLabel(t('modules.giveaways.joinButton', { count: entryCount }))
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export async function countEntries(ctx: BotContext, giveawayId: string): Promise<number> {
  return ctx.db.giveawayEntry.count({ where: { giveawayId } });
}

/** Ajoute/retire la participation d'un membre. Renvoie `true` si désormais inscrit. */
export async function toggleEntry(
  ctx: BotContext,
  giveawayId: string,
  userId: string,
): Promise<boolean> {
  const existing = await ctx.db.giveawayEntry.findUnique({
    where: { giveawayId_userId: { giveawayId, userId } },
  });
  if (existing) {
    await ctx.db.giveawayEntry.delete({ where: { id: existing.id } });
    return false;
  }
  await ctx.db.giveawayEntry.create({ data: { giveawayId, userId } });
  return true;
}

/** Tire `count` gagnants aléatoires distincts dans `pool`. */
export function drawWinners(pool: string[], count: number): string[] {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as string, arr[i] as string];
  }
  return arr.slice(0, Math.max(0, count));
}

async function entriesOf(ctx: BotContext, giveawayId: string): Promise<string[]> {
  const rows = await ctx.db.giveawayEntry.findMany({ where: { giveawayId } });
  return rows.map((row) => row.userId);
}

/** Met à jour le message du tirage (embed + bouton) selon son état courant. */
async function refreshMessage(
  ctx: BotContext,
  guild: Guild,
  giveaway: Giveaway,
  entryCount: number,
): Promise<void> {
  if (!giveaway.messageId) return;
  const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  await message
    ?.edit({
      embeds: [buildGiveawayEmbed(giveaway, entryCount)],
      components: buildJoinRow(giveaway, entryCount),
    })
    .catch(() => undefined);
}

async function announce(
  ctx: BotContext,
  guild: Guild,
  giveaway: Giveaway,
  content: string,
  mentions: string[],
): Promise<void> {
  const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ content, allowedMentions: { users: mentions } }).catch(() => undefined);
}

/** Journalise les gagnants dans le salon de logs, si configuré. */
async function logWinners(
  ctx: BotContext,
  guild: Guild,
  config: GiveawaysConfig,
  giveaway: Giveaway,
  winners: string[],
): Promise<void> {
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const embed = successEmbed({
    title: t('modules.giveaways.log.title'),
    description: t('modules.giveaways.log.entry', {
      prize: giveaway.prize,
      winners: winners.map((w) => `<@${w}>`).join(', '),
      host: `<@${giveaway.hostId}>`,
      id: giveaway.id.slice(0, 6),
    }),
    timestamp: true,
    emoji: Emojis.party,
  });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
}

/** Annonce le résultat (texte configurable) puis journalise les gagnants. */
async function announceResult(
  ctx: BotContext,
  guild: Guild,
  giveaway: Giveaway,
  winners: string[],
): Promise<void> {
  const config = await getGiveawaysConfig(ctx, guild.id);
  const content = winners.length
    ? fillTemplate(config.winMessage, {
        winners: winners.map((w) => `<@${w}>`).join(', '),
        prize: giveaway.prize,
      })
    : fillTemplate(config.noWinnerMessage, { prize: giveaway.prize });
  await announce(ctx, guild, giveaway, content, winners);
  if (winners.length) await logWinners(ctx, guild, config, giveaway, winners);
}

/** Termine un tirage : tire les gagnants, met à jour le message et annonce. */
export async function endGiveaway(
  ctx: BotContext,
  guild: Guild,
  giveaway: Giveaway,
): Promise<string[]> {
  const pool = await entriesOf(ctx, giveaway.id);
  const winners = drawWinners(pool, giveaway.winnerCount);
  const updated = await ctx.db.giveaway.update({
    where: { id: giveaway.id },
    data: { status: 'ended', winnerIds: JSON.stringify(winners) },
  });

  await refreshMessage(ctx, guild, updated, pool.length);
  await announceResult(ctx, guild, updated, winners);
  return winners;
}

/** Relance complète : re-tire tous les gagnants d'un tirage terminé. */
export async function rerollAll(
  ctx: BotContext,
  guild: Guild,
  giveaway: Giveaway,
): Promise<string[]> {
  const pool = await entriesOf(ctx, giveaway.id);
  const winners = drawWinners(pool, giveaway.winnerCount);
  const updated = await ctx.db.giveaway.update({
    where: { id: giveaway.id },
    data: { winnerIds: JSON.stringify(winners) },
  });
  await refreshMessage(ctx, guild, updated, pool.length);
  await announceResult(ctx, guild, updated, winners);
  return winners;
}

export type RerollOneResult =
  | { ok: true; oldId: string; newId: string }
  | { ok: false; error: 'notWinner' | 'noEligible' };

/** Relance ciblée : remplace un gagnant précis par un nouveau tiré au sort. */
export async function rerollOne(
  ctx: BotContext,
  guild: Guild,
  giveaway: Giveaway,
  oldWinnerId: string,
): Promise<RerollOneResult> {
  const current = parseWinners(giveaway);
  if (!current.includes(oldWinnerId)) return { ok: false, error: 'notWinner' };

  const pool = await entriesOf(ctx, giveaway.id);
  const eligible = pool.filter((userId) => !current.includes(userId));
  if (eligible.length === 0) return { ok: false, error: 'noEligible' };

  const [newId] = drawWinners(eligible, 1);
  if (!newId) return { ok: false, error: 'noEligible' };

  const winners = current.map((w) => (w === oldWinnerId ? newId : w));
  const updated = await ctx.db.giveaway.update({
    where: { id: giveaway.id },
    data: { winnerIds: JSON.stringify(winners) },
  });
  await refreshMessage(ctx, guild, updated, pool.length);
  await announce(
    ctx,
    guild,
    updated,
    t('modules.giveaways.announceRerollOne', {
      old: `<@${oldWinnerId}>`,
      new: `<@${newId}>`,
      prize: giveaway.prize,
    }),
    [newId],
  );
  const config = await getGiveawaysConfig(ctx, guild.id);
  await logWinners(ctx, guild, config, updated, [newId]);
  return { ok: true, oldId: oldWinnerId, newId };
}
