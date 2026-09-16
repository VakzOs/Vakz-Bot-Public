import type { BotContext } from '../../core/module.js';

/** Réglages d'un canneton posé sur un voyageur. */
export interface DucklingSetup {
  turns: number;
  stealPercent: number;
  distancePercent: number;
  damagePercent: number;
}

/** Ce que le canneton a coûté sur UN événement (pour l'affichage). */
export interface DucklingReport {
  /** Pièces prélevées sur les gains de cet événement. */
  stolenCoins: number;
  /** Distance perdue sur cet événement. */
  distanceLost: number;
  /** Dégâts supplémentaires subis sur cet événement. */
  extraDamage: number;
  /** Événements restants APRÈS celui-ci (0 = il vient de se détacher). */
  turnsLeft: number;
  /** Le canneton s'est détaché à la fin de cet événement. */
  gone: boolean;
  /** Cumul volé depuis qu'il colle. */
  totalStolen: number;
  stealPercent: number;
  distancePercent: number;
  damagePercent: number;
  ownerId: string | null;
}

/**
 * Part prélevée par le canneton sur un gain (ou des dégâts) : **au moins 1**
 * dès qu'il y a quelque chose à prendre. Un simple arrondi à l'inférieur le
 * rendait inoffensif sur les petits gains (10 % de 4 = 0,4 → 0). Jamais plus
 * que le montant lui-même, pour ne pas inverser le signe.
 */
function bite(amount: number, percent: number): number {
  if (amount <= 0 || percent <= 0) return 0;
  return Math.min(amount, Math.max(1, Math.floor((amount * percent) / 100)));
}

/** Canneton actuellement collé à ce membre, s'il y en a un. */
export async function getDuckling(ctx: BotContext, guildId: string, userId: string) {
  return ctx.db.duckling.findUnique({ where: { guildId_userId: { guildId, userId } } });
}

/**
 * Colle un canneton à `userId`. Si un canneton est déjà là, on repart sur les
 * nouveaux réglages en CUMULANT les tours restants (et on garde le butin déjà
 * volé, qui appartient à l'historique de la victime).
 */
export async function stickDuckling(
  ctx: BotContext,
  guildId: string,
  userId: string,
  ownerId: string | null,
  setup: DucklingSetup,
): Promise<number> {
  const existing = await getDuckling(ctx, guildId, userId);
  const turnsLeft = Math.min(999, (existing?.turnsLeft ?? 0) + setup.turns);
  await ctx.db.duckling.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {
      ownerId,
      turnsLeft,
      stealPercent: setup.stealPercent,
      distancePercent: setup.distancePercent,
      damagePercent: setup.damagePercent,
    },
    create: {
      guildId,
      userId,
      ownerId,
      turnsLeft,
      stealPercent: setup.stealPercent,
      distancePercent: setup.distancePercent,
      damagePercent: setup.damagePercent,
    },
  });
  return turnsLeft;
}

/** Retire le canneton (fin de durée, ou objet qui l'enlève). */
export async function removeDuckling(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<boolean> {
  const { count } = await ctx.db.duckling.deleteMany({ where: { guildId, userId } });
  return count > 0;
}

/**
 * Applique le canneton aux gains/pertes d'UN événement de Route et consomme un
 * tour. Modifie `deltas` en place et renvoie le détail pour l'embed, ou `null`
 * si aucun canneton ne colle au voyageur.
 */
export async function applyDucklingToMove(
  ctx: BotContext,
  guildId: string,
  userId: string,
  deltas: { health: number; energy: number; distance: number; coins: number },
): Promise<DucklingReport | null> {
  const duckling = await getDuckling(ctx, guildId, userId);
  if (!duckling) return null;

  // Il ne rogne que les GAINS (distance/pièces positives) et n'amplifie que les
  // dégâts (santé négative) : il ne peut jamais aider sa victime.
  const distanceLost = bite(deltas.distance, duckling.distancePercent);
  const extraDamage = bite(-deltas.health, duckling.damagePercent);
  const stolenCoins = bite(deltas.coins, duckling.stealPercent);

  deltas.distance -= distanceLost;
  deltas.health -= extraDamage;
  deltas.coins -= stolenCoins;

  const turnsLeft = duckling.turnsLeft - 1;
  const totalStolen = duckling.stolenCoins + stolenCoins;
  if (turnsLeft <= 0) {
    await ctx.db.duckling.delete({ where: { id: duckling.id } }).catch(() => undefined);
  } else {
    await ctx.db.duckling.update({
      where: { id: duckling.id },
      data: { turnsLeft, stolenCoins: totalStolen },
    });
  }

  return {
    stolenCoins,
    distanceLost,
    extraDamage,
    turnsLeft: Math.max(0, turnsLeft),
    gone: turnsLeft <= 0,
    totalStolen,
    stealPercent: duckling.stealPercent,
    distancePercent: duckling.distancePercent,
    damagePercent: duckling.damagePercent,
    ownerId: duckling.ownerId,
  };
}
