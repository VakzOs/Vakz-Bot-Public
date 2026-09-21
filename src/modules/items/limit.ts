import type { BotContext } from '../../core/module.js';

/**
 * Plafond d'objets par serveur — réglage GLOBAL de l'instance, modifiable par le
 * propriétaire du bot (droit /maj) via `/objets-limite`. Stocké dans `AppSetting`
 * sous la clé ci-dessous. `null` (défaut) = illimité ; en base, 0 représente
 * « illimité » pour garder une valeur non nulle.
 */
const KEY = 'items.maxPerGuild';

/** Plafond courant, ou `null` si illimité (aucune limite appliquée). */
export async function getItemLimit(ctx: BotContext): Promise<number | null> {
  const row = await ctx.db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return null;
  const n = Number.parseInt(row.value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Fixe le plafond. `null` (ou une valeur ≤ 0) signifie « illimité ». Renvoie la
 * valeur normalisée effectivement enregistrée (`null` si illimité).
 */
export async function setItemLimit(ctx: BotContext, value: number | null): Promise<number | null> {
  const normalized =
    value !== null && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  const stored = String(normalized ?? 0);
  await ctx.db.appSetting.upsert({
    where: { key: KEY },
    update: { value: stored },
    create: { key: KEY, value: stored },
  });
  return normalized;
}
