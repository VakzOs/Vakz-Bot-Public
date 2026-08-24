import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, successEmbed } from '../../lib/embeds.js';
import { type VerificationConfig } from './config.js';

/** customId du bouton public déclenchant la vérification (hors `/config`). */
export const START_CUSTOM_ID = 'verif|start';
/** customId du bouton public ouvrant la saisie du code (captcha). */
export const OPEN_CUSTOM_ID = 'verif|open';

/** Embed de vérification affiché aux membres. */
export function buildVerificationEmbed(config: VerificationConfig): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(config.title)
    .setDescription(config.content);
}

/** Rangée contenant le bouton « Se vérifier ». */
export function buildVerifyRow(
  config: VerificationConfig,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(START_CUSTOM_ID)
      .setLabel(config.buttonLabel)
      .setStyle(ButtonStyle.Success),
  );
}

/** Rangée « Saisir le code » présentée avec l'image de captcha. */
export function buildOpenRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_CUSTOM_ID)
      .setLabel(t('modules.verification.feedback.openButton'))
      .setStyle(ButtonStyle.Primary),
  );
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'nochannel' | 'send' };

/** Publie (ou met à jour) le message de vérification dans le salon configuré. */
export async function publishVerification(
  guild: Guild,
  config: VerificationConfig,
): Promise<PublishResult> {
  if (!config.channelId) return { ok: false, error: 'nochannel' };

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, error: 'nochannel' };

  const payload = {
    embeds: [buildVerificationEmbed(config)],
    components: [buildVerifyRow(config)],
  };

  if (config.messageId) {
    const existing = await channel.messages.fetch(config.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      return { ok: true, messageId: existing.id };
    }
  }

  try {
    const sent = await channel.send(payload);
    return { ok: true, messageId: sent.id };
  } catch {
    return { ok: false, error: 'send' };
  }
}

/**
 * Indique si le bot peut attribuer le rôle vérifié : permission `ManageRoles` et
 * rôle situé sous le rôle le plus haut du bot.
 */
export function roleAssignable(guild: Guild, roleId: string): boolean {
  const me = guild.members.me;
  const role = guild.roles.cache.get(roleId);
  if (!me || !role) return false;
  return (
    me.permissions.has(PermissionFlagsBits.ManageRoles) && role.position < me.roles.highest.position
  );
}

/** Attribue le rôle vérifié au membre. Renvoie `false` en cas d'échec. */
export async function grantVerifiedRole(member: GuildMember, roleId: string): Promise<boolean> {
  try {
    await member.roles.add(roleId, 'Vérification réussie');
    return true;
  } catch {
    return false;
  }
}

/** Journalise une vérification réussie dans le salon de logs si configuré. */
export async function logVerification(
  ctx: BotContext,
  guild: Guild,
  config: VerificationConfig,
  userId: string,
): Promise<void> {
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const embed = successEmbed({
    description: t('modules.verification.log.verified', { user: `<@${userId}>` }),
    timestamp: true,
  });
  await channel
    .send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch((error: unknown) =>
      ctx.logger.warn({ err: error, guildId: guild.id }, 'Log vérification échoué'),
    );
}
