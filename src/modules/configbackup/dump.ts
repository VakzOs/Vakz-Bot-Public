import { randomUUID } from 'node:crypto';
import type { BotContext } from '../../core/module.js';

/**
 * Dump générique des données d'un serveur.
 *
 * Le principe est le même que celui de la purge (`web-api.ts`) : plutôt
 * qu'énumérer les tables à la main — liste qui se périme au premier module
 * ajouté — on **découvre** le schéma à l'exécution. Toute table portant une
 * colonne `guildId` appartient à un serveur ; toute table qui pointe (clé
 * étrangère) vers une table déjà retenue en fait partie aussi, ce qui rattrape
 * les tables filles sans `guildId` (votes de suggestions, participations aux
 * concours, cartons de bingo…).
 *
 * S'ajoute une troisième catégorie : les lignes **partagées**. Un catalogue
 * commun à tous les serveurs (les personnages du gacha, par exemple) n'appartient
 * à aucun d'eux, mais les données d'un serveur le référencent. Les laisser
 * dehors donnerait un fichier irrestaurable ailleurs — SQLite applique les clés
 * étrangères et rejetterait la restauration entière. On embarque donc les seules
 * lignes partagées réellement référencées, et on les réconcilie à l'arrivée
 * plutôt que de les écraser : elles ne nous appartiennent pas.
 *
 * Conséquence : un nouveau module dont les données portent un `guildId` est
 * sauvegardé et restauré sans toucher une ligne de ce fichier.
 */

/** Une colonne, avec son type déclaré (`TEXT`, `INTEGER`, `DATETIME`…). */
export interface ColumnInfo {
  name: string;
  type: string;
  /** La colonne fait-elle partie de la clé primaire ? */
  primary: boolean;
}

/** Une clé étrangère : `from` de cette table pointe vers `table`.`to`. */
export interface ForeignKey {
  table: string;
  from: string;
  to: string;
}

/** Une table du schéma, et sa place dans le graphe des clés étrangères. */
export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  /** La table entre-t-elle dans la sauvegarde d'un serveur ? */
  kept: boolean;
  /** La table porte-t-elle elle-même la colonne `guildId` ? */
  scoped: boolean;
  /** Toutes ses clés étrangères. */
  foreignKeys: ForeignKey[];
  /** Celles qui visent une table retenue (ordre de suppression/insertion). */
  parents: ForeignKey[];
  /**
   * Index uniques hors clé primaire : les « clés naturelles » qui permettent de
   * reconnaître une ligne partagée déjà présente sous un autre identifiant.
   */
  uniqueKeys: string[][];
  /** Profondeur dans le graphe : un parent a toujours une profondeur moindre. */
  depth: number;
}

/**
 * Tables volontairement hors sauvegarde.
 *
 * - `ModuleConfig` : déjà portée par `modules` (config + activation), avec la
 *   validation zod que la restauration brute n'aurait pas.
 * - `LogMessageSnapshot` / `LogRollback` : cache du module Logs (copie de chaque
 *   message vu, pour `/rollback`). C'est de loin la plus grosse table du bot, et
 *   elle n'a aucun sens une fois restaurée — les messages visés n'existent plus.
 * - `TempVoiceChannel` : salons vocaux éphémères, supprimés avec leur serveur.
 * - `GachaRoll` : un tirage en cours n'est qu'un message Discord porteur de
 *   boutons ; restauré, il ressusciterait des boutons sans message.
 */
export const EXCLUDED_TABLES = new Set([
  'ModuleConfig',
  'LogMessageSnapshot',
  'LogRollback',
  'TempVoiceChannel',
  'GachaRoll',
]);

/** Colonne qui rattache une ligne à un serveur. */
const GUILD_COLUMN = 'guildId';

/** Paramètres liés par requête (SQLite en accepte 999 dans ses vieux builds). */
const MAX_BOUND_PARAMS = 900;

/** Une valeur de colonne telle qu'elle transite dans le fichier de sauvegarde. */
export type CellValue = string | number | boolean | null;
/** Une ligne : la valeur de chaque colonne, par nom. */
export type DumpRow = Record<string, CellValue>;
/** Les lignes de chaque table, par nom de table. */
export type DataDump = Record<string, DumpRow[]>;

