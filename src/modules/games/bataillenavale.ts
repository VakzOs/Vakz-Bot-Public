import { existsSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { GlobalFonts, type SKRSContext2D, createCanvas } from '@napi-rs/canvas';
import { t } from '../../core/i18n.js';
import { Colors, Emojis, withEmoji } from '../../lib/embeds.js';
import { BOT } from './morpion.js';

/** Grille 8×8 (rendue en image → pas de limite de boutons). */
export const SIZE = 8;
const CELLS = SIZE * SIZE;
/** Flotte : porte-avions (4), deux croiseurs (3), destroyer (2). */
const FLEET = [4, 3, 3, 2];

// Police pour les libellés de la grille (DejaVu dans l'image Docker).
const FONT_FAMILY = 'BnFont';
let fontReady = false;
for (const path of [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]) {
  if (existsSync(path)) {
    try {
      GlobalFonts.registerFromPath(path, FONT_FAMILY);
      fontReady = true;
    } catch {
      // police ignorée
    }
  }
}
const FAMILY = fontReady ? FONT_FAMILY : 'sans-serif';

/** Nom du fichier image joint (référencé par l'embed). */
export const BOARD_IMAGE = 'bataille.png';

/** Une grille : positions des navires + tirs subis (touchés / manqués). */
export interface Board {
  ships: number[][];
  hits: Set<number>;
  misses: Set<number>;
}

export interface BnGame {
  boardA: Board;
  boardB: Board;
  p1: string;
  p2: string; // adversaire, ou BOT
  turn: 'A' | 'B';
  /** Dernier évènement résolu (affiché dans l'embed). */
  lastShot: string;
  expires: number;
}

const games = new Map<string, BnGame>();
const TTL_MS = 15 * 60 * 1000;

function neighbors(cell: number): number[] {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  const out: number[] = [];
  if (row > 0) out.push(cell - SIZE);
  if (row < SIZE - 1) out.push(cell + SIZE);
  if (col > 0) out.push(cell - 1);
  if (col < SIZE - 1) out.push(cell + 1);
  return out;
}

function placeShip(len: number, occupied: Set<number>): number[] | null {
  for (let tries = 0; tries < 80; tries += 1) {
    const horizontal = randomInt(2) === 0;
    const cells: number[] = [];
    if (horizontal) {
      const row = randomInt(SIZE);
      const col = randomInt(SIZE - len + 1);
      for (let k = 0; k < len; k += 1) cells.push(row * SIZE + col + k);
    } else {
      const row = randomInt(SIZE - len + 1);
      const col = randomInt(SIZE);
      for (let k = 0; k < len; k += 1) cells.push((row + k) * SIZE + col);
    }
    if (cells.every((cell) => !occupied.has(cell))) return cells;
  }
  return null;
}

function placeFleet(): number[][] {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const occupied = new Set<number>();
    const ships: number[][] = [];
    let ok = true;
    for (const len of FLEET) {
      const cells = placeShip(len, occupied);
      if (!cells) {
        ok = false;
        break;
      }
      cells.forEach((cell) => occupied.add(cell));
      ships.push(cells);
    }
    if (ok) return ships;
  }
  return FLEET.map((len, i) => Array.from({ length: len }, (_, k) => i * 2 * SIZE + k));
}

function newBoard(): Board {
  return { ships: placeFleet(), hits: new Set(), misses: new Set() };
}

export function createBnGame(p1: string, p2: string): { id: string; game: BnGame } {
  const id = randomUUID().slice(0, 8);
  const game: BnGame = {
    boardA: newBoard(),
    boardB: newBoard(),
    p1,
    p2,
    turn: 'A',
    lastShot: '',
    expires: Date.now() + TTL_MS,
  };
  games.set(id, game);
  return { id, game };
}

export function getBnGame(id: string): BnGame | null {
  const game = games.get(id);
  if (!game) return null;
  if (game.expires < Date.now()) {
    games.delete(id);
    return null;
  }
  return game;
}

export function endBnGame(id: string): void {
  games.delete(id);
}

/** La grille visée par le joueur dont c'est le tour. */
export function targetBoard(game: BnGame): Board {
  return game.turn === 'A' ? game.boardB : game.boardA;
}

/** La flotte (grille) du joueur dont c'est le tour. */
export function ownBoard(game: BnGame): Board {
  return game.turn === 'A' ? game.boardA : game.boardB;
}

/** Identifiant du joueur dont c'est le tour. */
export function currentPlayer(game: BnGame): string {
  return game.turn === 'A' ? game.p1 : game.p2;
}

