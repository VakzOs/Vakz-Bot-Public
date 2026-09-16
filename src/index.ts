import { type Client, Events, REST, Routes } from 'discord.js';
import type { BotContext } from './core/module.js';
import { env } from './core/env.js';
import { logger } from './core/logger.js';
import { applyBootPresence } from './core/presence.js';
import { installProcessErrorHandlers } from './core/errors.js';
import { createClient } from './core/client.js';
import { createContext } from './core/context.js';
import { configureEmbedTheme } from './lib/embeds.js';
import { db, initDatabase } from './core/db.js';
import { scheduler } from './core/scheduler.js';
import {
  buildCommandPayload,
  loadModules,
  registerInteractionRouter,
  registerModuleEvents,
  runOnLoadHooks,
  startModuleTasks,
  type ModuleRegistry,
} from './core/loader.js';
import { startWebApi } from './core/web-api.js';
import { startUptimePush, notifyUptimeMaintenance, stopUptimePush } from './core/uptime.js';
import { flushMetrics, startMetrics, stopMetrics } from './core/metrics.js';

function rest(): REST {
  return new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
}

/**
 * Déploie les slash commands au démarrage (si `DEPLOY_COMMANDS_ON_START=true`).
 *
 * - `DISCORD_GUILD_ID` défini → déploiement sur ce seul serveur (instantané, dev).
 * - Sinon → déploiement **par serveur** sur tous les serveurs où le bot est
 *   présent. C'est **instantané**, contrairement au déploiement global qui met
 *   jusqu'à ~1 h à se propager côté Discord. Le set global est purgé pour éviter
 *   les doublons. Les serveurs rejoints ensuite sont couverts par `guildCreate`.
 *
 * Doit être appelé une fois le client prêt (le cache des serveurs est alors rempli).
 */
async function deployCommands(client: Client<true>, registry: ModuleRegistry): Promise<void> {
  if (!env.DEPLOY_COMMANDS_ON_START) return;
  const body = buildCommandPayload(registry);
  const api = rest();

  if (env.DISCORD_GUILD_ID) {
    await api
      .put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body })
      .catch((err: unknown) => logger.error({ err }, 'Échec du déploiement (serveur de dev)'));
    logger.info(
      { count: body.length, guildId: env.DISCORD_GUILD_ID },
      'Slash commands déployées (serveur de développement, instantané)',
    );
    return;
  }

  // Purge du set global (évite les doublons avec le déploiement par serveur).
  await api
    .put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: [] })
    .catch(() => undefined);

  const guildIds = [...client.guilds.cache.keys()];
  await Promise.all(
    guildIds.map((guildId) =>
      api
        .put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body })
        .catch((err: unknown) =>
          logger.error({ err, guildId }, 'Échec du déploiement sur un serveur'),
        ),
    ),
  );
  logger.info(
    { count: body.length, guilds: guildIds.length },
    'Slash commands déployées sur chaque serveur (instantané)',
  );
}

/** Déploie les commandes sur un serveur fraîchement rejoint (instantané). */
async function deployToGuild(guildId: string, registry: ModuleRegistry): Promise<void> {
  if (!env.DEPLOY_COMMANDS_ON_START || env.DISCORD_GUILD_ID) return;
  const body = buildCommandPayload(registry);
  await rest()
    .put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body })
    .then(() => logger.info({ guildId }, 'Slash commands déployées sur le nouveau serveur'))
    .catch((err: unknown) =>
      logger.error({ err, guildId }, 'Échec du déploiement sur le nouveau serveur'),
    );
}

/**
 * Combien de temps on s'obstine à se connecter avant de rendre la main.
 *
 * Une panne de la passerelle Discord dure typiquement quelques minutes. Sortir
 * au premier refus transforme ces minutes en boucle de redémarrages : le
 * superviseur relance le conteneur, qui remigre, recharge quarante-trois
 * modules et retombe sur le même 503 — vingt-six fois pour une panne de vingt
 * minutes, vécu le 15 septembre 2026. Attendre sur place coûte une ligne de log
 * et rend le bot dès que Discord se relève.
 *
 * Au-delà de cette demi-heure, on sort quand même : passé ce délai, ce n'est
 * probablement plus un incident passager, et un process qui s'entête sans
 * jamais rien dire est pire qu'un process qui meurt franchement.
 */
const LOGIN_RETRY_BUDGET_MS = 30 * 60_000;

/** Attente avant la prochaine tentative : 3 s, 6 s, 12 s… plafonnée à une minute. */
function loginBackoffMs(attempt: number): number {
  return Math.min(60_000, 3_000 * 2 ** (attempt - 1));
}

/**
 * Vrai pour une erreur que réessayer ne réparera jamais.
 *
 * Un token invalide ou des intents refusés demandent une intervention humaine :
 * s'obstiner masquerait le vrai problème derrière une attente sans fin. Tout le
 * reste — 5xx, coupure réseau, DNS — est par nature passager.
 */
