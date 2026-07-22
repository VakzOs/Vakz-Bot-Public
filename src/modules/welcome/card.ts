import { existsSync } from 'node:fs';
import { GlobalFonts, type SKRSContext2D, createCanvas, loadImage } from '@napi-rs/canvas';

// Polices : DejaVu si présente (image Docker), sinon police système par défaut.
const FONT_FAMILY = 'WelcomeFont';
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

export interface GreetCardData {
  /** Ligne du haut (ex. « Bienvenue ! »). */
  title: string;
  /** Nom mis en avant. */
  name: string;
  /** Ligne du bas (ex. « 42ᵉ membre »). */
  subtitle: string;
  avatarUrl: string | null;
  /** URL de l'image de fond (vide = dégradé par défaut). */
  backgroundUrl: string;
  /** Couleur d'accent (anneau avatar + titre), entier RGB. */
  accentColor: number;
}

function hexColor(value: number): string {
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

function font(weight: 'bold' | 'normal', size: number): string {
  return `${weight} ${size}px ${FAMILY}`;
}

async function loadRemoteImage(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return loadImage(Buffer.from(await res.arrayBuffer()));
}

/** Dessine une image en mode « cover » (remplit tout le canvas sans déformer). */
function drawCover(
  ctx: SKRSContext2D,
  image: Awaited<ReturnType<typeof loadImage>>,
  width: number,
  height: number,
): void {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/** Rétrécit le texte jusqu'à ce qu'il tienne dans `maxWidth`. */
function fitText(
  ctx: SKRSContext2D,
  text: string,
  weight: 'bold' | 'normal',
  size: number,
  maxWidth: number,
): number {
  let current = size;
  ctx.font = font(weight, current);
  while (ctx.measureText(text).width > maxWidth && current > 16) {
    current -= 2;
    ctx.font = font(weight, current);
  }
  return current;
}

/** Génère une carte d'accueil/au revoir (PNG) avec image de fond personnalisée. */
export async function renderGreetCard(data: GreetCardData): Promise<Buffer> {
  const width = 1024;
  const height = 360;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const accent = hexColor(data.accentColor);

  // Fond : image « cover » si fournie, sinon dégradé sombre.
  let hasBackground = false;
  if (data.backgroundUrl) {
    try {
      drawCover(ctx, await loadRemoteImage(data.backgroundUrl), width, height);
      hasBackground = true;
    } catch {
      // image de fond indisponible : on retombe sur le dégradé
    }
  }
  if (!hasBackground) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1e2124');
    gradient.addColorStop(1, '#282b30');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // Voile sombre pour la lisibilité du texte.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, width, height);

  const centerX = width / 2;
  const avatarY = 110;
  const avatarR = 78;

  // Anneau d'accent
  ctx.beginPath();
  ctx.arc(centerX, avatarY, avatarR + 6, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  // Avatar (cercle)
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, avatarY, avatarR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#484b4f';
  ctx.fill();
  ctx.clip();
  if (data.avatarUrl) {
    try {
      const avatar = await loadRemoteImage(data.avatarUrl);
      ctx.drawImage(avatar, centerX - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2);
    } catch {
      // pas d'avatar : cercle gris
    }
  }
  ctx.restore();

  ctx.textAlign = 'center';

  // Titre (ex. « Bienvenue ! »)
  ctx.fillStyle = accent;
  fitText(ctx, data.title, 'bold', 40, width - 120);
  ctx.fillText(data.title, centerX, 245);

  // Nom
  ctx.fillStyle = '#ffffff';
  fitText(ctx, data.name, 'bold', 52, width - 120);
  ctx.fillText(data.name, centerX, 300);

  // Sous-titre
  if (data.subtitle) {
    ctx.fillStyle = '#d0d3d7';
    fitText(ctx, data.subtitle, 'normal', 28, width - 120);
    ctx.fillText(data.subtitle, centerX, 340);
  }

  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}
