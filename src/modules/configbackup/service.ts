import type { Guild } from 'discord.js';
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

/** Identifiant du format de fichier (garde-fou contre les imports arbitraires). */
export const BACKUP_KIND = 'vakz-bot-config-backup';
/** Version du schéma de sauvegarde (incrémentée si le format évolue). */
export const BACKUP_VERSION = 2;

/** Une entrée de sauvegarde : l'état d'un module pour le serveur. */
export interface BackupEntry {
  module: string;
  enabled: boolean;
  /** Config déjà désérialisée (objet), pour un fichier lisible à l'œil nu. */
  config: unknown;
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
}

/** Résultat de l'analyse d'un fichier téléversé. */
export type ParseResult =
  | { ok: true; backup: ConfigBackup }
  | { ok: false; reason: 'json' | 'shape' };

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
 * Construit l'objet de sauvegarde à partir des lignes `ModuleConfig` du serveur.
 * Les modules système (internes) sont exclus : leur état n'a pas de sens à
 * transférer entre serveurs. On capture aussi la structure (salons/rôles)
 * référencée par les configs pour permettre une recréation à l'import.
 */
export async function buildBackup(ctx: BotContext, guild: Guild): Promise<ConfigBackup> {
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

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    modules,
    references,
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
    },
  };
}

/**
 * Applique une sauvegarde au serveur courant.
 *
 * 1. Recrée (ou associe) la structure référencée — salons, rôles, permissions —
 *    et construit une table `ancien ID → nouvel ID`.
 * 2. Chaque module est confronté au registre ; sa config est **remappée** avec
 *    les nouveaux IDs puis revalidée par zod avant écriture. Les modules
 *    inconnus ou dont la config est invalide sont ignorés (jamais d'écriture
 *    partielle qui casserait un panneau).
 */
export async function applyBackup(
  ctx: BotContext,
  guild: Guild,
  backup: ConfigBackup,
  opts: { recreate: boolean },
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
  };

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
