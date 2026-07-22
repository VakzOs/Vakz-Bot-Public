import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import { MODULE_NAME, type RulesConfig } from './config.js';

/** customId du bouton d'acceptation publié dans le salon (hors `/config`). */
export const ACCEPT_CUSTOM_ID = `${MODULE_NAME}|accept`;

/** Embed du règlement affiché aux membres. */
export function buildRulesEmbed(config: RulesConfig): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.brand)
    .setTitle(config.title)
    .setDescription(config.content)
    .setFooter({ text: t('modules.rules.embed.version', { version: config.version }) });
}

/** Rangée contenant le bouton « J'accepte le règlement ». */
export function buildAcceptRow(
  config: RulesConfig,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ACCEPT_CUSTOM_ID)
      .setLabel(config.buttonLabel)
      .setStyle(ButtonStyle.Success),
  );
}

export type PublishResult =
  | { ok: true; messageId: string }
  | { ok: false; error: 'nochannel' | 'send' };

/** Publie (ou met à jour) le message du règlement dans le salon configuré. */
export async function publishRules(guild: Guild, config: RulesConfig): Promise<PublishResult> {
  if (!config.channelId) return { ok: false, error: 'nochannel' };

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, error: 'nochannel' };

  const payload = { embeds: [buildRulesEmbed(config)], components: [buildAcceptRow(config)] };

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

/** Nombre de membres à jour avec la version courante du règlement. */
export async function countUpToDate(
  ctx: BotContext,
  guildId: string,
  version: number,
): Promise<number> {
  return ctx.db.ruleAcceptance.count({ where: { guildId, version: { gte: version } } });
}

/** Journalise une acceptation dans le salon de logs si configuré. */
export async function logAcceptance(
  ctx: BotContext,
  guild: Guild,
  config: RulesConfig,
  userId: string,
): Promise<void> {
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setColor(Colors.success)
    .setDescription(
      t('modules.rules.log.accepted', { user: `<@${userId}>`, version: config.version }),
    );
  await channel
    .send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch((error: unknown) =>
      ctx.logger.warn({ err: error, guildId: guild.id }, 'Log règlement échoué'),
    );
}
