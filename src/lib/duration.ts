const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  j: 86_400_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse une durée du type `10m`, `1h30m`, `2j` en millisecondes.
 * Unités : s, m, h, j/d (jour), w (semaine). Renvoie `null` si invalide.
 */
export function parseDuration(input: string): number | null {
  let total = 0;
  let found = false;
  for (const match of input.trim().toLowerCase().matchAll(/(\d+)\s*([smhjdw])/g)) {
    const value = Number(match[1]);
    const unit = match[2];
    if (!unit || Number.isNaN(value)) continue;
    total += value * (UNIT_MS[unit] ?? 0);
    found = true;
  }
  return found && total > 0 ? total : null;
}

/** Formate une durée (ms) en texte court, ex. `1j 2h 30m`. */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let remaining = Math.floor(ms / 1000);
  const units: [number, string][] = [
    [86_400, 'j'],
    [3_600, 'h'],
    [60, 'm'],
    [1, 's'],
  ];
  for (const [seconds, label] of units) {
    const amount = Math.floor(remaining / seconds);
    if (amount > 0) {
      parts.push(`${amount}${label}`);
      remaining -= amount * seconds;
    }
  }
  return parts.join(' ') || '0s';
}