function shipAt(board: Board, cell: number): number[] | null {
  return board.ships.find((ship) => ship.includes(cell)) ?? null;
}

function isShipSunk(board: Board, ship: number[]): boolean {
  return ship.every((cell) => board.hits.has(cell));
}

export function sunkCount(board: Board): number {
  return board.ships.filter((ship) => isShipSunk(board, ship)).length;
}

export function allSunk(board: Board): boolean {
  return board.ships.every((ship) => isShipSunk(board, ship));
}

export type FireResult = 'miss' | 'hit' | 'sunk' | 'already';

export function fire(board: Board, cell: number): FireResult {
  if (board.hits.has(cell) || board.misses.has(cell)) return 'already';
  const ship = shipAt(board, cell);
  if (!ship) {
    board.misses.add(cell);
    return 'miss';
  }
  board.hits.add(cell);
  return isShipSunk(board, ship) ? 'sunk' : 'hit';
}

/** Choix de tir du bot : achève un navire touché (voisins), sinon au hasard. */
export function botFire(target: Board): number {
  const candidates = new Set<number>();
  for (const cell of target.hits) {
    const ship = shipAt(target, cell);
    if (ship && isShipSunk(target, ship)) continue;
    for (const n of neighbors(cell)) {
      if (!target.hits.has(n) && !target.misses.has(n)) candidates.add(n);
    }
  }
  const unknown: number[] = [];
  for (let i = 0; i < CELLS; i += 1) {
    if (!target.hits.has(i) && !target.misses.has(i)) unknown.push(i);
  }
  const pool = candidates.size > 0 ? [...candidates] : unknown;
  return pool[randomInt(pool.length)] ?? 0;
}

/** Libellé d'une case (ex. 10 → « B3 »). */
export function coord(cell: number): string {
  return `${String.fromCharCode(65 + Math.floor(cell / SIZE))}${(cell % SIZE) + 1}`;
}

/** Analyse une saisie de coordonnée (« C7 », « 7c »…) → index de case, ou null. */
export function parseCoord(input: string): number | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z])(\d{1,2})$/.exec(s) ?? /^(\d{1,2})([A-Z])$/.exec(s);
  if (!match) return null;
  const letter = /[A-Z]/.test(match[1] ?? '') ? (match[1] ?? '') : (match[2] ?? '');
  const digit = /\d/.test(match[1] ?? '') ? (match[1] ?? '') : (match[2] ?? '');
  const row = letter.charCodeAt(0) - 65;
  const col = Number.parseInt(digit, 10) - 1;
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
  return row * SIZE + col;
}

function opponentLabel(game: BnGame): string {
  return game.p2 === BOT ? t('modules.games.bn.bot') : `<@${game.p2}>`;
}

/** Embed d'état (image jointe en illustration). */
export function buildBnEmbed(game: BnGame, over: boolean, winnerId: string | null): EmbedBuilder {
  const target = targetBoard(game);
  const lines = [`🚢 <@${game.p1}> ⚔️ ${opponentLabel(game)}`];
  if (game.lastShot) lines.push(game.lastShot);

  if (over) {
    lines.push(
      winnerId === BOT
        ? t('modules.games.bn.botWins')
        : t('modules.games.bn.wins', { user: `<@${winnerId}>` }),
    );
  } else {
    const firerId = currentPlayer(game);
    lines.push(
      firerId === BOT
        ? t('modules.games.bn.botTurn')
        : t('modules.games.bn.turn', { user: `<@${firerId}>` }),
    );
    lines.push(
      t('modules.games.bn.remaining', { sunk: sunkCount(target), total: target.ships.length }),
    );
  }

  return new EmbedBuilder()
    .setColor(over ? Colors.success : Colors.brand)
    .setTitle(withEmoji(t('modules.games.bn.title'), Emojis.game))
    .setDescription(lines.join('\n'))
    .setImage(`attachment://${BOARD_IMAGE}`);
}

/**
 * Boutons du message : « Tirer » toujours, et « Ma flotte » (vue privée
 * éphémère) en partie à deux pour consulter sa propre grille sans la révéler.
 */
export function buildFireRow(
  id: string,
  over: boolean,
  vsBot: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (over) return [];
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`game|bn|${id}`)
      .setLabel(t('modules.games.bn.fire'))
      .setEmoji('🎯')
      .setStyle(ButtonStyle.Danger),
  );
  if (!vsBot) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`game|bnfleet|${id}`)
        .setLabel(t('modules.games.bn.myFleet'))
        .setEmoji('🚢')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

