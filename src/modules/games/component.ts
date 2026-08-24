import {
  AttachmentBuilder,
  EmbedBuilder,
  type Interaction,
  MessageFlags,
  type SendableChannels,
} from 'discord.js';
import type { BotContext, ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, withEmoji } from '../../lib/embeds.js';
import {
  PFC_CHOICES,
  PFC_EMOJI,
  type PfcChoice,
  awardGameDrop,
  invertOutcome,
  pfcOutcome,
  recordResult,
} from './service.js';

/** Salon d'envoi (pour les annonces de drop) si l'interaction en a un. */
function sendableChannel(interaction: Interaction): SendableChannels | null {
  const channel = interaction.channel;
  return channel?.isSendable() ? channel : null;
}
import { endDuel, getDuel } from './duel.js';
import {
  BOT,
  type Cell,
  bestMove,
  buildTttEmbed,
  endGame,
  getGame,
  isFull,
  renderBoard,
  winner,
  winningLine,
} from './morpion.js';
import {
  BOARD_IMAGE,
  type FireResult,
  allSunk,
  botFire,
  buildBnEmbed,
  buildFireModal,
  buildFireRow,
  coord,
  currentPlayer,
  endBnGame,
  fire,
  getBnGame,
  parseCoord,
  renderBoardImage,
  renderFleetImage,
  targetBoard,
} from './bataillenavale.js';

async function ephemeral(interaction: Interaction, content: string): Promise<void> {
  if (interaction.isRepliable()) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

/** Gère la réponse de l'adversaire à un défi pierre-feuille-ciseaux. */
async function handlePfc(
  interaction: Interaction,
  ctx: BotContext,
  guildId: string,
  params: string[],
): Promise<void> {
  if (!interaction.isButton()) return;
  const [duelId, move] = params;
  const duel = duelId ? getDuel(duelId) : null;
  if (!duel) {
    await ephemeral(interaction, t('modules.games.pfc.duelExpired'));
    return;
  }
  if (interaction.user.id !== duel.opponentId) {
    await ephemeral(interaction, t('modules.games.pfc.notYourDuel'));
    return;
  }
  if (!PFC_CHOICES.includes(move as PfcChoice)) return;
  const opponentMove = move as PfcChoice;
  endDuel(duelId as string);

  const outcome = pfcOutcome(duel.challengerMove, opponentMove);
  await recordResult(ctx, guildId, duel.challengerId, 'pfc', outcome);
  await recordResult(ctx, guildId, duel.opponentId, 'pfc', invertOutcome(outcome));

  const resultKey =
    outcome === 'win' ? 'challengerWins' : outcome === 'loss' ? 'opponentWins' : 'draw';
  const color = outcome === 'draw' ? Colors.warning : Colors.success;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(withEmoji(t('modules.games.pfc.title'), Emojis.game))
    .setDescription(
      `${PFC_EMOJI[duel.challengerMove]} <@${duel.challengerId}> — <@${duel.opponentId}> ${PFC_EMOJI[opponentMove]}\n\n` +
        t(`modules.games.pfc.duel.${resultKey}`, {
          challenger: `<@${duel.challengerId}>`,
          opponent: `<@${duel.opponentId}>`,
        }),
    );
  await interaction.update({ embeds: [embed], components: [] });

  const channel = sendableChannel(interaction);
  await awardGameDrop(ctx, channel, guildId, duel.challengerId, outcome);
  await awardGameDrop(ctx, channel, guildId, duel.opponentId, invertOutcome(outcome));
}

/** Enregistre le résultat d'une partie de morpion terminée. */
async function recordTtt(
  ctx: BotContext,
  guildId: string,
  p1: string,
  p2: string,
  won: Cell,
): Promise<void> {
  if (won === 0) {
    await recordResult(ctx, guildId, p1, 'morpion', 'draw');
    if (p2 !== BOT) await recordResult(ctx, guildId, p2, 'morpion', 'draw');
    return;
  }
  const winnerId = won === 1 ? p1 : p2;
  const loserId = won === 1 ? p2 : p1;
  if (winnerId !== BOT) await recordResult(ctx, guildId, winnerId, 'morpion', 'win');
  if (loserId !== BOT) await recordResult(ctx, guildId, loserId, 'morpion', 'loss');
}

/** Gère un coup joué sur une grille de morpion. */
async function handleTtt(
  interaction: Interaction,
  ctx: BotContext,
  guildId: string,
  params: string[],
): Promise<void> {
  if (!interaction.isButton()) return;
  const [gameId, cellStr] = params;
  const game = gameId ? getGame(gameId) : null;
  if (!game) {
    await ephemeral(interaction, t('modules.games.ttt.expired'));
    return;
  }
  const cell = Number.parseInt(cellStr ?? '', 10);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || (game.board[cell] ?? 0) !== 0) {
    await interaction.deferUpdate().catch(() => undefined);
    return;
  }

  const moverId = game.turn === 1 ? game.p1 : game.p2;
  if (interaction.user.id !== moverId) {
    await ephemeral(interaction, t('modules.games.ttt.notYourTurn'));
    return;
  }

  game.board[cell] = game.turn;
  game.turn = game.turn === 1 ? 2 : 1;

  // Coup du bot si la partie continue et que c'est à lui de jouer.
  if (game.p2 === BOT && winner(game.board) === 0 && !isFull(game.board) && game.turn === 2) {
    const move = bestMove(game.board, 2);
    if (move >= 0) game.board[move] = 2;
    game.turn = 1;
  }

  const won = winner(game.board);
  const line = winningLine(game.board);
  const over = won !== 0 || isFull(game.board);

  if (over) {
    endGame(gameId as string);
    await recordTtt(ctx, guildId, game.p1, game.p2, won);
  }

  await interaction.update({
    embeds: [buildTttEmbed(game, over, won)],
    components: renderBoard(gameId as string, game, over, line),
  });

  if (over) {
    const channel = sendableChannel(interaction);
    if (won === 0) {
      await awardGameDrop(ctx, channel, guildId, game.p1, 'draw');
      if (game.p2 !== BOT) await awardGameDrop(ctx, channel, guildId, game.p2, 'draw');
    } else {
      const winnerId = won === 1 ? game.p1 : game.p2;
      const loserId = won === 1 ? game.p2 : game.p1;
      if (winnerId !== BOT) await awardGameDrop(ctx, channel, guildId, winnerId, 'win');
      if (loserId !== BOT) await awardGameDrop(ctx, channel, guildId, loserId, 'loss');
    }
  }
}

