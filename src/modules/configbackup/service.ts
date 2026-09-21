import { AttachmentBuilder, type Guild } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { getRegistry } from '../../core/loader.js';
import {
  type BackupReferences,
  type ReferenceStats,
  applyReferences,
  collectReferences,
  parseReferences,
  remapIds,
} from './references.js';
import {
  type DataDump,
  type RestoreStats,
  countRows,
  exportData,
  parseDataDump,
  restoreData,
} from './dump.js';
import { encodeBackup, pruneBackups, writeBackup } from './storage.js';
import { getBackupConfig, updateBackupConfig } from './config.js';

/** Identifiant du format de fichier (garde-fou contre les imports arbitraires). */
export const BACKUP_KIND = 'vakz-bot-config-backup';
/**
 * Version du schéma de sauvegarde.
 *
 * - v2 : configuration des modules + structure (salons/rôles) référencée.
 * - v3 : **toutes** les données du serveur en plus (`data`, `guild`).
 *
 * L'identifiant de format ne change pas : un fichier v3 reste importable par un
 * bot antérieur, qui n'en lira simplement que la configuration.
 */
export const BACKUP_VERSION = 3;

/** Une entrée de sauvegarde : l'état d'un module pour le serveur. */
export interface BackupEntry {
  module: string;
  enabled: boolean;
  /** Config déjà désérialisée (objet), pour un fichier lisible à l'œil nu. */
  config: unknown;
}

/** Réglages propres au serveur lui-même (hors modules). */
export interface GuildSettings {
  locale: string;
  staffRoleIds: string;
}

/** Contenu complet d'un fichier de sauvegarde. */
export interface ConfigBackup {
  kind: string;
  version: number;
  exportedAt: string;
  guildId: string;
  guildName: string;
  modules: BackupEntry[];
  /** Structure (salons/rôles) référencée par les configs — pour la migration. */
  references?: BackupReferences;
  /** Réglages de la ligne `Guild` (langue, rôles staff). */
  guild?: GuildSettings;
  /** Données du serveur, table par table (v3). Absent = sauvegarde de config. */
  data?: DataDump;
  /**
   * Lignes d'un catalogue partagé (le gacha, par exemple) que `data` référence.
   * Sans elles, restaurer sur une AUTRE instance du bot échouerait : les clés
   * étrangères pointeraient dans le vide. Elles ne sont jamais écrasées à
   * l'arrivée — elles n'appartiennent à aucun serveur.
   */
  shared?: DataDump;
}

/** Résultat de l'analyse d'un fichier téléversé. */
export type ParseResult =
  { ok: true; backup: ConfigBackup } | { ok: false; reason: 'json' | 'shape' };

/** Bilan d'un import : ce qui a été appliqué et ce qui a été ignoré. */
export interface ImportResult {
  applied: string[];
  skippedUnknown: string[];
  skippedInvalid: string[];
  fromOtherGuild: boolean;
  /** Présence d'une structure recréable dans le fichier importé. */
  hadReferences: boolean;
  /** Bilan de la recréation de structure (si `hadReferences`). */
  references: ReferenceStats;
  /** Le fichier contenait-il des données de membres ? */
  hadData: boolean;
  /** Bilan de la restauration des données (`null` si aucune). */
  data: RestoreStats | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Modules découverts au démarrage (vide si le registre n'est pas prêt). */
function registryModules() {
  return getRegistry()?.modules ?? [];
}

/** Un module système (interne) n'a pas de config exportable/importable. */
function isSystemModule(name: string): boolean {
  const mod = registryModules().find((m) => m.name === name);
  return mod?.internal ?? false;
}

function parseConfigJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    return {};
  }
}

/**
 * Construit l'objet de sauvegarde du serveur.
 *
 * Trois couches, du plus léger au plus lourd :
 * 1. la **configuration** de chaque module (lignes `ModuleConfig`) ;
 * 2. la **structure** (salons/rôles) qu'elle référence, pour pouvoir la recréer
 *    ailleurs ;
 * 3. les **données** — argent, objets et inventaires, voyageurs de la Route,
 *    niveaux, sanctions, anniversaires… — découvertes dans le schéma plutôt
 *    qu'énumérées ici (voir `dump.ts`).
 *
 * Les modules système (internes) sont exclus : leur état n'a pas de sens à
 * transférer entre serveurs.
 */
