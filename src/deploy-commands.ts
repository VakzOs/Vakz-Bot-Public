import { REST, Routes } from 'discord.js';
import { env } from './core/env.js';
import { createLogger } from './core/logger.js';
import { buildCommandPayload, loadModules } from './core/loader.js';
import { DEFAULT_LOCALE } from './core/i18n.js';
import { localeForGuild } from './core/guild-locale.js';

const log = createLogger('deploy');

/**
 * Déploie les slash commands auprès de l'API Discord.
 *
 * Idempotent : on utilise `PUT` qui remplace l'ensemble complet des commandes,
 * donc relancer ce script ne crée jamais de doublon.
 *
 * - Si `DISCORD_GUILD_ID` est défini → déploiement sur ce serveur (instantané, idéal en dev),
 *   dans la langue choisie par ce serveur.
 * - Sinon → déploiement global (propagation jusqu'à ~1h).
 *
 * Un jeu **global** ne vise aucun serveur : il part donc dans la langue par
 * défaut, et il le reste. Traduire les commandes suppose de les déployer par
 * serveur — c'est ce que fait le bot au démarrage avec
 * `DEPLOY_COMMANDS_ON_START`.
 */
async function main(): Promise<void> {
  const registry = await loadModules();

  if (env.DISCORD_GUILD_ID) {
    const locale = await localeForGuild(env.DISCORD_GUILD_ID);
    const body = buildCommandPayload(registry, locale);
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body,
    });
    log.info(
      { count: body.length, guildId: env.DISCORD_GUILD_ID, locale },
      'Slash commands déployées sur le serveur de développement',
    );
    return;
  }

  const body = buildCommandPayload(registry);
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
  log.info(
    { count: body.length, locale: DEFAULT_LOCALE },
    'Slash commands déployées globalement (non traduites)',
  );
}

main().catch((error) => {
  log.error({ err: error }, 'Échec du déploiement des slash commands');
  process.exit(1);
});
