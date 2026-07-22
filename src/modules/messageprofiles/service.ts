import { type GuildBasedChannel, PermissionFlagsBits, type Webhook } from 'discord.js';
import type { BotContext } from '../../core/module.js';
import type { MessageProfile } from './config.js';

const WEBHOOK_NAME = 'Vakz Profils';

/** Un salon capable de porter un webhook (salon texte/annonce), ou son parent pour un fil. */
interface WebhookTarget {
  webhook: Webhook;
  threadId?: string;
}

function canManageWebhooks(ctx: BotContext, channel: GuildBasedChannel): boolean {
  const me = channel.guild.members.me;
  return me?.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks) ?? false;
}

/** Récupère (ou crée) un webhook du bot dans le salon porteur, en gérant les fils. */
async function resolveWebhook(
  ctx: BotContext,
  channel: GuildBasedChannel,
): Promise<WebhookTarget | null> {
  // Pour un fil, le webhook vit sur le salon parent ; on cible le fil via threadId.
  let parent: GuildBasedChannel = channel;
  let threadId: string | undefined;
  if (channel.isThread()) {
    if (!channel.parent) return null;
    parent = channel.parent;
    threadId = channel.id;
  }
  if (!('createWebhook' in parent) || !('fetchWebhooks' in parent)) return null;
  if (!canManageWebhooks(ctx, parent)) return null;

  const botId = ctx.client.user?.id;
  const existing = await parent.fetchWebhooks().catch(() => null);
  let webhook =
    existing?.find((hook) => hook.owner?.id === botId && hook.name === WEBHOOK_NAME) ?? null;
  if (!webhook) {
    webhook = await parent
      .createWebhook({ name: WEBHOOK_NAME, reason: 'Profils de messages' })
      .catch(() => null);
  }
  if (!webhook) return null;
  return threadId ? { webhook, threadId } : { webhook };
}

export type SayResult = 'ok' | 'noperm' | 'fail';

/** Publie un message sous l'identité d'un profil (pseudo + avatar) via webhook. */
export async function sayAsProfile(
  ctx: BotContext,
  channel: GuildBasedChannel,
  profile: MessageProfile,
  content: string,
): Promise<SayResult> {
  const target = await resolveWebhook(ctx, channel);
  if (!target) return 'noperm';
  try {
    await target.webhook.send({
      content: content.slice(0, 2000),
      username: profile.name,
      ...(profile.avatarUrl ? { avatarURL: profile.avatarUrl } : {}),
      ...(target.threadId ? { threadId: target.threadId } : {}),
      // Admin only (ManageMessages) : on autorise les mentions membres/rôles,
      // mais jamais @everyone/@here.
      allowedMentions: { parse: ['users', 'roles'] },
    });
    return 'ok';
  } catch (error) {
    ctx.logger.warn(
      { err: error, guildId: channel.guild.id },
      'Envoi via profil de message échoué',
    );
    return 'fail';
  }
}