export async function buildBackup(
  ctx: BotContext,
  guild: Guild,
  opts: { data: boolean } = { data: true },
): Promise<ConfigBackup> {
  const rows = await ctx.db.moduleConfig.findMany({ where: { guildId: guild.id } });
  const modules: BackupEntry[] = rows
    .filter((row) => !isSystemModule(row.module))
    .map((row) => ({
      module: row.module,
      enabled: row.enabled,
      config: parseConfigJson(row.config),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));

  const references = collectReferences(
    guild,
    modules.map((entry) => entry.config),
  );

  const row = await ctx.db.guild.findUnique({ where: { id: guild.id } });
  const dump = opts.data ? await exportData(ctx, guild.id) : null;

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    modules,
    references,
    guild: row ? { locale: row.locale, staffRoleIds: row.staffRoleIds } : undefined,
    data: dump?.data,
    shared: dump?.shared,
  };
}

/** Réglages du serveur lus depuis un fichier importé. */
function parseGuildSettings(value: unknown): GuildSettings | undefined {
  if (!isRecord(value)) return undefined;
  return {
    locale: typeof value.locale === 'string' ? value.locale.slice(0, 10) : 'fr',
    staffRoleIds: typeof value.staffRoleIds === 'string' ? value.staffRoleIds : '[]',
  };
}

/**
 * Analyse le contenu texte d'un fichier téléversé. Valide la forme minimale
 * (JSON, bon `kind`, tableau `modules`) avant tout traitement.
 */
export function parseBackup(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (!isRecord(data) || data.kind !== BACKUP_KIND || !Array.isArray(data.modules)) {
    return { ok: false, reason: 'shape' };
  }

  const modules: BackupEntry[] = [];
  for (const item of data.modules) {
    if (!isRecord(item) || typeof item.module !== 'string') continue;
    modules.push({
      module: item.module,
      enabled: item.enabled === true,
      config: item.config ?? {},
    });
  }

  return {
    ok: true,
    backup: {
      kind: BACKUP_KIND,
      version: typeof data.version === 'number' ? data.version : BACKUP_VERSION,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      guildId: typeof data.guildId === 'string' ? data.guildId : '',
      guildName: typeof data.guildName === 'string' ? data.guildName : '',
      modules,
      references: parseReferences(data.references),
      guild: parseGuildSettings(data.guild),
      data: parseDataDump(data.data),
      shared: parseDataDump(data.shared),
    },
  };
}

/**
 * Applique une sauvegarde au serveur courant.
 *
 * 1. Recrée (ou associe) la structure référencée — salons, rôles, permissions —
 *    et construit une table `ancien ID → nouvel ID`.
 * 2. Restaure les **données** : les lignes du serveur sont remplacées par
 *    celles du fichier, en une transaction (voir `dump.ts`).
 * 3. Chaque module est confronté au registre ; sa config est **remappée** avec
 *    les nouveaux IDs puis revalidée par zod avant écriture. Les modules
 *    inconnus ou dont la config est invalide sont ignorés (jamais d'écriture
 *    partielle qui casserait un panneau).
 */
export async function applyBackup(
  ctx: BotContext,
  guild: Guild,
  backup: ConfigBackup,
  opts: { recreate: boolean; data: boolean },
): Promise<ImportResult> {
  const guildId = guild.id;
  const byName = new Map(registryModules().map((m) => [m.name, m]));
  const hadReferences = Boolean(
    backup.references &&
    (Object.keys(backup.references.roles).length > 0 ||
      Object.keys(backup.references.channels).length > 0),
  );

  const { remap, stats } = backup.references
    ? await applyReferences(guild, backup.guildId, backup.references, { create: opts.recreate })
    : {
        remap: new Map<string, string>(),
        stats: {
          rolesCreated: 0,
          rolesReused: 0,
          channelsCreated: 0,
          channelsReused: 0,
          failed: 0,
        },
      };

  const result: ImportResult = {
    applied: [],
    skippedUnknown: [],
    skippedInvalid: [],
    fromOtherGuild: backup.guildId !== '' && backup.guildId !== guildId,
    hadReferences,
    references: stats,
    hadData: countRows(backup.data) > 0,
    data: null,
  };

  // La ligne `Guild` doit exister avant toute écriture qui s'y rattache.
  await ctx.config.ensureGuild(guildId);
  if (backup.guild) {
    // `staffRoleIds` est une liste d'IDs sérialisée : elle passe par le même
    // remappage que les configs, sans quoi les rôles staff seraient morts après
    // une restauration sur un autre serveur.
    await ctx.db.guild
      .update({
        where: { id: guildId },
        data: {
          locale: backup.guild.locale,
          staffRoleIds: JSON.stringify(remapIds(parseConfigJson(backup.guild.staffRoleIds), remap)),
        },
      })
      .catch(() => undefined);
  }

  // Données AVANT les configs : la restauration efface les lignes du serveur, et
  // `ModuleConfig` n'en fait pas partie — l'ordre n'a donc pas d'incidence sur
  // la config, mais il garantit qu'un échec de restauration n'a rien réécrit.
  if (opts.data && backup.data) {
    result.data = await restoreData(ctx, guildId, backup.data, backup.shared ?? {}, remap, {
      // Une sauvegarde venue d'ailleurs garde les clés primaires de son serveur
      // d'origine : les réutiliser telles quelles écraserait ses données.
      regenerateIds: result.fromOtherGuild,
    });
  }

  for (const entry of backup.modules) {
    const mod = byName.get(entry.module);
    if (!mod) {
      result.skippedUnknown.push(entry.module);
      continue;
    }
    // Modules système : jamais importés (pas de config transférable).
    if (mod.internal) continue;

    let config = remapIds(entry.config, remap);
    if (mod.configSchema) {
      const parsed = mod.configSchema.safeParse(config);
      if (!parsed.success) {
        result.skippedInvalid.push(entry.module);
        continue;
      }
      config = parsed.data;
    }

    await ctx.config.setConfig(guildId, entry.module, config);
    await ctx.config.setEnabled(guildId, entry.module, entry.enabled, config);
    result.applied.push(entry.module);
  }

  return result;
}

