import { db } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('guild-config');

/** État d'un module pour un serveur : activé ou non, et sa config typée. */
export interface ModuleConfigState<T = unknown> {
  enabled: boolean;
  config: T;
}

/**
 * Validateur structurel minimal — un schéma zod le satisfait directement
 * (`safeParse` accepte toujours `unknown`). On évite ainsi les conflits de
 * variance entre type d'entrée et de sortie d'un schéma avec valeurs par défaut.
 */
export interface ConfigValidator<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/**
 * Accès centralisé à la configuration par serveur, avec un cache mémoire
 * invalidé à chaque écriture. Toutes les structures (config) sont stockées en
 * JSON sérialisé dans la colonne `ModuleConfig.config` et (dé)validées par zod.
 */
export class GuildConfigService {
  private readonly cache = new Map<string, ModuleConfigState>();

  private key(guildId: string, module: string): string {
    return `${guildId}:${module}`;
  }

  /** Crée la ligne `Guild` si elle n'existe pas encore. */
  async ensureGuild(guildId: string): Promise<void> {
    await db.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } });
  }

  /** Récupère l'état d'un module (avec validation zod optionnelle de la config). */
  async getModuleState<T = unknown>(
    guildId: string,
    module: string,
    schema?: ConfigValidator<T>,
  ): Promise<ModuleConfigState<T>> {
    const cacheKey = this.key(guildId, module);
    // Le cache conserve la config BRUTE (telle qu'en base) : le schéma est
    // (re)appliqué à CHAQUE lecture. Sinon un premier appel sans schéma
    // (ex. `isEnabled`) mettrait en cache une config sans valeurs par défaut,
    // et un appel typé ultérieur récupérerait des champs `undefined` (cassant
    // les rendus de panneaux après l'ajout/renommage d'un champ de config).
    let cached = this.cache.get(cacheKey);
    if (!cached) {
      const row = await db.moduleConfig.findUnique({
        where: { guildId_module: { guildId, module } },
      });
      let raw: unknown = {};
      if (row) {
        try {
          raw = JSON.parse(row.config);
        } catch (error) {
          log.error({ err: error, guildId, module }, 'Config JSON corrompue, réinitialisée');
        }
      }
      cached = { enabled: row?.enabled ?? false, config: raw };
      this.cache.set(cacheKey, cached);
    }

    let config: unknown = cached.config;
    if (schema) {
      const parsed = schema.safeParse(config);
      if (parsed.success) {
        config = parsed.data;
      } else {
        log.warn({ guildId, module }, 'Config invalide, repli sur les valeurs par défaut');
        // Repli sur les défauts du schéma plutôt qu'un objet vide : évite des
        // champs `undefined` qui casseraient les rendus (modals, embeds…).
        const defaults = schema.safeParse({});
        config = defaults.success ? defaults.data : {};
      }
    }

    return { enabled: cached.enabled, config: config as T };
  }

  /** Indique si un module est activé pour ce serveur. */
  async isEnabled(guildId: string, module: string): Promise<boolean> {
    const state = await this.getModuleState(guildId, module);
    return state.enabled;
  }

  /** Active ou désactive un module pour ce serveur. */
  async setEnabled(
    guildId: string,
    module: string,
    enabled: boolean,
    defaultConfig: unknown = {},
  ): Promise<void> {
    await this.ensureGuild(guildId);
    await db.moduleConfig.upsert({
      where: { guildId_module: { guildId, module } },
      update: { enabled },
      create: { guildId, module, enabled, config: JSON.stringify(defaultConfig) },
    });
    this.invalidate(guildId, module);
  }

  /** Remplace la config d'un module pour ce serveur. */
  async setConfig(guildId: string, module: string, config: unknown): Promise<void> {
    await this.ensureGuild(guildId);
    const serialized = JSON.stringify(config);
    await db.moduleConfig.upsert({
      where: { guildId_module: { guildId, module } },
      update: { config: serialized },
      create: { guildId, module, config: serialized, enabled: false },
    });
    this.invalidate(guildId, module);
  }

  /** Renvoie l'état activé/désactivé connu de tous les modules d'un serveur. */
  async listStates(guildId: string): Promise<Map<string, boolean>> {
    const rows = await db.moduleConfig.findMany({ where: { guildId } });
    return new Map(rows.map((row) => [row.module, row.enabled]));
  }

  /** Invalide l'entrée de cache d'un module. */
  invalidate(guildId: string, module: string): void {
    this.cache.delete(this.key(guildId, module));
  }
}

/** Instance partagée du service de configuration. */
export const guildConfig = new GuildConfigService();
