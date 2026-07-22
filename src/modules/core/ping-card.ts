import {
  Card,
  createCard,
  drawAvatarCircle,
  fitText,
  hexColor,
  roundedRect,
} from '../../lib/canvas.js';
import { Colors } from '../../lib/embeds.js';

/** Couleur d'état selon la latence (ms) : vert < 100, orange < 250, rouge sinon. */
export function latencyColor(ms: number): string {
  if (ms < 100) return hexColor(Colors.success);
  if (ms < 250) return hexColor(Colors.warning);
  return hexColor(Colors.error);
}

export interface PingChip {
  label: string;
  value: string;
  /** Latence (ms) : pilote la couleur de pastille. Absent = pastille brand (Build). */
  ms?: number;
}

export interface PingCardData {
  title: string;
  subtitle: string;
  avatarUrl?: string;
  /** Initiales à afficher si l'avatar est indisponible (placeholder). */
  initials: string;
  chips: PingChip[];
}

/** Génère la carte `/ping` (PNG) : avatar + titre + chips de latence à pastilles. */
export async function renderPingCard(data: PingCardData): Promise<Buffer> {
  const W = 920;
  const H = 300;
  const { canvas, ctx } = createCard(W, H);

  const latencies = data.chips.map((c) => c.ms).filter((m): m is number => m !== undefined);
  const health = latencies.length ? latencyColor(Math.max(...latencies)) : hexColor(Colors.brand);

  await drawAvatarCircle(ctx, {
    x: 128,
    y: 148,
    radius: 84,
    url: data.avatarUrl,
    placeholderText: data.initials,
    ring: health,
    ringWidth: 5,
  });

  const left = 252;
  const textMax = W - left - 40;

  ctx.fillStyle = Card.text;
  fitText(ctx, data.title, left, 92, {
    maxWidth: textMax,
    weight: 'bold',
    maxSize: 50,
    minSize: 30,
  });

  ctx.fillStyle = Card.textMuted;
  fitText(ctx, data.subtitle, left, 130, {
    maxWidth: textMax,
    weight: 'normal',
    maxSize: 26,
    minSize: 16,
  });

  const gap = 20;
  const chipY = 168;
  const chipH = 96;
  const count = Math.max(1, data.chips.length);
  const chipW = (W - left - 40 - gap * (count - 1)) / count;
  data.chips.forEach((chip, i) => {
    const x = left + i * (chipW + gap);
    ctx.fillStyle = Card.panel;
    roundedRect(ctx, x, chipY, chipW, chipH, 18);
    ctx.fill();
    // Pastille d'état.
    ctx.beginPath();
    ctx.arc(x + chipW - 22, chipY + 24, 7, 0, Math.PI * 2);
    ctx.fillStyle = chip.ms !== undefined ? latencyColor(chip.ms) : hexColor(Colors.brand);
    ctx.fill();
    // Label (s'arrête avant la pastille) — auto-ajusté.
    ctx.fillStyle = Card.textMuted;
    fitText(ctx, chip.label, x + 20, chipY + 36, {
      maxWidth: chipW - 52,
      weight: 'normal',
      maxSize: 21,
      minSize: 15,
    });
    // Valeur — auto-ajustée pour ne jamais déborder (ex. date de build).
    ctx.fillStyle = Card.text;
    fitText(ctx, chip.value, x + 20, chipY + 74, {
      maxWidth: chipW - 40,
      weight: 'bold',
      maxSize: 34,
      minSize: 18,
    });
  });

  return canvas.toBuffer('image/png');
}