/** Bilan d'une sauvegarde lancée à la main ou par le planificateur. */
export interface RunBackupResult {
  ok: boolean;
  /** Motif d'échec, à traduire côté appelant. */
  error?: 'unknown_guild' | 'failed';
  /** Nom du fichier produit. */
  file?: string;
  /** Poids du fichier compressé (octets). */
  size?: number;
  /** Nombre de modules et de lignes sauvegardés. */
  modules?: number;
  rows?: number;
  /** Sauvegardes supprimées par la rétention. */
  pruned?: number;
  /** Copie déposée dans le salon configuré. */
  delivered?: boolean;
}

/** Au-delà, Discord refuse la pièce jointe (limite de base d'un serveur). */
const DISCORD_ATTACHMENT_LIMIT = 24 * 1024 * 1024;

/**
 * Produit une sauvegarde, l'écrit sur le disque du bot, applique la rétention
 * et en dépose éventuellement une copie dans un salon.
 *
 * C'est le point d'entrée unique : le bouton du dashboard, la commande
 * `/sauvegarde` et le planificateur passent tous par ici, pour qu'une
 * sauvegarde automatique soit exactement celle qu'on obtient à la main.
 */
export async function runBackup(ctx: BotContext, guildId: string): Promise<RunBackupResult> {
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) return { ok: false, error: 'unknown_guild' };

  const config = await getBackupConfig(ctx, guildId);
  try {
    const backup = await buildBackup(ctx, guild, { data: config.includeData });
    const payload = encodeBackup(backup);
    const stored = await writeBackup(guildId, payload);
    const pruned = await pruneBackups(guildId, config.keep);

    // Copie hors du VPS : une sauvegarde qui ne vit qu'à côté de la base
    // qu'elle protège ne protège pas de grand-chose.
    let delivered = false;
    if (config.channelId && payload.length <= DISCORD_ATTACHMENT_LIMIT) {
      const channel =
        guild.channels.cache.get(config.channelId) ??
        (await guild.channels.fetch(config.channelId).catch(() => null));
      if (channel?.isTextBased()) {
        delivered = await channel
          .send({
            content: ctx.t('modules.configbackup.delivery.content', {
              guild: guild.name,
              rows: countRows(backup.data),
            }),
            files: [new AttachmentBuilder(payload, { name: stored.name })],
          })
          .then(() => true)
          .catch(() => false);
      }
    }

    await updateBackupConfig(ctx, guildId, {
      lastRunAt: Date.now(),
      lastStatus: 'ok',
      lastError: '',
      lastFile: stored.name,
    });

    return {
      ok: true,
      file: stored.name,
      size: stored.size,
      modules: backup.modules.length,
      rows: countRows(backup.data),
      pruned,
      delivered,
    };
  } catch (error) {
    ctx.logger.error({ err: error, guildId }, 'Sauvegarde du serveur échouée');
    await updateBackupConfig(ctx, guildId, {
      lastRunAt: Date.now(),
      lastStatus: 'error',
      lastError: error instanceof Error ? error.message.slice(0, 300) : 'erreur inconnue',
    });
    return { ok: false, error: 'failed' };
  }
}
