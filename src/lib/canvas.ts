import { existsSync } from 'node:fs';
import {
  GlobalFonts,
  type Canvas,
  type SKRSContext2D,
  createCanvas,
  loadImage,
} from '@napi-rs/canvas';
import { fetchWithTimeout } from './http.js';

/**
 * Primitives canvas partagées pour construire des « cartes » image cohérentes
 * (police, fond dégradé arrondi, avatar rond, rectangles arrondis, couleurs).
 * Centralise ce que `levels/card.ts`, `welcome/card.ts`, etc. réimplémentent
 * chacun de leur côté — cible de migration progressive.
 *
 * NB : la police DejaVu ne contient PAS d'emoji couleur → éviter les emoji dans
 * les textes dessinés (ils rendent un « tofu »). Les emoji restent OK côté
 * composants Discord (boutons/menus), rendus par le client, sous l'image.
 */

const CARD_FONT = 'VakzCard';
let fontReady = false;
for (const path of [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]) {
  if (existsSync(path)) {
    try {
      GlobalFonts.registerFromPath(path, CARD_FONT);
      fontReady = true;
    } catch {
      // police ignorée : on retombera sur sans-serif
    }
  }
}
const FAMILY = fontReady ? CARD_FONT : 'sans-serif';

/** Chaîne de police CSS pour le canvas (ex. `font('bold', 42)`). */
export function font(weight: 'bold' | 'normal', size: number): string {
  return `${weight} ${size}px ${FAMILY}`;
}

/** Convertit un entier couleur (0xRRGGBB) en `#rrggbb` ; `fallback` si nul. */
export function hexColor(value: number | null | undefined, fallback = '#5865f2'): string {
  if (value === null || value === undefined) return fallback;
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Trace un rectangle arrondi (chemin courant ; appeler `fill()`/`stroke()` ensuite). */
export function roundedRect(
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

/**
 * Dessine `text` en (x, y) en réduisant la taille de police jusqu'à tenir dans
 * `maxWidth` (borne basse `minSize`). Si c'est toujours trop long à la taille
 * minimale, tronque avec une ellipse. Évite qu'une valeur longue (date de build,
 * pseudo…) déborde de sa zone. Laisse `ctx.font` modifié.
 */
export function fitText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  opts: { maxWidth: number; weight: 'bold' | 'normal'; maxSize: number; minSize?: number },
): void {
  const min = opts.minSize ?? 12;
  let size = opts.maxSize;
  ctx.font = font(opts.weight, size);
  while (size > min && ctx.measureText(text).width > opts.maxWidth) {
    size -= 1;
    ctx.font = font(opts.weight, size);
  }
  let out = text;
  if (ctx.measureText(out).width > opts.maxWidth) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > opts.maxWidth) {
      out = out.slice(0, -1);
    }
    out = `${out}…`;
  }
  ctx.fillText(out, x, y);
}

/** Palette commune des cartes (fond, panneau, textes, bordure). */
export const Card = {
  bgTop: '#232733',
  bgBottom: '#171a21',
  panel: '#2b2f3a',
  panelAlt: '#3a3f4d',
  border: 'rgba(255,255,255,0.06)',
  text: '#ffffff',
  textMuted: '#9aa0aa',
} as const;

/**
 * Crée un canvas « carte » : fond dégradé vertical arrondi + fine bordure.
 * Renvoie le canvas et son contexte prêts à dessiner par-dessus.
 */
export function createCard(
  width: number,
  height: number,
  radius = 32,
): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, Card.bgTop);
  bg.addColorStop(1, Card.bgBottom);
  ctx.fillStyle = bg;
  roundedRect(ctx, 0, 0, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = Card.border;
  ctx.lineWidth = 2;
  roundedRect(ctx, 1, 1, width - 2, height - 2, radius - 1);
  ctx.stroke();
  return { canvas, ctx };
}

export interface AvatarCircleOptions {
  x: number;
  y: number;
  radius: number;
  /** URL de l'avatar ; en cas d'échec/absence, on dessine le placeholder. */
  url?: string;
  /** Texte du placeholder (2 initiales) si l'avatar est indisponible. */
  placeholderText?: string;
  /** Couleur d'un anneau autour de l'avatar (ex. état/latence). */
  ring?: string;
  ringWidth?: number;
}

/**
 * Dessine un avatar circulaire (image distante détourée en cercle) avec un
 * anneau optionnel. Best-effort : timeout réseau, repli sur des initiales.
 */
export async function drawAvatarCircle(
  ctx: SKRSContext2D,
  opts: AvatarCircleOptions,
): Promise<void> {
  const { x, y, radius: r } = opts;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = Card.panel;
  ctx.fill();
  ctx.clip();
  let drew = false;
  if (opts.url) {
    try {
      const res = await fetchWithTimeout(opts.url, {}, 5000);
      const img = await loadImage(Buffer.from(await res.arrayBuffer()));
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      drew = true;
    } catch {
      // avatar indisponible : placeholder ci-dessous
    }
  }
  if (!drew && opts.placeholderText) {
    ctx.fillStyle = Card.panelAlt;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = Card.text;
    ctx.font = font('bold', r * 0.7);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.placeholderText.slice(0, 2).toUpperCase(), x, y + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  if (opts.ring) {
    const rw = opts.ringWidth ?? 5;
    ctx.beginPath();
    ctx.arc(x, y, r + rw / 2 + 1, 0, Math.PI * 2);
    ctx.strokeStyle = opts.ring;
    ctx.lineWidth = rw;
    ctx.stroke();
  }
}
