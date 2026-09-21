/**
 * La persistance du monitoring : les mesures écrites en base, pour qu'elles
 * survivent au redémarrage du bot.
 *
 * Un tampon mémoire répond à « qu'est-ce qui se passe ? ». Il ne répond jamais à
 * « est-ce que la mémoire montait déjà avant le plantage d'hier soir ? » — et
 * c'est pourtant la question qu'on se pose *après* coup, une fois le process
 * reparti de zéro. D'où cette table : une ligne toutes les quinze secondes,
 * purgée au-delà de la rétention.
 *
 * **La base arrive par argument, jamais par import.** `metrics.ts` est chargé
 * par `logger.ts`, et `db.ts` crée son logger à l'initialisation : importer la
 * base ici fermerait le cycle et ferait tomber le démarrage sur une variable non
 * encore initialisée. L'appelant, lui, a déjà les deux sous la main.
 *
 * Rien de ce qui est ici ne doit pouvoir faire tomber le bot : une écriture de
 * métrique qui échoue est une courbe trouée, pas une panne. Les erreurs
 * remontent à l'appelant, qui les avale après les avoir consignées.
 */

import type { PrismaClient } from '@prisma/client';

/** Ce qu'on écrit à la fin d'un intervalle. */
export interface SampleRow {
  at: Date;
  /** Mesures brutes fondues dans cette ligne. 1 tant qu'elle est fraîche. */
  span: number;
  rss: number;
  heap: number;
  cpu: number;
  lag: number;
  ping: number | null;
  guilds: number;
  members: number;
  commands: number;
  commandFails: number;
  interactions: number;
  components: number;
  modals: number;
  autocomplete: number;
  rest: number;
  rateLimits: number;
  logTrace: number;
  logDebug: number;
  logInfo: number;
  logWarn: number;
  logError: number;
  logFatal: number;
}

/** L'apport d'une commande sur un intervalle, à ajouter à son cumul. */
export interface CommandDelta {
  module: string | null;
  count: number;
  errors: number;
  totalMs: number;
  lastAt: Date;
}

/** Le cumul d'une commande, tel qu'il est relu. */
export interface StoredCommand {
  name: string;
  module: string | null;
  count: number;
  errors: number;
  totalMs: number;
  lastAt: Date | null;
}

/**
 * Garde-fou de lecture.
 *
 * Sept jours d'échantillons font ~40 000 lignes ; au-delà, c'est une rétention
 * mal réglée ou une base héritée d'un réglage plus large, et il vaut mieux
 * rendre une fenêtre tronquée qu'avaler cent mégaoctets d'un coup.
 */
const MAX_ROWS = 60_000;

/**
 * Âge à partir duquel une mesure est fondue avec ses voisines.
 *
 * Vingt-quatre heures : la journée écoulée garde le pas de 15 secondes — c'est
 * l'échelle à laquelle on cherche un pic —, au-delà on regarde des tendances, et
 * cinq minutes suffisent à les dessiner.
 */
export const COMPACT_AFTER_MS = 86_400_000;

/** Durée d'une tranche compactée. */
export const COMPACT_BUCKET_MS = 300_000;

/** Mesures traitées par lot de compaction : des transactions courtes. */
const COMPACT_BATCH = 20_000;

/** Nombre maximal de lots par entretien, garde-fou contre la boucle infinie. */
const MAX_PASSES = 50;

/** Écrit l'échantillon de l'intervalle qui vient de se fermer. */
export async function insertSample(db: PrismaClient, row: SampleRow): Promise<void> {
  await db.metricSample.create({ data: row });
}

/**
 * Ajoute au cumul de chaque commande ce qu'elle a fait pendant l'intervalle.
 *
 * On incrémente plutôt qu'on n'écrase : deux instances du bot sur la même base
 * resteraient cohérentes, et surtout le cumul n'est jamais reconstruit de
 * mémoire — il n'aurait pas survécu au redémarrage, ce qui est précisément ce
 * qu'on répare ici.
 */
export async function bumpCommands(
  db: PrismaClient,
  deltas: Map<string, CommandDelta>,
): Promise<void> {
  for (const [name, delta] of deltas) {
    await db.metricCommand.upsert({
      where: { name },
      create: {
        name,
        module: delta.module,
        count: delta.count,
        errors: delta.errors,
        totalMs: delta.totalMs,
        lastAt: delta.lastAt,
      },
      update: {
        count: { increment: delta.count },
        errors: { increment: delta.errors },
        totalMs: { increment: delta.totalMs },
        lastAt: delta.lastAt,
        // Le module n'est réécrit que s'il est connu : une commande déplacée
        // garde son historique, une commande inconnue ne l'efface pas.
        ...(delta.module ? { module: delta.module } : {}),
      },
    });
  }
}

/**
 * Les échantillons d'une fenêtre, du plus ancien au plus récent.
 *
 * La borne haute n'est pas une coquetterie : une horloge qui recule (VPS remis à
 * l'heure, conteneur migré) laisse des lignes datées du futur, et sans elle la
 * fenêtre « dernière heure » les afficherait toutes.
 */
export async function readSamples(
  db: PrismaClient,
  from: Date,
  to: Date,
): Promise<{ rows: SampleRow[]; truncated: boolean }> {
  // Lecture du plus RÉCENT vers le plus ancien : si la fenêtre déborde du
  // garde-fou, ce qu'on perd doit être le début de la période, jamais la fin.
  // Tronquer par la tête afficherait une courbe qui s'arrête avant « maintenant »
  // — exactement l'inverse de ce qu'on est venu regarder.
  const rows = await db.metricSample.findMany({
    where: { at: { gte: from, lte: to } },
    orderBy: { at: 'desc' },
    take: MAX_ROWS,
    // L'identifiant ne sert qu'à la clé primaire : le panneau lit des mesures,
    // pas des lignes de table.
    omit: { id: true },
  });
  return { rows: rows.reverse(), truncated: rows.length >= MAX_ROWS };
}

