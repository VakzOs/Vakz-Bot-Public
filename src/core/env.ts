import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Schéma de validation des variables d'environnement.
 *
 * Le bot refuse de démarrer si une variable REQUISE manque ou est invalide.
 * Les variables OPTIONNELLES contrôlent des features qui se désactivent
 * automatiquement lorsqu'elles sont absentes.
 */
const booleanFromString = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((value) => value === 'true' || value === '1')
  .default('false');

const envSchema = z.object({
  // --- Discord (requis) ---
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN est requis'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID est requis'),

  // --- Discord (optionnel) ---
  DISCORD_GUILD_ID: z.string().optional(),
  DEPLOY_COMMANDS_ON_START: booleanFromString,

  // --- Base de données (requis) ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),

  // --- Divers ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  TZ: z.string().default('Europe/Paris'),

  // --- Mise à jour depuis le bot (`/maj`, optionnel) ---
  /** ID Discord du propriétaire autorisé à lancer `/maj`. Vide = commande désactivée. */
  BOT_OWNER_ID: z.string().optional(),
  /** Dossier partagé avec l'updater hôte (demande/résultat de déploiement). */
  DEPLOY_DIR: z.string().default('./data'),
  /** Branches proposées au sélecteur de `/maj` (séparées par des virgules). */
  DEPLOY_BRANCHES: z.string().default('main'),

  // --- Intégrations tierces (optionnel, features désactivées si absentes) ---
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  // Résolveur Cloudflare (FlareSolverr) pour les sources protégées (Dealabs).
  // Ex. http://flaresolverr:8191 — vide = sources Cloudflare indisponibles.
  FLARESOLVERR_URL: z.string().optional(),

  // --- API web (dashboard) ---------------------------------------------------
  // Token secret partagé avec le site : vide = API désactivée.
  WEB_API_TOKEN: z.string().optional(),
  WEB_API_PORT: z.coerce.number().int().min(1).max(65535).default(3210),

  // --- Uptime Kuma (heartbeat) -----------------------------------------------
  // URL de push d'un moniteur « Push » Uptime Kuma (sans les paramètres de
  // requête). Vide = heartbeat désactivé. Ex :
  // https://uptime.exemple.com/api/push/xxxxxxxx
  UPTIME_PUSH_URL: z.string().url().optional(),
  // Intervalle du heartbeat en secondes (doit être < à l'intervalle configuré
  // côté Uptime Kuma).
  UPTIME_PUSH_INTERVAL: z.coerce.number().int().min(5).max(3600).default(30),

  // --- Intent Presence (privilégié, optionnel) -------------------------------
  // Active l'intent GuildPresences, requis pour que la surveillance détecte en
  // temps réel les changements de PROFIL GLOBAL (nom / photo de profil) des
  // membres. À activer AUSSI dans le Developer Portal (Bot → Presence Intent),
  // sinon le bot refuse de démarrer.
  PRESENCE_INTENT: booleanFromString.default('false'),

  // --- Musique (Lavalink, optionnel) -----------------------------------------
  // Serveur Lavalink pour le module « Musique ». Vide = module désactivé (les
  // commandes répondent que la musique n'est pas configurée). En Docker, le
  // service `lavalink` du compose fournit l'hôte `lavalink`.
  LAVALINK_HOST: z.string().optional(),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  LAVALINK_PASSWORD: z.string().default('youshallnotpass'),
  LAVALINK_SECURE: booleanFromString.default('false'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    // On n'a pas encore de logger ici (il dépend de LOG_LEVEL) : stderr direct.
    process.stderr.write(
      `\n❌ Configuration invalide. Vérifiez votre fichier .env :\n${issues}\n\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

/** Variables d'environnement validées, prêtes à l'emploi. */
export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
