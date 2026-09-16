import { z } from 'zod';
import type { BotContext } from '../../core/module.js';

/** Identifiant stable du module (clé en base). */
export const MODULE_NAME = 'configbackup';

/** Cadences proposées par le dashboard (l'expression reste libre). */
export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Chaque jour à 4 h', cron: '0 4 * * *' },
  { label: 'Deux fois par jour', cron: '0 4,16 * * *' },
  { label: 'Chaque lundi à 4 h', cron: '0 4 * * 1' },
  { label: 'Le 1er du mois à 4 h', cron: '0 4 1 * *' },
];

/**
 * Réglages de sauvegarde d'un serveur.
 *
 * Ils vivent dans `ModuleConfig` comme n'importe quelle config de module, mais
 * le module étant interne, ils ne s'éditent pas depuis la page d'un module :
 * le dashboard a son propre panneau, et ses propres routes d'API.
 */
export const configbackupConfigSchema = z.object({
  /** Sauvegarde automatique selon `cron`. */
  auto: z.boolean().default(false),
  /** Expression cron (5 champs), évaluée dans le fuseau du bot (`TZ`). */
  cron: z.string().min(1).max(120).default('0 4 * * *'),
  /** Nombre de sauvegardes conservées sur le disque du bot. */
  keep: z.number().int().min(1).max(60).default(7),
  /** Inclure les données des membres (argent, objets, voyageurs, niveaux…). */
  includeData: z.boolean().default(true),
  /** Salon où déposer une copie du fichier à chaque sauvegarde. `null` = aucun. */
  channelId: z.string().nullable().default(null),
  /** Dernière exécution (ms epoch, 0 = jamais). */
  lastRunAt: z.number().int().min(0).default(0),
  /** Issue de la dernière exécution. */
  lastStatus: z.enum(['', 'ok', 'error']).default(''),
  /** Motif du dernier échec (affiché tel quel à l'admin). */
  lastError: z.string().max(300).default(''),
  /** Nom du dernier fichier produit. */
  lastFile: z.string().max(120).default(''),
});

export type ConfigbackupConfig = z.infer<typeof configbackupConfigSchema>;

export const configbackupDefaultConfig: ConfigbackupConfig = configbackupConfigSchema.parse({});

export async function getBackupConfig(
  ctx: BotContext,
  guildId: string,
): Promise<ConfigbackupConfig> {
  const state = await ctx.config.getModuleState<ConfigbackupConfig>(
    guildId,
    MODULE_NAME,
    configbackupConfigSchema,
  );
  return state.config;
}

export async function updateBackupConfig(
  ctx: BotContext,
  guildId: string,
  patch: Partial<ConfigbackupConfig>,
): Promise<ConfigbackupConfig> {
  const current = await getBackupConfig(ctx, guildId);
  const updated = configbackupConfigSchema.parse({ ...current, ...patch });
  await ctx.config.setConfig(guildId, MODULE_NAME, updated);
  return updated;
}