/** Ce qu'une sauvegarde retient de la base, pour un serveur. */
export interface GuildDump {
  /** Les lignes qui appartiennent au serveur. */
  data: DataDump;
  /** Les lignes partagées (hors serveur) que ces données référencent. */
  shared: DataDump;
}

interface RawColumn {
  name: unknown;
  type: unknown;
  pk: unknown;
}

interface RawForeignKey {
  table: unknown;
  from: unknown;
  to: unknown;
}

interface RawIndex {
  name: unknown;
  unique: unknown;
  origin: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/**
 * Découvre les tables et les ordonne (parents d'abord).
 *
 * Le résultat est mis en cache : le schéma ne change pas en cours d'exécution,
 * et une sauvegarde planifiée n'a pas à réinterroger `sqlite_master` chaque nuit.
 */
let cachedTables: TableInfo[] | null = null;

/** Vide le cache du schéma (utile aux vérifications hors ligne). */
export function resetTableCache(): void {
  cachedTables = null;
}

export async function discoverTables(ctx: BotContext): Promise<TableInfo[]> {
  if (cachedTables) return cachedTables;

  const names = await ctx.db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_prisma%' ESCAPE '\\'",
  );

  // 1. Colonnes, clés étrangères et clés naturelles de chaque table.
  const tables = new Map<string, TableInfo>();
  for (const { name } of names) {
    if (EXCLUDED_TABLES.has(name)) continue;
    // `name` vient de sqlite_master : jamais d'entrée utilisateur.
    const columns = await ctx.db.$queryRawUnsafe<RawColumn[]>(
      'SELECT * FROM pragma_table_info(?)',
      name,
    );
    const fks = await ctx.db.$queryRawUnsafe<RawForeignKey[]>(
      'SELECT * FROM pragma_foreign_key_list(?)',
      name,
    );
    const indexes = await ctx.db.$queryRawUnsafe<RawIndex[]>(
      'SELECT * FROM pragma_index_list(?)',
      name,
    );

    const uniqueKeys: string[][] = [];
    for (const index of indexes) {
      // `origin = 'pk'` est l'index de la clé primaire : ce n'est pas une clé
      // naturelle, on la traite à part.
      if (Number(index.unique) !== 1 || text(index.origin) === 'pk') continue;
      const parts = await ctx.db.$queryRawUnsafe<Array<{ name: unknown }>>(
        'SELECT * FROM pragma_index_info(?)',
        text(index.name),
      );
      const key = parts.map((part) => text(part.name)).filter(Boolean);
      if (key.length > 0) uniqueKeys.push(key);
    }

    tables.set(name, {
      name,
      columns: columns.map((column) => ({
        name: text(column.name),
        type: text(column.type).toUpperCase(),
        primary: Number(column.pk) > 0,
      })),
      kept: false,
      scoped: columns.some((column) => text(column.name) === GUILD_COLUMN),
      foreignKeys: fks.map((fk) => ({
        table: text(fk.table),
        from: text(fk.from),
        to: text(fk.to),
      })),
      parents: [],
      uniqueKeys,
      depth: 0,
    });
  }

  // 2. Tables retenues : celles portant `guildId`, puis, de proche en proche,
  //    celles qui pointent vers une table déjà retenue.
  for (const table of tables.values()) table.kept = table.scoped;
  for (let pass = 0; pass < tables.size; pass += 1) {
    let grew = false;
    for (const table of tables.values()) {
      if (table.kept) continue;
      if (table.foreignKeys.some((fk) => tables.get(fk.table)?.kept)) {
        table.kept = true;
        grew = true;
      }
    }
    if (!grew) break;
  }
  for (const table of tables.values()) {
    table.parents = table.foreignKeys.filter(
      (fk) => fk.table !== table.name && tables.get(fk.table)?.kept === true,
    );
  }

  // 3. Profondeur : une table est insérée après tous ses parents. Point fixe
  //    borné : une référence circulaire ne fait pas boucler à l'infini, elle
  //    laisse simplement les profondeurs en l'état.
  for (let pass = 0; pass < tables.size; pass += 1) {
    let changed = false;
    for (const table of tables.values()) {
      const depth = table.foreignKeys.reduce(
        (max, fk) =>
          fk.table === table.name ? max : Math.max(max, (tables.get(fk.table)?.depth ?? 0) + 1),
        0,
      );
      if (depth > table.depth) {
        table.depth = depth;
        changed = true;
      }
    }
    if (!changed) break;
  }

