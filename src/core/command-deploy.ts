import { type Client, REST, Routes } from 'discord.js';
import { env } from './env.js';
import { localeForGuild } from './guild-locale.js';
import { buildCommandPayload, getRegistry } from './loader.js';
import { createLogger } from './logger.js';

const log = createLogger('deploy-commands');

function rest(): REST {
  return new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
}

/**
 * Déploie les slash commands sur un serveur, dans SA langue.
 *
 * C'est le seul endroit où la langue d'un serveur rencontre l'API de Discord.
 * Une commande n'a qu'un jeu de noms par serveur : celui qui est déployé est
 * celui que tout le monde y voit, francophones compris — c'est le sens du
 * réglage « langue du bot » du dashboard, qui décrit la langue de la
 * communauté, pas celle du membre.
 */
export async function deployGuildCommands(
  guildId: string,
  /** Ce que Discord dit de ce serveur, pour celui qui n'a encore rien choisi. */
  discordLocale?: string,
): Promise<boolean> {
  const registry = getRegistry();
  if (!registry) {
    log.warn({ guildId }, 'Déploiement demandé avant le chargement des modules');
    return false;
  }
  const locale = await localeForGuild(guildId, discordLocale);
  const body = buildCommandPayload(registry, locale);
  try {
    await rest().put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), { body });
    log.info({ guildId, locale, count: body.length }, 'Slash commands déployées');
    return true;
  } catch (error) {
    log.error({ err: error, guildId, locale }, 'Échec du déploiement sur un serveur');
    return false;
  }
}

/**
 * Le déploiement par serveur est-il celui qui a cours ici ?
 *
 * En développement (`DISCORD_GUILD_ID`), un seul serveur reçoit les commandes ;
 * ailleurs, tous ceux où le bot est présent. Dans les deux cas c'est un
 * déploiement de serveur, donc traduisible. Sans
 * `DEPLOY_COMMANDS_ON_START`, l'hébergeur déploie à la main
 * (`npm run deploy-commands`) : on ne va pas publier dans son dos un jeu de
 * commandes de serveur qui doublerait le sien.
 */
function guildDeploymentCovers(guildId: string): boolean {
  if (!env.DEPLOY_COMMANDS_ON_START) return false;
  return !env.DISCORD_GUILD_ID || env.DISCORD_GUILD_ID === guildId;
}

/**
 * Redéploie les commandes d'un serveur après un changement de langue.
 *
 * Sans cela, le dashboard annoncerait l'anglais et Discord continuerait
 * d'afficher `/rang` jusqu'au prochain redémarrage du bot : la langue des
 * réponses changerait tout de suite, celle des commandes non — le pire des
 * deux mondes pour l'administrateur qui vient de cliquer.
 */
export async function redeployGuildCommands(guildId: string): Promise<void> {
  if (!guildDeploymentCovers(guildId)) {
    log.debug({ guildId }, 'Changement de langue : déploiement par serveur inactif, rien à faire');
    return;
  }
  await deployGuildCommands(guildId);
}

/**
 * Déploie les commandes sur un serveur fraîchement rejoint (instantané).
 *
 * Ce serveur-là n'a encore rien réglé : on lui prête la langue que Discord lui
 * déclare, plutôt que de faire arriver le bot en français chez une communauté
 * anglophone qui n'a pas encore vu le dashboard.
 */
export async function deployToNewGuild(guildId: string, discordLocale?: string): Promise<void> {
  if (!guildDeploymentCovers(guildId)) return;
  await deployGuildCommands(guildId, discordLocale);
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
 * Le déploiement par serveur n'est pas qu'une affaire de délai : c'est lui qui
 * rend les commandes traduisibles, un serveur pouvant alors recevoir `/rank`
 * quand son voisin garde `/rang`.
 *
 * Doit être appelé une fois le client prêt (le cache des serveurs est alors rempli).
 */
export async function deployCommandsOnStart(client: Client<true>): Promise<void> {
  if (!env.DEPLOY_COMMANDS_ON_START) return;

  if (env.DISCORD_GUILD_ID) {
    const dev = client.guilds.cache.get(env.DISCORD_GUILD_ID);
    await deployGuildCommands(env.DISCORD_GUILD_ID, dev?.preferredLocale);
    return;
  }

  // Purge du set global (évite les doublons avec le déploiement par serveur).
  await rest()
    .put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: [] })
    .catch(() => undefined);

  const guilds = [...client.guilds.cache.values()];
  const results = await Promise.all(
    guilds.map((guild) => deployGuildCommands(guild.id, guild.preferredLocale)),
  );
  log.info(
    { guilds: guilds.length, echecs: results.filter((ok) => !ok).length },
    'Slash commands déployées sur chaque serveur (instantané)',
  );
}
