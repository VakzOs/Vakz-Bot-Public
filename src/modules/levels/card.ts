import { existsSync } from 'node:fs';
import { GlobalFonts, type SKRSContext2D, createCanvas, loadImage } from '@napi-rs/canvas';

// Polices : on enregistre DejaVu si présente (installée dans l'image Docker),
// sinon on retombe sur la police système par défaut.
const FONT_FAMILY = 'RankFont';
let fontReady = false;
for (const path of [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
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

export interface RankCardData {
  username: string;
  avatarUrl: string;
  level: number;
  rank: number;
  xp: number;
  currentXp: number;
  neededXp: number;
  /** Couleur d'accent (barre de progression), entier RGB ; défaut = bleu marque. */
  accentColor?: number | null;
}

function hexColor(value: number | null | undefined, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  return `#${value.toString(16).padStart(6, '0')}`;
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function font(weight: 'bold' | 'normal', size: number): string {
  return `${weight} ${size}px ${FAMILY}`;
}

/** Génère une carte de rang (PNG) pour un membre. */
export async function renderRankCard(data: RankCardData): Promise<Buffer> {
  const width = 900;
  const height = 260;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fond
  ctx.fillStyle = '#1e2124';
  roundedRect(ctx, 0, 0, width, height, 28);
  ctx.fill();

  // Panneau intérieur
  ctx.fillStyle = '#282b30';
  roundedRect(ctx, 20, 20, width - 40, height - 40, 20);
  ctx.fill();

  // Avatar (cercle)
  const avatarX = 140;
  const avatarY = height / 2;
  const avatarR = 88;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#484b4f';
  ctx.fill();
  ctx.clip();
  try {
    const res = await fetch(data.avatarUrl);
    const image = await loadImage(Buffer.from(await res.arrayBuffer()));
    ctx.drawImage(image, avatarX - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2);
  } catch {
    // pas d'avatar : on garde le cercle gris
  }
  ctx.restore();

  const left = 260;

  // Pseudo
  ctx.fillStyle = '#ffffff';
  ctx.font = font('bold', 42);
  ctx.fillText(data.username.slice(0, 18), left, 95);

  // Niveau · Rang
  ctx.fillStyle = '#b9bbbe';
  ctx.font = font('normal', 30);
  ctx.fillText(`Niveau ${data.level}  ·  Rang #${data.rank}`, left, 140);

  // XP (aligné à droite)
  ctx.fillStyle = '#b9bbbe';
  ctx.font = font('normal', 24);
  ctx.textAlign = 'right';
  ctx.fillText(`${data.currentXp} / ${data.neededXp} XP`, width - 40, 178);
  ctx.textAlign = 'left';

  // Barre de progression
  const barX = left;
  const barY = 192;
  const barW = width - barX - 40;
  const barH = 34;
  ctx.fillStyle = '#484b4f';
  roundedRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  const ratio = data.neededXp > 0 ? Math.min(data.currentXp / data.neededXp, 1) : 0;
  if (ratio > 0) {
    ctx.fillStyle = hexColor(data.accentColor, '#5865f2');
    roundedRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, barH / 2);
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}
