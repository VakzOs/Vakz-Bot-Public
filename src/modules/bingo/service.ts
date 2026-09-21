import { randomInt } from 'node:crypto';
import type { BotContext } from '../../core/module.js';

export type BingoMode = 'line' | 'full';
export const MAX_NUMBER = 75;
const FREE = 0; // case centrale libre

/** Les 12 lignes gagnantes d'un carton 5×5 (rangées, colonnes, diagonales). */
export const LINES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

/** Génère un carton 5×5 : chaque colonne tire dans sa plage, centre libre. */
export function generateCard(): number[] {
  const cells = new Array<number>(25).fill(0);
  for (let col = 0; col < 5; col += 1) {
    const pool: number[] = [];
    for (let n = col * 15 + 1; n <= col * 15 + 15; n += 1) pool.push(n);
    for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
      const [picked] = pool.splice(randomInt(pool.length), 1);
      cells[rowIndex * 5 + col] = picked ?? 0;
    }
  }
  cells[12] = FREE;
  return cells;
}

function isMarked(cell: number, drawn: ReadonlySet<number>): boolean {
  return cell === FREE || drawn.has(cell);
}

/** Le carton est-il gagnant selon le mode (une ligne, ou carton plein) ? */
export function hasWin(cells: number[], drawn: ReadonlySet<number>, mode: BingoMode): boolean {
  if (mode === 'full') return cells.every((cell) => isMarked(cell, drawn));
  return LINES.some((line) => line.every((index) => isMarked(cells[index] ?? FREE, drawn)));
}

/** Rendu texte du carton (case tirée entre crochets, centre = ★). */
export function formatCard(cells: number[], drawn: ReadonlySet<number>): string {
  const cell = (n: number): string => {
    if (n === FREE) return ' ★ ';
    const s = String(n).padStart(2, ' ');
    return drawn.has(n) ? `[${s}]` : ` ${s} `;
  };
  const rows: string[] = ['  B    I    N    G    O'];
  for (let r = 0; r < 5; r += 1) {
    rows.push(Array.from({ length: 5 }, (_, c) => cell(cells[r * 5 + c] ?? FREE)).join(' '));
  }
  return `\`\`\`\n${rows.join('\n')}\n\`\`\``;
}

// --- Persistance ------------------------------------------------------------

export interface BingoGame {
  id: string;
  guildId: string;
  status: string;
  mode: string;
  drawn: string;
}

export function drawnSet(game: BingoGame): Set<number> {
  try {
    return new Set(JSON.parse(game.drawn) as number[]);
  } catch {
    return new Set();
  }
}

export async function getGame(ctx: BotContext, guildId: string): Promise<BingoGame | null> {
  return ctx.db.bingoGame.findUnique({ where: { guildId } });
}

/** Démarre une partie neuve (remplace toute partie existante et ses cartons). */
export async function startGame(
  ctx: BotContext,
  guildId: string,
  mode: BingoMode,
): Promise<BingoGame> {
  await ctx.db.bingoGame.deleteMany({ where: { guildId } });
  return ctx.db.bingoGame.create({ data: { guildId, mode, status: 'open', drawn: '[]' } });
}

export async function endGame(ctx: BotContext, guildId: string): Promise<void> {
  await ctx.db.bingoGame.deleteMany({ where: { guildId } });
}

/** Récupère (ou crée) le carton d'un membre pour la partie. */
export async function joinGame(
  ctx: BotContext,
  game: BingoGame,
  userId: string,
): Promise<number[]> {
  const existing = await ctx.db.bingoCard.findUnique({
    where: { gameId_userId: { gameId: game.id, userId } },
  });
  if (existing) return JSON.parse(existing.numbers) as number[];
  const numbers = generateCard();
  await ctx.db.bingoCard.create({
    data: { gameId: game.id, guildId: game.guildId, userId, numbers: JSON.stringify(numbers) },
  });
  return numbers;
}

export async function getCard(
  ctx: BotContext,
  gameId: string,
  userId: string,
): Promise<number[] | null> {
  const card = await ctx.db.bingoCard.findUnique({
    where: { gameId_userId: { gameId, userId } },
  });
  return card ? (JSON.parse(card.numbers) as number[]) : null;
}

export interface DrawResult {
  number: number;
  count: number;
  drawn: Set<number>;
}

/** Tire un numéro non encore sorti (ou null si les 75 sont tirés). */
export async function drawNumber(ctx: BotContext, game: BingoGame): Promise<DrawResult | null> {
  const drawn = drawnSet(game);
  const remaining: number[] = [];
  for (let n = 1; n <= MAX_NUMBER; n += 1) if (!drawn.has(n)) remaining.push(n);
  if (remaining.length === 0) return null;

  const number = remaining[randomInt(remaining.length)] as number;
  drawn.add(number);
  await ctx.db.bingoGame.update({
    where: { id: game.id },
    data: { drawn: JSON.stringify([...drawn]) },
  });
  return { number, count: drawn.size, drawn };
}

/** Membres dont le carton est gagnant pour l'état de tirage courant. */
export async function findWinners(
  ctx: BotContext,
  game: BingoGame,
  drawn: ReadonlySet<number>,
): Promise<string[]> {
  const cards = await ctx.db.bingoCard.findMany({ where: { gameId: game.id } });
  const winners: string[] = [];
  for (const card of cards) {
    const cells = JSON.parse(card.numbers) as number[];
    if (hasWin(cells, drawn, game.mode === 'full' ? 'full' : 'line')) winners.push(card.userId);
  }
  return winners;
}