  cachedTables = [...tables.values()].sort(
    (a, b) => a.depth - b.depth || a.name.localeCompare(b.name),
  );
  return cachedTables;
}

/** Normalise une valeur lue en base pour le JSON (les dates en ISO). */
function encodeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return String(value);
}

/** Refait le chemin inverse : le JSON vers ce que le pilote SQLite attend. */
function decodeCell(value: CellValue, column: ColumnInfo): unknown {
  if (value === null) return null;
  // Une colonne DATETIME doit être liée comme une vraie date : liée en chaîne,
  // elle serait stockée telle quelle et Prisma ne saurait plus la relire.
  if (column.type === 'DATETIME') {
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (column.type === 'BOOLEAN') return value === true || value === 1 || value === 'true';
  return value;
}

/** Convertit des lignes brutes en lignes de sauvegarde, colonne par colonne. */
function encodeRows(table: TableInfo, rows: Record<string, unknown>[]): DumpRow[] {
  return rows.map((row) => {
    const out: DumpRow = {};
    for (const column of table.columns) out[column.name] = encodeCell(row[column.name]);
    return out;
  });
}

/** Découpe une liste de valeurs en lots liables par SQLite. */
function chunk<T>(values: T[], size = MAX_BOUND_PARAMS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Rassemble les lignes **partagées** que les données du serveur référencent.
 *
 * On suit les clés étrangères depuis les lignes déjà retenues : toute valeur qui
 * ne trouve pas son parent parmi elles désigne une ligne hors du serveur (une
 * entrée d'un catalogue commun). On la joint à la sauvegarde, puis on recommence
 * — une ligne partagée peut elle-même en référencer une autre.
 */
async function collectShared(
  ctx: BotContext,
  tables: TableInfo[],
  data: DataDump,
): Promise<DataDump> {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const shared: DataDump = {};
  /** Clés déjà couvertes, par table puis par colonne référencée. */
  const covered = new Map<string, Map<string, Set<CellValue>>>();

  const keysOf = (tableName: string, column: string): Set<CellValue> => {
    let columns = covered.get(tableName);
    if (!columns) {
      columns = new Map();
      covered.set(tableName, columns);
    }
    let keys = columns.get(column);
    if (!keys) {
      keys = new Set(
        [...(data[tableName] ?? []), ...(shared[tableName] ?? [])].map(
          (row) => row[column] ?? null,
        ),
      );
      columns.set(column, keys);
    }
    return keys;
  };

  let frontier: DataDump = data;
  for (let pass = 0; pass < tables.length; pass += 1) {
    const next: DataDump = {};

    for (const [tableName, rows] of Object.entries(frontier)) {
      const table = byName.get(tableName);
      if (!table || rows.length === 0) continue;

      for (const fk of table.foreignKeys) {
        // Une table exclue de la sauvegarde n'est pas une dépendance à embarquer.
        const parent = byName.get(fk.table);
        if (!parent) continue;

        const known = keysOf(parent.name, fk.to);
        const missing = new Set<CellValue>();
        for (const row of rows) {
          const value = row[fk.from];
          if (value === null || value === undefined) continue;
          if (!known.has(value)) missing.add(value);
        }
        if (missing.size === 0) continue;

        const fetched: Record<string, unknown>[] = [];
        for (const batch of chunk([...missing])) {
          const placeholders = batch.map(() => '?').join(',');
          fetched.push(
            ...(await ctx.db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM "${parent.name}" WHERE "${fk.to}" IN (${placeholders})`,
              ...batch,
            )),
          );
        }
        if (fetched.length === 0) continue;

        const encoded = encodeRows(parent, fetched);
        shared[parent.name] = [...(shared[parent.name] ?? []), ...encoded];
        next[parent.name] = [...(next[parent.name] ?? []), ...encoded];
        // Les nouvelles lignes couvrent leurs propres clés, y compris pour les
        // autres colonnes déjà interrogées de cette table.
        for (const [column, keys] of covered.get(parent.name) ?? []) {
          for (const row of encoded) keys.add(row[column] ?? null);
        }
      }
    }

    if (Object.keys(next).length === 0) break;
    frontier = next;
  }

  return shared;
}

/**
 * Exporte toutes les lignes du serveur : d'abord les tables portant `guildId`,
 * puis les tables filles, retrouvées par leur clé étrangère vers les lignes
 * déjà exportées — et enfin les lignes partagées qu'elles référencent.
 */
export async function exportData(ctx: BotContext, guildId: string): Promise<GuildDump> {
  const tables = (await discoverTables(ctx)).filter((table) => table.kept);
  const data: DataDump = {};
  // IDs déjà exportés, par table : servent à retrouver les lignes filles.
  const exportedIds = new Map<string, Map<string, Set<CellValue>>>();

  for (const table of tables) {
    let rows: Record<string, unknown>[] = [];

    if (table.scoped) {
      rows = await ctx.db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM "${table.name}" WHERE "${GUILD_COLUMN}" = ?`,
        guildId,
      );
    } else {
      // Table fille : ses lignes sont celles qui pointent vers un parent exporté.
      for (const parent of table.parents) {
        const keys = exportedIds.get(parent.table)?.get(parent.to);
        if (!keys || keys.size === 0) continue;
        for (const batch of chunk([...keys])) {
          const placeholders = batch.map(() => '?').join(',');
          rows.push(
            ...(await ctx.db.$queryRawUnsafe<Record<string, unknown>[]>(
              `SELECT * FROM "${table.name}" WHERE "${parent.from}" IN (${placeholders})`,
              ...batch,
            )),
          );
        }
      }
      // Un même enfant peut pointer vers plusieurs parents exportés.
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const key = JSON.stringify(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (rows.length === 0) continue;
    const encoded = encodeRows(table, rows);
    data[table.name] = encoded;

    // Mémorise les clés référencées par d'éventuelles tables filles.
    const referenced = new Set(
      tables.flatMap((other) =>
        other.parents.filter((parent) => parent.table === table.name).map((parent) => parent.to),
      ),
    );
    if (referenced.size > 0) {
      const byColumn = new Map<string, Set<CellValue>>();
      for (const column of referenced) {
        byColumn.set(column, new Set(encoded.map((row) => row[column] ?? null)));
      }
      exportedIds.set(table.name, byColumn);
    }
  }

  return { data, shared: await collectShared(ctx, await discoverTables(ctx), data) };
}

/**
 * Colonne de clé primaire d'une table, quand c'est une clé simple et textuelle
 * — le seul cas où l'on sait en fabriquer une neuve, ou reconnaître une ligne
 * partagée déjà présente. Une clé composite ou numérique laisse les lignes
 * telles quelles.
 */
function primaryKeyColumn(table: TableInfo): ColumnInfo | null {
  const keys = table.columns.filter((column) => column.primary);
  return keys.length === 1 && keys[0]?.type === 'TEXT' ? keys[0] : null;
}

/** Bilan d'une restauration de données. */
export interface RestoreStats {
  /** Lignes insérées, par table. */
  inserted: Record<string, number>;
  /** Total des lignes du serveur insérées. */
  total: number;
  /** Lignes partagées ajoutées (catalogues communs absents de cette base). */
  sharedInserted: number;
  /** Lignes partagées déjà présentes, reconnues et ré-appariées. */
  sharedMatched: number;
  /** Tables du fichier inconnues du schéma actuel (ignorées). */
  skippedTables: string[];
}

/** Une valeur de cellule valide dans un fichier importé. */
function isCell(value: unknown): value is CellValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Valide et normalise une section de données lue dans un fichier importé : on ne
 * fait jamais confiance au contenu du fichier — seules les tables et colonnes
 * réellement présentes dans le schéma seront ensuite écrites.
 */
export function parseDataDump(value: unknown): DataDump | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const dump: DataDump = {};
  for (const [table, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const kept: DumpRow[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const clean: DumpRow = {};
      for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
        if (isCell(cell)) clean[key] = cell;
      }
      if (Object.keys(clean).length > 0) kept.push(clean);
    }
    dump[table] = kept;
  }
  return dump;
}

/** Client utilisable dans une transaction (le sous-ensemble dont on se sert). */
type Executor = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

/** Écrit des lignes par lots, en respectant la limite de paramètres de SQLite. */
async function insertRows(
  tx: Executor,
  table: TableInfo,
  rows: DumpRow[],
  values: (row: DumpRow, column: ColumnInfo) => unknown,
): Promise<void> {
  const columns = table.columns.filter((column) =>
    rows.some((row) => row[column.name] !== undefined),
  );
  if (columns.length === 0) return;

  const quoted = columns.map((column) => `"${column.name}"`).join(',');
  const perStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));

  for (const batch of chunk(rows, perStatement)) {
    const params: unknown[] = [];
    for (const row of batch) {
      for (const column of columns) params.push(values(row, column));
    }
    const tuples = batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    await tx.$executeRawUnsafe(
      `INSERT OR REPLACE INTO "${table.name}" (${quoted}) VALUES ${tuples}`,
      ...params,
    );
  }
}

/**
 * Installe les lignes partagées : celles d'un catalogue commun à tous les
 * serveurs, que les données du serveur référencent.
 *
 * Elles ne nous appartiennent pas : on ne les écrase jamais. Trois cas, dans cet
 * ordre — déjà là sous le même identifiant (rien à faire) ; déjà là sous un
 * autre identifiant, reconnue par une clé naturelle (on remappe, et les lignes
 * du serveur suivront) ; absente (on l'insère telle quelle).
 */
async function restoreShared(
  tx: Executor,
  tables: TableInfo[],
  shared: DataDump,
  ids: Map<string, string>,
  stats: RestoreStats,
): Promise<void> {
  for (const table of tables) {
    const rows = shared[table.name];
    if (!rows || rows.length === 0) continue;
    const key = primaryKeyColumn(table);
    if (!key) continue;

    // 1. Ce qui est déjà là sous le même identifiant.
    const present = new Set<CellValue>();
    const wanted = rows.map((row) => row[key.name]).filter((value) => value !== null);
    for (const batch of chunk(wanted)) {
      const placeholders = batch.map(() => '?').join(',');
      const found = await tx.$queryRawUnsafe<Array<Record<string, CellValue>>>(
        `SELECT "${key.name}" FROM "${table.name}" WHERE "${key.name}" IN (${placeholders})`,
        ...batch,
      );
      for (const row of found) present.add(row[key.name] ?? null);
    }

    let pending = rows.filter((row) => !present.has(row[key.name] ?? null));

    // 2. Ce qui est déjà là sous un autre identifiant, reconnu par clé naturelle.
    for (const natural of table.uniqueKeys) {
      if (pending.length === 0) break;
      const first = natural[0];
      if (!first) continue;
      // Une clé partiellement nulle ne peut rien identifier : SQLite considère
      // deux NULL comme distincts dans un index unique.
      const usable = pending.filter((row) =>
        natural.every((column) => row[column] !== null && row[column] !== undefined),
      );
      if (usable.length === 0) continue;

      const candidates = new Map<string, CellValue>();
      const probes = [...new Set(usable.map((row) => row[first] as CellValue))];
      for (const batch of chunk(probes)) {
        const placeholders = batch.map(() => '?').join(',');
        const columns = [key.name, ...natural].map((column) => `"${column}"`).join(',');
        const found = await tx.$queryRawUnsafe<Array<Record<string, CellValue>>>(
          `SELECT ${columns} FROM "${table.name}" WHERE "${first}" IN (${placeholders})`,
          ...batch,
        );
        for (const row of found) {
          candidates.set(
            JSON.stringify(natural.map((column) => row[column])),
            row[key.name] ?? null,
          );
        }
      }

      pending = pending.filter((row) => {
        const match = candidates.get(JSON.stringify(natural.map((column) => row[column])));
        if (match === undefined || match === null) return true;
        const original = row[key.name];
        if (typeof original === 'string' && typeof match === 'string' && original !== match) {
          ids.set(original, match);
        }
        stats.sharedMatched += 1;
        return false;
      });
    }

    // 3. Le reste : absent de cette base, on l'ajoute tel quel. Une ligne
    //    partagée n'appartient à aucun serveur : ni `guildId` réécrit, ni
    //    identifiants remappés.
    if (pending.length > 0) {
      await insertRows(tx, table, pending, (row, column) =>
        decodeCell(row[column.name] ?? null, column),
      );
      stats.sharedInserted += pending.length;
    }
  }
}

/**
 * Remplace les données du serveur par celles du fichier.
 *
 * Tout se fait dans **une** transaction : une restauration à moitié appliquée
 * laisserait un serveur dans un état que personne ne saurait décrire. L'ordre
 * suit le graphe des clés étrangères — suppression des enfants vers les
 * parents, insertion des parents vers les enfants — sans quoi SQLite refuse les
 * lignes filles (les contraintes sont bien appliquées).
 *
 * `remap` réécrit au passage les identifiants de salons et de rôles quand la
 * restauration vise un autre serveur que celui d'origine.
 */
export async function restoreData(
  ctx: BotContext,
  guildId: string,
  dump: DataDump,
  shared: DataDump,
  remap: Map<string, string>,
  opts: { regenerateIds: boolean } = { regenerateIds: false },
): Promise<RestoreStats> {
  const all = await discoverTables(ctx);
  const tables = all.filter((table) => table.kept);
  const byName = new Map(all.map((table) => [table.name, table]));
  const stats: RestoreStats = {
    inserted: {},
    total: 0,
    sharedInserted: 0,
    sharedMatched: 0,
    skippedTables: [],
  };

  for (const name of Object.keys(dump)) {
    if (!byName.get(name)?.kept) stats.skippedTables.push(name);
  }

  // Restauration vers un AUTRE serveur : les lignes gardent la clé primaire du
  // serveur d'origine. Les réécrire telles quelles écraserait ses données —
  // la sauvegarde le viderait au lieu de le laisser tranquille. On leur donne
  // donc des clés neuves, et le remappage des chaînes propage la nouvelle clé
  // aux lignes filles qui la référencent (inventaires, votes, cartons…).
  const ids = new Map(remap);
  if (opts.regenerateIds) {
    for (const table of tables) {
      const rows = dump[table.name];
      const key = primaryKeyColumn(table);
      if (!rows || !key) continue;
      for (const row of rows) {
        const current = row[key.name];
        if (typeof current === 'string' && current !== '') ids.set(current, randomUUID());
      }
    }
  }

  await ctx.db.$transaction(
    async (tx) => {
      // 1. Table rase, des enfants vers les parents (les cascades ne suffisent
      //    pas : toutes les FK ne sont pas forcément en CASCADE).
      for (const table of [...tables].reverse()) {
        if (table.scoped) {
          await tx.$executeRawUnsafe(
            `DELETE FROM "${table.name}" WHERE "${GUILD_COLUMN}" = ?`,
            guildId,
          );
          continue;
        }
        for (const parent of table.parents) {
          const parentInfo = byName.get(parent.table);
          if (!parentInfo?.scoped) continue;
          await tx.$executeRawUnsafe(
            `DELETE FROM "${table.name}" WHERE "${parent.from}" IN ` +
              `(SELECT "${parent.to}" FROM "${parent.table}" WHERE "${GUILD_COLUMN}" = ?)`,
            guildId,
          );
        }
      }

      // 2. Les lignes partagées d'abord : les données du serveur pointent vers
      //    elles, et SQLite refuserait l'enfant avant le parent.
      await restoreShared(tx, all, shared, ids, stats);

      // 3. Les données du serveur, des parents vers les enfants.
      for (const table of tables) {
        const rows = dump[table.name];
        if (!rows || rows.length === 0) continue;

        // Seules les colonnes connues du schéma actuel sont écrites : un fichier
        // produit par une version antérieure (ou postérieure) reste importable.
        await insertRows(tx, table, rows, (row, column) => {
          let value = row[column.name] ?? null;
          // Le serveur cible n'est pas forcément celui d'origine.
          if (column.name === GUILD_COLUMN) value = guildId;
          else if (typeof value === 'string') value = ids.get(value) ?? value;
          return decodeCell(value, column);
        });

        stats.inserted[table.name] = rows.length;
        stats.total += rows.length;
      }
    },
    // Une grosse restauration dépasse largement les 5 s par défaut.
    { timeout: 300_000, maxWait: 30_000 },
  );

  return stats;
}

/** Nombre total de lignes d'un ensemble de tables (affiché dans les bilans). */
export function countRows(dump: DataDump | undefined): number {
  if (!dump) return 0;
  return Object.values(dump).reduce((total, rows) => total + rows.length, 0);
}
