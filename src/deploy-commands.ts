import { REST, Routes } from 'discord.js';
import { env } from './core/env.js';
import { createLogger } from './core/logger.js';
import { buildCommandPayload, loadModules } from './core/loader.js';

const log = createLogger('deploy');

/**
 * Déploie les slash commands auprès de l'API Discord.
 *
 * Idempotent : on utilise `PUT` qui remplace l'ensemble complet des commandes,
 * donc relancer ce script ne crée jamais de doublon.
 *
 * - Si `DISCORD_GUILD_ID` est défini → déploiement sur ce serveur (instantané, idéal en dev).
 * - Sinon → déploiement global (propagation jusqu'à ~1h).
 */
async function main(): Promise<void> {
  const registry = await loadModules();
  const body = buildCommandPayload(registry);
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  if (env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body,
    });
    log.info(
      { count: body.length, guildId: env.DISCORD_GUILD_ID },
      'Slash commands déployées sur le serveur de développement',
    );
  } else {
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    log.info({ count: body.length }, 'Slash commands déployées globalement');
  }
}

main().catch((error) => {
  log.error({ err: error }, 'Échec du déploiement des slash commands');
  process.exit(1);
});