/** Modal de saisie de la coordonnée. */
export function buildFireModal(id: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`game|bnshot|${id}`)
    .setTitle(t('modules.games.bn.fire'))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('coord')
          .setLabel(t('modules.games.bn.coordLabel'))
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(3)
          .setPlaceholder('C7')
          .setRequired(true),
      ),
    );
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const CELL = 44;
const PAD = 28; // gouttière des libellés A-H / 1-8
const TITLE_H = 30; // bandeau titre au-dessus de chaque grille
const GAP = 36; // espace entre les deux grilles
const MARGIN = 12;
const GRID_W = PAD + SIZE * CELL;
const GRID_H = PAD + SIZE * CELL;

/** Dessine une grille (flotte ou cible) à la position donnée. */
function drawGrid(
  ctx: SKRSContext2D,
  ox: number,
  oy: number,
  board: Board,
  revealShips: boolean,
  title: string,
): void {
  // Titre de la grille.
  ctx.fillStyle = '#c9d1d9';
  ctx.font = `bold 16px ${FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, ox + PAD, oy - 9);

  // Libellés des colonnes (1-8) et lignes (A-H).
  ctx.fillStyle = '#8b949e';
  ctx.font = `bold 15px ${FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < SIZE; c += 1) {
    ctx.fillText(String(c + 1), ox + PAD + c * CELL + CELL / 2, oy + PAD / 2 + 2);
  }
  for (let r = 0; r < SIZE; r += 1) {
    ctx.fillText(String.fromCharCode(65 + r), ox + PAD / 2, oy + PAD + r * CELL + CELL / 2);
  }

  const shipCells = new Set<number>();
  if (revealShips) board.ships.forEach((ship) => ship.forEach((cell) => shipCells.add(cell)));

  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const index = r * SIZE + c;
      const x = ox + PAD + c * CELL;
      const y = oy + PAD + r * CELL;

      let fill = '#132a4d'; // eau
      if (board.hits.has(index)) fill = '#da3633';
      else if (board.misses.has(index)) fill = '#1f6feb';
      else if (shipCells.has(index)) fill = '#6e7681';

      ctx.fillStyle = fill;
      roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 7);
      ctx.fill();

      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      if (board.hits.has(index)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - 8);
        ctx.lineTo(cx + 8, cy + 8);
        ctx.moveTo(cx + 8, cy - 8);
        ctx.lineTo(cx - 8, cy + 8);
        ctx.stroke();
      } else if (board.misses.has(index)) {
        ctx.fillStyle = '#c9d1d9';
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Deux grilles côte à côte : flotte (navires visibles) + grille de tir. */
function renderDuo(own: Board, target: Board, over: boolean): Buffer {
  const width = MARGIN * 2 + GRID_W * 2 + GAP;
  const height = MARGIN + TITLE_H + GRID_H + MARGIN;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  const gridY = MARGIN + TITLE_H;
  drawGrid(ctx, MARGIN, gridY, own, true, t('modules.games.bn.ownGrid'));
  drawGrid(ctx, MARGIN + GRID_W + GAP, gridY, target, over, t('modules.games.bn.targetGrid'));
  return canvas.toBuffer('image/png');
}

/** Une seule grille. `revealShips` affiche les navires (flotte ou fin de partie). */
function renderSingle(board: Board, revealShips: boolean, title: string): Buffer {
  const width = MARGIN * 2 + GRID_W;
  const height = MARGIN + TITLE_H + GRID_H + MARGIN;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, MARGIN, MARGIN + TITLE_H, board, revealShips, title);
  return canvas.toBuffer('image/png');
}

/**
 * Image publique du message partagé.
 * - Contre le bot : les deux grilles (aucun secret à cacher).
 * - Contre un membre : uniquement la grille de tir (navires adverses cachés),
 *   pour ne jamais dévoiler la flotte de l'autre joueur.
 */
export function renderBoardImage(game: BnGame, over: boolean): Buffer {
  const target = targetBoard(game);
  if (game.p2 === BOT) return renderDuo(ownBoard(game), target, over);
  return renderSingle(target, over, t('modules.games.bn.targetGrid'));
}

/** Image privée (éphémère) : la flotte d'un joueur, navires visibles. */
export function renderFleetImage(board: Board): Buffer {
  return renderSingle(board, true, t('modules.games.bn.ownGrid'));
}