function isFatalLoginError(error: unknown): boolean {
  if (error instanceof Error) {
    if (/disallowed intents/i.test(error.message)) return true;
    if (/invalid token|token was provided/i.test(error.message)) return true;
  }
  // 401 : le token ne sera pas plus valide dans trois secondes.
  return (error as { status?: unknown } | null)?.status === 401;
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Prépare un client et le connecte. Rend le client une fois la connexion ouverte.
 *
 * **Un client neuf par tentative**, et ce n'est pas de la prudence gratuite :
 * `client.login()` appelle `client.destroy()` quand il échoue, et le drapeau
 * `destroyed` du gestionnaire WebSocket n'est jamais remis à faux. Réessayer sur
 * la même instance rendrait un bot connecté dont `isReady()` répondrait `false`
 * pour toujours — une panne bien pire que celle qu'on répare, parce qu'elle ne
 * se voit pas.
 */
async function connectClient(registry: ModuleRegistry): Promise<Client> {
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt += 1) {
    const client = createClient();
    const ctx = createContext(client);

    registerInteractionRouter(client, ctx, registry);
    registerModuleEvents(client, ctx, registry);
    registerReadyHandler(client, ctx, registry);

    // Un serveur rejoint après le démarrage reçoit ses commandes immédiatement.
    client.on(Events.GuildCreate, (guild) => void deployToGuild(guild.id, registry));

    try {
      await client.login(env.DISCORD_TOKEN);
      if (attempt > 1) {
        logger.info(
          { attempt, waitedSeconds: Math.round((Date.now() - startedAt) / 1000) },
          'Connexion à Discord rétablie',
        );
      }
      return client;
    } catch (error) {
      if (isFatalLoginError(error)) {
        if (error instanceof Error && /disallowed intents/i.test(error.message)) {
          logger.fatal(
            'Intents privilégiés non autorisés. Active « Server Members Intent »' +
              (env.PRESENCE_INTENT ? ' et « Presence Intent »' : '') +
              ' dans le portail Discord Developer (Bot → Privileged Gateway Intents), puis redémarre le bot.',
          );
        }
        throw error;
      }

      const delay = loginBackoffMs(attempt);
      const elapsed = Date.now() - startedAt;
      if (elapsed + delay > LOGIN_RETRY_BUDGET_MS) throw error;

      // En `warn` et non en `error` : tant qu'on réessaie, ce n'est pas encore
      // une panne — mais ça doit se voir dans le panneau Logs, sans quoi un bot
      // absent depuis dix minutes n'aurait rien à raconter.
      logger.warn(
        { err: error, attempt, retryInSeconds: Math.round(delay / 1000) },
        'Connexion à Discord impossible, nouvelle tentative',
      );
      await wait(delay);
    }
  }
}

/** Ce qui se met en route une fois la passerelle ouverte. */
function registerReadyHandler(client: Client, ctx: BotContext, registry: ModuleRegistry): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
      'Bot connecté',
    );
    // Renseigne l'identité (nom + avatar) pour l'auteur/pied de page brandé des embeds.
    configureEmbedTheme({
      name: readyClient.user.username,
      iconURL: readyClient.user.displayAvatarURL(),
    });
    // Statut tiré au sort dans la liste réglée depuis le dashboard : lecture
    // en base, donc asynchrone — le reste du démarrage ne l'attend pas.
    void applyBootPresence(readyClient, logger);
    // Le cache des serveurs est prêt : on déploie les commandes par serveur (instantané).
    void deployCommands(readyClient, registry);
    startModuleTasks(ctx, registry);
    void runOnLoadHooks(ctx, registry);
    startWebApi(ctx, registry);
    startUptimePush(readyClient);
    // Le monitoring ne démarre qu'ici : avant la connexion, une courbe de
    // latence ou de serveurs ne mesurerait que l'attente du login. La base et le
    // logger lui sont passés plutôt qu'importés : le module est chargé par le
    // logger lui-même, l'import fermerait un cycle.
    startMetrics({ client: readyClient, db, logger });
  });
}

async function main(): Promise<void> {
  installProcessErrorHandlers();
  await initDatabase();

  const registry = await loadModules();
  const client = await connectClient(registry);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Arrêt du bot en cours…');
    // Prévient Uptime Kuma que l'arrêt est volontaire (maintenance/redémarrage),
    // pour distinguer d'une panne. Best-effort, borné dans le temps.
    stopUptimePush();
    stopMetrics();
    // Les dernières secondes avant une coupure sont souvent les plus
    // intéressantes : on les verse avant de fermer la base.
    await flushMetrics().catch(() => undefined);
    await notifyUptimeMaintenance('🛠️ Redémarrage (maintenance)').catch(() => undefined);
    scheduler.stopAll();
    await client.destroy();
    await db.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Échec du démarrage du bot');
  process.exit(1);
});
