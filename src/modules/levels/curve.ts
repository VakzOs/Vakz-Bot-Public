/**
 * Courbe d'XP (style Mee6) : XP nécessaire pour passer du niveau `level` au
 * niveau suivant. `factor` étire la courbe (>1 = progression plus lente).
 */
export function xpForNextLevel(level: number, factor = 1): number {
  return Math.round((5 * level * level + 50 * level + 100) * factor);
}

/** XP total cumulé requis pour atteindre exactement `level`. */
export function totalXpForLevel(level: number, factor = 1): number {
  let total = 0;
  for (let l = 0; l < level; l += 1) {
    total += xpForNextLevel(l, factor);
  }
  return total;
}

/** Niveau atteint avec un XP total donné. */
export function levelFromXp(xp: number, factor = 1): number {
  let level = 0;
  while (xp >= totalXpForLevel(level + 1, factor)) {
    level += 1;
  }
  return level;
}

/** Progression dans le niveau courant. */
export function levelProgress(
  xp: number,
  factor = 1,
): { level: number; current: number; needed: number } {
  const level = levelFromXp(xp, factor);
  const base = totalXpForLevel(level, factor);
  return { level, current: xp - base, needed: xpForNextLevel(level, factor) };
}
