import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './env.js';

/**
 * Crée le client discord.js.
 *
 * Intents :
 * - `Guilds` : slash commands et infos de base des serveurs.
 * - `GuildMembers` (PRIVILÉGIÉ) : évènements d'arrivée/départ des membres
 *   (module « Arrivées & départs »). Doit être activé dans le portail Discord
 *   Developer (Bot → Privileged Gateway Intents → Server Members Intent),
 *   sinon la connexion échoue avec « Used disallowed intents ».
 * - `GuildMessages` (non privilégié) : réception des messages pour le gain
 *   d'XP (module « Niveaux »).
 * - `GuildMessageReactions` (non privilégié) : réactions ⭐ pour le module
 *   « Starboard ». Les partials `Message`/`Reaction` permettent de réagir aux
 *   réactions sur d'anciens messages absents du cache.
 * - `MessageContent` (PRIVILÉGIÉ) : lecture du contenu des messages, requis pour
 *   afficher le texte des messages épinglés au starboard. À activer dans le
 *   portail Discord (Bot → Privileged Gateway Intents → Message Content Intent).
 * - `GuildVoiceStates` (non privilégié) : états vocaux des membres, requis pour
 *   le module « Mode streameur » (mettre un membre en sourdine) et pour la
 *   « Musique » (savoir dans quel salon vocal se connecter / rester).
 *
 * Les phases suivantes ajouteront d'autres intents au besoin.
 */
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      // Optionnel (privilégié) : détecte les changements de profil global (nom /
      // photo) pour la surveillance. Activé via PRESENCE_INTENT=true + portail.
      ...(env.PRESENCE_INTENT ? [GatewayIntentBits.GuildPresences] : []),
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction],
  });
}
