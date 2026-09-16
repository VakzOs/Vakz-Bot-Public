import { EmbedBuilder, type Message, PermissionFlagsBits } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { Colors } from '../../lib/embeds.js';
import { type CustomCommand, type MatchType } from './config.js';

type GuildMessage = Message<true>;

/** Cooldowns en mémoire : clé `guildId:commandId:userId` → prochaine échéance. */
const cooldowns = new Map<string, number>();

function cooldownKey(guildId: string, commandId: string, userId: string): string {
  return `${guildId}:${commandId}:${userId}`;
}

/** Indique si `content` correspond au déclencheur selon le type de comparaison. */
export function matches(content: string, trigger: string, match: MatchType): boolean {
  const haystack = content.trim().toLowerCase();
  const needle = trigger.trim().toLowerCase();
  if (!needle) return false;
  switch (match) {
    case 'exact':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

/**
 * Trouve la première commande correspondant à un message (en respectant une
 * éventuelle restriction de salon). Les commandes exactes/au début sont testées
 * avant « contient » pour un comportement plus prévisible.
 */
export function findMatch(message: GuildMessage, commands: CustomCommand[]): CustomCommand | null {
  const eligible = commands.filter(
    (command) => !command.channelId || command.channelId === message.channelId,
  );
  const priority: MatchType[] = ['exact', 'startsWith', 'endsWith', 'contains'];
  for (const match of priority) {
    const found = eligible.find(
      (command) => command.match === match && matches(message.content, command.trigger, match),
    );
    if (found) return found;
  }
  return null;
}

/** Remplace les variables `{...}` d'une réponse par les valeurs du message. */
export function fillPlaceholders(template: string, message: GuildMessage): string {
  const vars: Record<string, string> = {
    user: `<@${message.author.id}>`,
    mention: `<@${message.author.id}>`,
    username: message.member?.displayName ?? message.author.username,
    server: message.guild.name,
    channel: `<#${message.channelId}>`,
  };
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? (vars[name] ?? whole) : whole,
  );
}

/** Applique le cooldown : renvoie `true` si la commande est encore en attente. */
function onCooldown(command: CustomCommand, guildId: string, userId: string): boolean {
  if (command.cooldown <= 0) return false;
  const key = cooldownKey(guildId, command.id, userId);
  const now = Date.now();
  const until = cooldowns.get(key) ?? 0;
  if (until > now) return true;
  cooldowns.set(key, now + command.cooldown * 1000);
  return false;
}

/**
 * Exécute la commande correspondante : suppression éventuelle du message
 * déclencheur puis envoi de la réponse (texte ou embed). Les échecs (permissions,
 * salon inaccessible) sont journalisés sans jamais interrompre le flux.
 */
export async function runCommand(
  ctx: BotContext,
  message: GuildMessage,
  command: CustomCommand,
): Promise<void> {
  if (onCooldown(command, message.guildId, message.author.id)) return;

  const content = fillPlaceholders(command.response, message);

  if (command.deleteTrigger) {
    const me = message.guild.members.me;
    if (me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
      await message.delete().catch(() => undefined);
    }
  }

  try {
    if (command.asEmbed) {
      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setDescription(content.slice(0, 4000));
      await message.channel.send({ embeds: [embed], allowedMentions: { parse: ['users'] } });
    } else {
      await message.channel.send({
        content: content.slice(0, 2000),
        allowedMentions: { parse: ['users'] },
      });
    }
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId: message.guildId, command: command.id },
      'Envoi de commande personnalisée échoué',
    );
  }
}
