import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';

/** Case du plateau : 0 vide, 1 joueur ❌, 2 joueur/bot ⭕. */
export type Cell = 0 | 1 | 2;

/** Identifiant spécial d'adversaire pour une partie contre l'ordinateur. */
export const BOT = 'bot';

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const MARK: Record<Cell, string> = { 0: '', 1: '❌', 2: '⭕' };

export interface TttGame {
  board: Cell[];
  turn: Cell; // 1 ou 2
  p1: string; // joueur ❌
  p2: string; // joueur ⭕, ou BOT
  expires: number;
}

const games = new Map<string, TttGame>();
const TTL_MS = 10 * 60 * 1000;

export function createGame(p1: string, p2: string): { id: string; game: TttGame } {
  const id = randomUUID().slice(0, 8);
  const game: TttGame = {
    board: Array.from({ length: 9 }, () => 0 as Cell),
    turn: 1,
    p1,
    p2,
    expires: Date.now() + TTL_MS,
  };
  games.set(id, game);
  return { id, game };
}

export function getGame(id: string): TttGame | null {
  const game = games.get(id);
  if (!game) return null;
  if (game.expires < Date.now()) {
    games.delete(id);
    return null;
  }
  return game;
}

export function endGame(id: string): void {
  games.delete(id);
}

/** Renvoie le vainqueur (1 ou 2) ou 0 si aucun. */
export function winner(board: Cell[]): Cell {
  for (const [a, b, c] of LINES) {
    const v = board[a] ?? 0;
    if (v !== 0 && v === board[b] && v === board[c]) return v;
  }
  return 0;
}

/** Renvoie la ligne gagnante (indices) ou null. */
export function winningLine(board: Cell[]): number[] | null {
  for (const [a, b, c] of LINES) {
    const v = board[a] ?? 0;
    if (v !== 0 && v === board[b] && v === board[c]) return [a, b, c];
  }
  return null;
}

export function isFull(board: Cell[]): boolean {
  return board.every((cell) => cell !== 0);
}

/** Minimax : score optimal pour `bot` (positif = bot gagne, négatif = perd). */
function minimax(board: Cell[], toMove: Cell, bot: Cell, depth: number): number {
  const won = winner(board);
  if (won === bot) return 10 - depth;
  if (won !== 0) return depth - 10;
  if (isFull(board)) return 0;

  const next: Cell = toMove === 1 ? 2 : 1;
  let best = toMove === bot ? -Infinity : Infinity;
  for (let i = 0; i < 9; i += 1) {
    if ((board[i] ?? 0) !== 0) continue;
    board[i] = toMove;
    const score = minimax(board, next, bot, depth + 1);
    board[i] = 0;
    best = toMove === bot ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

/** Meilleur coup pour le bot (jeu parfait : le bot ne perd jamais). */
export function bestMove(board: Cell[], bot: Cell): number {
  const opponent: Cell = bot === 1 ? 2 : 1;
  let best = -Infinity;
  let move = -1;
  for (let i = 0; i < 9; i += 1) {
    if ((board[i] ?? 0) !== 0) continue;
    board[i] = bot;
    const score = minimax(board, opponent, bot, 1);
    board[i] = 0;
    if (score > best) {
      best = score;
      move = i;
    }
  }
  return move;
}

/** Texte de statut (tour courant, ou résultat en fin de partie). */
export function tttStatus(game: TttGame, over: boolean, won: Cell): string {
  if (over) {
    if (won === 0) return t('modules.games.ttt.draw');
    const winnerId = won === 1 ? game.p1 : game.p2;
    if (winnerId === BOT) return t('modules.games.ttt.botWins');
    return t('modules.games.ttt.wins', { user: `<@${winnerId}>` });
  }
  const moverId = game.turn === 1 ? game.p1 : game.p2;
  if (moverId === BOT) return t('modules.games.ttt.botTurn');
  return t('modules.games.ttt.turn', { user: `<@${moverId}>` });
}

/** Embed de l'état courant de la partie. */
export function buildTttEmbed(game: TttGame, over: boolean, won: Cell): EmbedBuilder {
  const color = over ? (won === 0 ? Colors.warning : Colors.success) : Colors.brand;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(t('modules.games.ttt.title'))
    .setDescription(
      `❌ <@${game.p1}> · ⭕ ${game.p2 === BOT ? t('modules.games.ttt.bot') : `<@${game.p2}>`}\n\n${tttStatus(game, over, won)}`,
    );
}

/** Rangées de boutons représentant le plateau. */
export function renderBoard(
  id: string,
  game: TttGame,
  over: boolean,
  line: number[] | null,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let r = 0; r < 3; r += 1) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (let c = 0; c < 3; c += 1) {
      const index = r * 3 + c;
      const cell = game.board[index] ?? 0;
      const button = new ButtonBuilder().setCustomId(`game|ttt|${id}|${index}`);
      if (cell === 0) {
        button
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(over);
      } else {
        const winning = line?.includes(index) ?? false;
        button
          .setLabel(MARK[cell])
          .setStyle(
            winning ? ButtonStyle.Success : cell === 1 ? ButtonStyle.Primary : ButtonStyle.Danger,
          )
          .setDisabled(true);
      }
      row.addComponents(button);
    }
    rows.push(row);
  }
  return rows;
}
