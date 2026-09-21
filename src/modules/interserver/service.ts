import {
  type GuildTextBasedChannel,
  type Message,
  PermissionFlagsBits,
  WebhookClient,
} from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { MODULE_NAME, getInterserverConfig, normalizeNetwork } from './config.js';

const WEBHOOK_NAME = 'Vakz Interserveurs';
const MAX_CONTENT = 2000;
const MAX_FILES = 10;

/** Code d'erreur Discord porté par l'exception (ex. 10015 = webhook inconnu). */
function errorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: number }).code
    : undefined;
}

interface WebhookCapable {
  createWebhook(options: {
    name: string;
    reason?: string;
  }): Promise<{ id: string; token: string | null }>;
}

function isWebhookCapable(
  channel: GuildTextBasedChannel,
): channel is GuildTextBasedChannel & WebhookCapable {
  return 'createWebhook' in channel;
}

// --- Liens (CRUD) -----------------------------------------------------------

export function listLinks(ctx: BotContext, guildId: string) {
  return ctx.db.interserverLink.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
}

/** Supprime le lien d'un salon et le webhook associé (best-effort). */
export async function unlinkChannel(ctx: BotContext, channelId: string): Promise<void> {
  const link = await ctx.db.interserverLink.findUnique({ where: { channelId } });
  if (!link) return;
  await new WebhookClient({ id: link.webhookId, token: link.webhookToken })
    .delete('Délien interserveurs')
    .catch(() => undefined);
  await ctx.db.interserverLink.delete({ where: { channelId } }).catch(() => undefined);
}

export type LinkResult =
  | { ok: true; network: string }
  | { ok: false; error: 'code' | 'perm' | 'fail' };

/**
 * Lie un salon à un réseau : crée un webhook (réutilisé pour les relais) et
 * enregistre le lien. Remplace un éventuel lien précédent sur ce salon.
 */
export async function linkChannel(
  ctx: BotContext,
  channel: GuildTextBasedChannel,
  rawNetwork: string,
): Promise<LinkResult> {
  const network = normalizeNetwork(rawNetwork);
  if (!network) return { ok: false, error: 'code' };

  const me = channel.guild.members.me;
  if (
    !me?.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks) ||
    !isWebhookCapable(channel)
  ) {
    return { ok: false, error: 'perm' };
  }

  // Repartir propre : on retire le lien (et son webhook) déjà présent sur ce salon.
  await unlinkChannel(ctx, channel.id);

  const webhook = await channel
    .createWebhook({ name: WEBHOOK_NAME, reason: 'Lien interserveurs' })
    .catch(() => null);
  if (!webhook?.token) return { ok: false, error: 'fail' };

  await ctx.db.interserverLink.create({
    data: {
      guildId: channel.guild.id,
      channelId: channel.id,
      network,
      webhookId: webhook.id,
      webhookToken: webhook.token,
    },
  });
  return { ok: true, network };
}

// --- Relais -----------------------------------------------------------------

/** Coupe le contenu à la limite d'un message (les mentions sont neutralisées
 *  côté envoi via `allowedMentions`). */
function sanitizeContent(content: string): string {
  return content.length > MAX_CONTENT ? `${content.slice(0, MAX_CONTENT - 1)}…` : content;
}

/**
 * Relaie un message d'un salon lié vers tous les autres salons du même réseau,
 * via leurs webhooks (pseudo + avatar de l'auteur conservés). Les messages de
 * bots/webhooks sont ignorés : c'est la garantie anti-boucle (les relais sont
 * eux-mêmes des messages de webhook).
 */
export async function relayMessage(ctx: BotContext, message: Message): Promise<void> {
  if (message.author.bot || message.webhookId) return;
  if (!message.inGuild()) return;

  const hasContent = Boolean(message.content.trim());
  const files = [...message.attachments.values()]
    .slice(0, MAX_FILES)
    .map((attachment) => ({ attachment: attachment.url, name: attachment.name || 'fichier' }));
  if (!hasContent && files.length === 0) return;

  const link = await ctx.db.interserverLink.findUnique({ where: { channelId: message.channelId } });
  if (!link) return;
  if (!(await ctx.config.isEnabled(message.guildId, MODULE_NAME))) return;

  const targets = await ctx.db.interserverLink.findMany({
    where: { network: link.network, NOT: { channelId: message.channelId } },
  });
  if (targets.length === 0) return;

  const config = await getInterserverConfig(ctx, message.guildId);
  const base = message.member?.displayName ?? message.author.username;
  const username = (config.tagServer ? `${base} • ${message.guild.name}` : base).slice(0, 80);
  const avatarURL = message.author.displayAvatarURL({ extension: 'png', size: 128 });
  const content = hasContent ? sanitizeContent(message.content) : undefined;

  for (const target of targets) {
    if (!(await ctx.config.isEnabled(target.guildId, MODULE_NAME))) continue;
    const webhook = new WebhookClient({ id: target.webhookId, token: target.webhookToken });
    await webhook
      .send({ username, avatarURL, content, files, allowedMentions: { parse: [] } })
      .catch(async (error: unknown) => {
        // 10015 = webhook supprimé côté Discord : on nettoie le lien orphelin.
        if (errorCode(error) === 10015) {
          await ctx.db.interserverLink.delete({ where: { id: target.id } }).catch(() => undefined);
        } else {
          ctx.logger.warn({ err: error, target: target.channelId }, 'Relais interserveurs échoué');
        }
      });
  }
}
