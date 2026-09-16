import { existsSync } from 'node:fs';
import { GlobalFonts, type SKRSContext2D, createCanvas } from '@napi-rs/canvas';

// Police (DejaVu dans l'image Docker, repli système sinon).
const FONT_FAMILY = 'BingoFont';
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

/** Nom du fichier image joint (référencé par les messages). */
export const CARD_IMAGE = 'carton.png';

const CELL = 92;
const PAD = 22;
const HEADER = 80;
const GAP = 6;
/** Couleurs des colonnes B I N G O (en-tête). */
const COL_COLORS = ['#da3633', '#e3641a', '#d29922', '#3fb950', '#1f6feb'];
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

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

/**
 * Rend un carton de Bingo 5×5 en image PNG. Les numéros déjà tirés sont
 * marqués d'une pastille rouge (façon tampon), la case centrale est libre.
 */
export function renderCardImage(cells: number[], drawn: ReadonlySet<number>): Buffer {
  const width = PAD * 2 + 5 * CELL;
  const height = PAD * 2 + HEADER + 5 * CELL;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, width, height);

  // En-tête B I N G O (une couleur par colonne).
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < 5; c += 1) {
    const x = PAD + c * CELL;
    ctx.fillStyle = COL_COLORS[c] ?? '#1f6feb';
    roundRect(ctx, x + GAP / 2, PAD, CELL - GAP, HEADER - GAP, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 46px ${FAMILY}`;
    ctx.fillText(LETTERS[c] ?? '', x + CELL / 2, PAD + (HEADER - GAP) / 2 + 2);
  }

  // Cases.
  const top = PAD + HEADER;
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const index = r * 5 + c;
      const num = cells[index] ?? 0;
      const x = PAD + c * CELL;
      const y = top + r * CELL;
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      const free = num === 0;

      // Fond de la case.
      ctx.fillStyle = '#161b22';
      roundRect(ctx, x + GAP / 2, y + GAP / 2, CELL - GAP, CELL - GAP, 12);
      ctx.fill();
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (free) {
        // Case centrale libre : étoile rouge.
        ctx.fillStyle = '#da3633';
        ctx.font = `bold 44px ${FAMILY}`;
        ctx.fillText('★', cx, cy + 2);
        continue;
      }

      if (drawn.has(num)) {
        // Pastille rouge (numéro tiré) + numéro blanc.
        ctx.fillStyle = '#da3633';
        ctx.beginPath();
        ctx.arc(cx, cy, CELL / 2 - 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#c9d1d9';
      }
      ctx.font = `bold 38px ${FAMILY}`;
      ctx.fillText(String(num), cx, cy + 2);
    }
  }

  return canvas.toBuffer('image/png');
}
