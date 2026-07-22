import { type Client, Events, REST, Routes } from 'discord.js';
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

async function main(): Promise<void> {
  installProcessErrorHandlers();
  await initDatabase();

  const client = createClient();
  const ctx = createContext(client);
  const registry = await loadModules();

  registerInteractionRouter(client, ctx, registry);
  registerModuleEvents(client, ctx, registry);

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
    applyBootPresence(readyClient, logger);
    // Le cache des serveurs est prêt : on déploie les commandes par serveur (instantané).
    void deployCommands(readyClient, registry);
    startModuleTasks(ctx, registry);
    void runOnLoadHooks(ctx, registry);
    startWebApi(ctx, registry);
    startUptimePush(readyClient);
  });

  // Un serveur rejoint après le démarrage reçoit ses commandes immédiatement.
  client.on(Events.GuildCreate, (guild) => void deployToGuild(guild.id, registry));

  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (error) {
    if (error instanceof Error && /disallowed intents/i.test(error.message)) {
      logger.fatal(
        'Intents privilégiés non autorisés. Active « Server Members Intent »' +
          (env.PRESENCE_INTENT ? ' et « Presence Intent »' : '') +
          ' dans le portail Discord Developer (Bot → Privileged Gateway Intents), puis redémarre le bot.',
      );
    }
    throw error;
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Arrêt du bot en cours…');
    // Prévient Uptime Kuma que l'arrêt est volontaire (maintenance/redémarrage),
    // pour distinguer d'une panne. Best-effort, borné dans le temps.
    stopUptimePush();
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