/** Les commandes les plus appelées, cumul de toute la vie de l'instance. */
export function readCommands(db: PrismaClient, take = 20): Promise<StoredCommand[]> {
  return db.metricCommand.findMany({
    orderBy: { count: 'desc' },
    take,
  });
}

/** Ce que la base garde réellement : de quoi ne jamais promettre plus. */
export async function storeInfo(
  db: PrismaClient,
): Promise<{ samples: number; oldest: number | null }> {
  const [samples, first] = await Promise.all([
    db.metricSample.count(),
    db.metricSample.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
  ]);
  return { samples, oldest: first ? first.at.getTime() : null };
}

/**
 * Fond les vieilles mesures par tranches de cinq minutes.
 *
 * Sans elle, un mois de rétention ferait 170 000 lignes qu'il faudrait toutes
 * relire pour tracer mille pixels. Après elle, le même mois tient en une dizaine
 * de milliers de lignes — et rien n'est perdu de ce qui se lit à cette échelle :
 * les compteurs sont **additionnés** (le total d'appels d'une journée reste
 * exact) et les jauges **moyennées au prorata** du nombre de mesures fondues.
 *
 * Les lignes déjà fondues forment une tranche à elles seules : elles sont donc
 * ignorées au passage suivant, sans marqueur à maintenir.
 */
export async function compactSamples(db: PrismaClient, before: Date): Promise<number> {
  let total = 0;
  // Par lots, jusqu'à ce qu'il n'y ait plus rien à fondre : un premier passage
  // sur une base déjà remplie peut avoir des centaines de milliers de lignes de
  // retard, et s'arrêter au premier lot laisserait la table lourde pour de bon.
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const merged = await compactOnce(db, before);
    total += merged;
    if (merged === 0) break;
  }
  return total;
}

/** Un lot de compaction. Rend le nombre de lignes supprimées par fusion. */
async function compactOnce(db: PrismaClient, before: Date): Promise<number> {
  const rows = await db.metricSample.findMany({
    // `span: 1` = mesure encore brute. Sans ce filtre, chaque entretien
    // relirait tout l'historique déjà fondu pour ne rien en faire.
    where: { at: { lt: before }, span: 1 },
    orderBy: { at: 'asc' },
    take: COMPACT_BATCH,
  });
  if (rows.length === 0) return 0;

  // Regroupement sur une grille absolue : deux passages successifs découpent
  // ainsi les mêmes tranches, et une ligne déjà fondue retombe seule dans la
  // sienne.
  const buckets = new Map<number, typeof rows>();
  for (const row of rows) {
    const key = Math.floor(row.at.getTime() / COMPACT_BUCKET_MS);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  let merged = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const weight = bucket.reduce((total, row) => total + row.span, 0) || bucket.length;
    /** Moyenne pondérée par le poids : une ligne fondue compte pour ses mesures. */
    const mean = (pick: (row: (typeof bucket)[number]) => number): number =>
      bucket.reduce((total, row) => total + pick(row) * row.span, 0) / weight;
    const sum = (pick: (row: (typeof bucket)[number]) => number): number =>
      bucket.reduce((total, row) => total + pick(row), 0);
    const pings = bucket.filter((row) => row.ping !== null);

    const data = {
      // Fin de la tranche : une mesure fondue décrit ce qui précède, comme
      // l'échantillon dont elle est faite.
      at: new Date((key + 1) * COMPACT_BUCKET_MS),
      span: weight,
      rss: Math.round(mean((row) => row.rss)),
      heap: Math.round(mean((row) => row.heap)),
      cpu: Math.round(mean((row) => row.cpu)),
      lag: Math.round(mean((row) => row.lag) * 100) / 100,
      ping:
        pings.length > 0
          ? Math.round(
              pings.reduce((total, row) => total + (row.ping ?? 0) * row.span, 0) /
                pings.reduce((total, row) => total + row.span, 0),
            )
          : null,
      guilds: Math.round(mean((row) => row.guilds)),
      members: Math.round(mean((row) => row.members)),
      commands: sum((row) => row.commands),
      commandFails: sum((row) => row.commandFails),
      interactions: sum((row) => row.interactions),
      components: sum((row) => row.components),
      modals: sum((row) => row.modals),
      autocomplete: sum((row) => row.autocomplete),
      rest: sum((row) => row.rest),
      rateLimits: sum((row) => row.rateLimits),
      logTrace: sum((row) => row.logTrace),
      logDebug: sum((row) => row.logDebug),
      logInfo: sum((row) => row.logInfo),
      logWarn: sum((row) => row.logWarn),
      logError: sum((row) => row.logError),
      logFatal: sum((row) => row.logFatal),
    };

    // Remplacement en transaction : une coupure entre la création et la
    // suppression compterait deux fois la même journée d'appels.
    await db.$transaction([
      db.metricSample.deleteMany({ where: { id: { in: bucket.map((row) => row.id) } } }),
      db.metricSample.create({ data }),
    ]);
    merged += bucket.length - 1;
  }

  return merged;
}

/** Efface les échantillons plus vieux que la rétention. Rend le nombre supprimé. */
export async function purgeSamples(db: PrismaClient, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const { count } = await db.metricSample.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}
