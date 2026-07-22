import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
  type Message,
} from 'discord.js';
import { Colors } from '../../lib/embeds.js';
import { parseEmoji } from '../../lib/emoji.js';
import type { PanelRow } from '../../core/module.js';
import {
  type ButtonStyleName,
  type InteractiveButton,
  type InteractivePanel,
  MODULE_NAME,
} from './config.js';

/** CustomId d'un bouton de rôle publié (routé par le `componentHandler`). */
export function roleButtonId(roleId: string): string {
  return `${MODULE_NAME}|role|${roleId}`;
}

const STYLE_MAP: Record<ButtonStyleName, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function mapStyle(style: ButtonStyleName): ButtonStyle {
  return STYLE_MAP[style] ?? ButtonStyle.Secondary;
}

/** N'accepte qu'une URL http(s) (les boutons lien Discord exigent une URL valide). */
export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Embed du message interactif (titre + description + couleur). */
export function buildPanelEmbed(panel: InteractivePanel): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(panel.color ?? Colors.brand);
  if (panel.title) embed.setTitle(panel.title);
  if (panel.description) embed.setDescription(panel.description);
  return embed;
}

/** Un bouton n'est retenu que s'il est effectivement publiable par Discord. */
function usableButton(button: InteractiveButton): boolean {
  if (button.type === 'role') return Boolean(button.roleId);
  return Boolean(button.url && isValidHttpUrl(button.url));
}

function toBuilder(button: InteractiveButton): ButtonBuilder | null {
  const builder = new ButtonBuilder().setLabel(button.label.slice(0, 80));
  const emoji = button.emoji ? parseEmoji(button.emoji) : undefined;
  if (emoji) builder.setEmoji(emoji);

  if (button.type === 'role') {
    if (!button.roleId) return null;
    return builder.setStyle(mapStyle(button.style)).setCustomId(roleButtonId(button.roleId));
  }
  if (!button.url || !isValidHttpUrl(button.url)) return null;
  return builder.setStyle(ButtonStyle.Link).setURL(button.url);
}

/** Compose les rangées de boutons (5 par rangée, 5 rangées max = 25 boutons). */
export function buildPanelComponents(panel: InteractivePanel): PanelRow[] {
  const builders = panel.buttons
    .filter(usableButton)
    .map(toBuilder)
    .filter((builder): builder is ButtonBuilder => builder !== null)
    .slice(0, 25);

  const rows: PanelRow[] = [];
  for (let i = 0; i < builders.length; i += 5) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        ...builders.slice(i, i + 5),
      ),
    );
  }
  return rows;
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'nochannel' | 'empty' | 'permissions' | 'send' };

interface PublishLogger {
  warn(obj: unknown, msg?: string): void;
}

function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: number }).code
    : undefined;
}

/**
 * Publie (ou met à jour, si `messageId` connu et toujours présent) le message
 * interactif dans son salon, avec son embed et ses boutons.
 */
export async function publishPanel(
  guild: Guild,
  panel: InteractivePanel,
  logger?: PublishLogger,
): Promise<PublishResult> {
  if (!panel.channelId) return { ok: false, error: 'nochannel' };
  if (!panel.title && !panel.description) return { ok: false, error: 'empty' };

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, error: 'nochannel' };

  const payload = { embeds: [buildPanelEmbed(panel)], components: buildPanelComponents(panel) };

  let message: Message | null = null;
  if (panel.messageId) {
    const existing = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (existing) message = await existing.edit(payload).catch(() => null);
  }
  if (!message) {
    try {
      message = await channel.send(payload);
    } catch (error) {
      const code = errorCode(error);
      logger?.warn({ err: error, code }, 'Publication du message interactif échouée');
      return { ok: false, error: code === 50013 || code === 50001 ? 'permissions' : 'send' };
    }
  }
  return { ok: true, messageId: message.id };
}