/** Décrit un tir résolu (ligne affichée sous la grille). */
function shotLine(firer: string, cell: number, result: FireResult): string {
  const who = firer === BOT ? t('modules.games.bn.bot') : `<@${firer}>`;
  const key = result === 'sunk' ? 'shotSunk' : result === 'hit' ? 'shotHit' : 'shotMiss';
  return t(`modules.games.bn.${key}`, { who, coord: coord(cell) });
}

/** Enregistre le résultat d'une bataille navale terminée (pas de nul possible). */
async function recordBn(
  ctx: BotContext,
  guildId: string,
  p1: string,
  p2: string,
  winnerId: string | null,
): Promise<void> {
  if (!winnerId) return;
  const loserId = winnerId === p1 ? p2 : p1;
  if (winnerId !== BOT) await recordResult(ctx, guildId, winnerId, 'bataille', 'win');
  if (loserId !== BOT) await recordResult(ctx, guildId, loserId, 'bataille', 'loss');
}

/** Bouton « Tirer » → ouvre le modal de saisie de coordonnée. */
async function handleBn(interaction: Interaction, params: string[]): Promise<void> {
  if (!interaction.isButton()) return;
  const [id] = params;
  const game = id ? getBnGame(id) : null;
  if (!game) {
    await ephemeral(interaction, t('modules.games.bn.expired'));
    return;
  }
  if (currentPlayer(game) !== interaction.user.id) {
    await ephemeral(interaction, t('modules.games.bn.notYourTurn'));
    return;
  }
  await interaction.showModal(buildFireModal(id as string));
}

