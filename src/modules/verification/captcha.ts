import { existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';

/**
 * Captcha image « maison » : un code court rendu déformé (rotation, bruit,
 * lignes parasites) pour résister à une lecture automatique triviale. L'état des
 * captchas en attente est gardé **en mémoire** avec une durée de vie courte :
 * inutile de persister (au pire, un membre reclique sur « Se vérifier »).
 */

// Polices : DejaVu si présente dans l'image Docker, sinon police système.
const FONT_FAMILY = 'CaptchaFont';
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

/** Alphabet sans caractères ambigus (pas de O/0, I/1/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Durée de validité d'un captcha (5 minutes). */
const TTL_MS = 5 * 60 * 1000;

interface PendingCaptcha {
  code: string;
  expires: number;
}

const pending = new Map<string, PendingCaptcha>();

function key(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/** Génère un code aléatoire non ambigu. */
export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Enregistre un captcha en attente pour un membre (remplace l'ancien). */
export function setPending(guildId: string, userId: string, code: string): void {
  pending.set(key(guildId, userId), { code, expires: Date.now() + TTL_MS });
}

/** Récupère le captcha en attente s'il n'est pas expiré (sinon le purge). */
export function getPending(guildId: string, userId: string): string | null {
  const entry = pending.get(key(guildId, userId));
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    pending.delete(key(guildId, userId));
    return null;
  }
  return entry.code;
}

/** Efface le captcha en attente d'un membre (après succès). */
export function clearPending(guildId: string, userId: string): void {
  pending.delete(key(guildId, userId));
}

function randomInclusive(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Rend le code sous forme d'image PNG déformée. */
export function renderCaptcha(code: string): Buffer {
  const width = 320;
  const height = 120;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fond dégradé sombre.
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#2b2d31');
  gradient.addColorStop(1, '#1e1f22');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Bruit : points.
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${randomInclusive(0.04, 0.16).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(
      randomInclusive(0, width),
      randomInclusive(0, height),
      randomInclusive(0.6, 1.6),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Bruit : lignes parasites.
  for (let i = 0; i < 6; i += 1) {
    ctx.strokeStyle = `rgba(${randomInt(120, 220)},${randomInt(120, 220)},${randomInt(120, 220)},0.5)`;
    ctx.lineWidth = randomInclusive(1, 2.5);
    ctx.beginPath();
    ctx.moveTo(randomInclusive(0, width), randomInclusive(0, height));
    ctx.lineTo(randomInclusive(0, width), randomInclusive(0, height));
    ctx.stroke();
  }

  // Caractères, chacun décalé et pivoté aléatoirement.
  const step = width / (code.length + 1);
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i] ?? '';
    ctx.save();
    ctx.translate(step * (i + 1), height / 2 + randomInclusive(-10, 10));
    ctx.rotate((randomInclusive(-22, 22) * Math.PI) / 180);
    ctx.font = `bold ${Math.round(randomInclusive(38, 50))}px ${FAMILY}`;
    ctx.fillStyle = `hsl(${randomInt(0, 360)}, 70%, 78%)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, 0, 0);
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}