/** Bouton « Ma flotte » → montre au joueur sa propre grille en privé. */
async function handleBnFleet(interaction: Interaction, params: string[]): Promise<void> {
  if (!interaction.isButton()) return;
  const [id] = params;
  const game = id ? getBnGame(id) : null;
  if (!game) {
    await ephemeral(interaction, t('modules.games.bn.expired'));
    return;
  }
  const uid = interaction.user.id;
  const board = uid === game.p1 ? game.boardA : uid === game.p2 ? game.boardB : null;
  if (!board) {
    await ephemeral(interaction, t('modules.games.bn.notPlayer'));
    return;
  }
  const attachment = new AttachmentBuilder(renderFleetImage(board), { name: BOARD_IMAGE });
  await interaction
    .reply({ files: [attachment], flags: MessageFlags.Ephemeral })
    .catch(() => undefined);
}

/** Soumission du modal de tir → résout le coup (et la riposte du bot). */
async function handleBnShot(
  interaction: Interaction,
  ctx: BotContext,
  guildId: string,
  params: string[],
): Promise<void> {
  if (!interaction.isModalSubmit()) return;
  const [id] = params;
  const game = id ? getBnGame(id) : null;
  if (!game) {
    await ephemeral(interaction, t('modules.games.bn.expired'));
    return;
  }
  const firer = currentPlayer(game);
  if (firer !== interaction.user.id) {
    await ephemeral(interaction, t('modules.games.bn.notYourTurn'));
    return;
  }

  const raw = interaction.fields.getTextInputValue('coord');
  const cell = parseCoord(raw);
  if (cell === null) {
    await ephemeral(interaction, t('modules.games.bn.invalidCoord'));
    return;
  }

  const target = targetBoard(game);
  const result = fire(target, cell);
  if (result === 'already') {
    await ephemeral(interaction, t('modules.games.bn.alreadyShot'));
    return;
  }

  const lines = [shotLine(firer, cell, result)];
  let over = allSunk(target);
  let winnerId: string | null = over ? firer : null;

  if (!over) {
    game.turn = game.turn === 'A' ? 'B' : 'A';
    // Riposte immédiate du bot le cas échéant.
    if (game.p2 === BOT && currentPlayer(game) === BOT) {
      const botTarget = targetBoard(game);
      const botCell = botFire(botTarget);
      const botResult = fire(botTarget, botCell);
      lines.push(shotLine(BOT, botCell, botResult));
      if (allSunk(botTarget)) {
        over = true;
        winnerId = BOT;
      } else {
        game.turn = 'A';
      }
    }
  }

  game.lastShot = lines.join('\n');
  if (over) {
    endBnGame(id as string);
    await recordBn(ctx, guildId, game.p1, game.p2, winnerId);
  }

  const attachment = new AttachmentBuilder(renderBoardImage(game, over), {
    name: BOARD_IMAGE,
  });
  if (interaction.isFromMessage()) {
    await interaction.update({
      files: [attachment],
      embeds: [buildBnEmbed(game, over, winnerId)],
      components: buildFireRow(id as string, over, game.p2 === BOT),
    });
  }

  if (over && winnerId) {
    const channel = sendableChannel(interaction);
    const loserId = winnerId === game.p1 ? game.p2 : game.p1;
    if (winnerId !== BOT) await awardGameDrop(ctx, channel, guildId, winnerId, 'win');
    if (loserId !== BOT) await awardGameDrop(ctx, channel, guildId, loserId, 'loss');
  }
}

/** Routeur des composants du module « Jeux » (préfixe `game`). */
export const gamesComponent: ComponentHandler = {
  prefix: 'game',
  async handle(interaction, ctx) {
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
    if (!interaction.inCachedGuild()) return;
    const [, kind, ...params] = interaction.customId.split('|');
    if (kind === 'pfc') {
      await handlePfc(interaction, ctx, interaction.guildId, params);
    } else if (kind === 'ttt') {
      await handleTtt(interaction, ctx, interaction.guildId, params);
    } else if (kind === 'bn') {
      await handleBn(interaction, params);
    } else if (kind === 'bnfleet') {
      await handleBnFleet(interaction, params);
    } else if (kind === 'bnshot') {
      await handleBnShot(interaction, ctx, interaction.guildId, params);
    }
  },
};
