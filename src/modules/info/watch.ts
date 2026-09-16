import { Events, EmbedBuilder, type GuildTextBasedChannel } from 'discord.js';
import { defineEvent, type BotContext } from '../../core/module.js';
import { Colors } from '../../lib/embeds.js';
import { MODULE_NAME, getInfoConfig, type InfoConfig } from './config.js';

/** Au-delà de ce nombre de membres, on évite le fetch complet (trop coûteux). */
const MEMBER_WARM_LIMIT = 5000;

/**
 * Précharge les membres en cache pour les serveurs où la surveillance est
 * active, afin que le PREMIER changement de profil dispose d'un « ancien état »
 * complet (sinon `oldMember`/`oldUser` est partiel et le changement est ignoré).
 * Les nouveaux arrivants sont, eux, mis en cache par `guildMemberAdd`.
 */
export async function warmMemberCache(ctx: BotContext): Promise<void> {
  for (const guild of ctx.client.guilds.cache.values()) {
    try {
      if (!(await ctx.config.isEnabled(guild.id, MODULE_NAME))) continue;
      const config = await getInfoConfig(ctx, guild.id);
      if (!config.watchEnabled) continue;
      if (guild.memberCount > MEMBER_WARM_LIMIT) continue;
      await guild.members.fetch();
    } catch {
      /* rate-limit ou permissions : on ignore, le cache se remplira à l'usage */
    }
  }
}

/**
 * URL commune posée sur plusieurs embeds pour que le client Discord les
 * fusionne en une seule « galerie » d'images (astuce d'affichage avant/après).
 */
const GALLERY_URL = 'https://discord.com';

/** Récupère le salon de logs configuré s'il est textuel. */
async function resolveChannel(
  guild: { channels: { fetch: (id: string) => Promise<unknown> } },
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && (channel as GuildTextBasedChannel).isTextBased?.()
    ? (channel as GuildTextBasedChannel)
    : null;
}

/** Le membre est-il concerné par la surveillance (filtre de rôles) ? */
function roleAllowed(config: InfoConfig, roleIds: string[]): boolean {
  if (config.watchRoleIds.length === 0) return true;
  return config.watchRoleIds.some((id) => roleIds.includes(id));
}

/**
 * Publie l'embed de surveillance. Si un changement d'avatar est fourni, ajoute
 * un second embed (même `url`) pour afficher **avant puis après** en galerie.
 */
async function sendWatch(
  channel: GuildTextBasedChannel | null,
  embed: EmbedBuilder,
  avatars?: { before: string; after: string },
): Promise<void> {
  if (!channel) return;
  const embeds = [embed];
  if (avatars) {
    embed.setURL(GALLERY_URL).setImage(avatars.before);
    embeds.push(
      new EmbedBuilder().setColor(Colors.brand).setURL(GALLERY_URL).setImage(avatars.after),
    );
  }
  await channel.send({ embeds }).catch(() => undefined);
}

/**
 * Changements de profil GLOBAUX (nom d'utilisateur, nom affiché, photo de
 * profil). L'évènement est global : on notifie chaque serveur partagé où la
 * surveillance est active et où le membre est présent.
 */
export const onUserUpdate = defineEvent({
  name: Events.UserUpdate,
  async execute(ctx, oldUser, newUser) {
    if (newUser.bot) return;
    const usernameChanged = oldUser.username !== newUser.username;
    const globalNameChanged = oldUser.globalName !== newUser.globalName;
    const avatarChanged = oldUser.avatar !== newUser.avatar;
    if (!usernameChanged && !globalNameChanged && !avatarChanged) return;

    for (const guild of ctx.client.guilds.cache.values()) {
      const member = guild.members.cache.get(newUser.id);
      if (!member) continue;
      if (!(await ctx.config.isEnabled(guild.id, MODULE_NAME))) continue;
      const config = await getInfoConfig(ctx, guild.id);
      if (!config.watchEnabled || !config.watchChannelId) continue;
      if (!roleAllowed(config, [...member.roles.cache.keys()])) continue;

      const embed = new EmbedBuilder()
        .setColor(Colors.brand)
        .setAuthor({ name: newUser.tag, iconURL: newUser.displayAvatarURL() })
        .setDescription(`🪪 <@${newUser.id}> a modifié son profil.`)
        .setFooter({ text: `ID : ${newUser.id}` })
        .setTimestamp();

      let hasContent = false;
      let avatars: { before: string; after: string } | undefined;
      if (usernameChanged && config.watchUsername) {
        embed.addFields({
          name: "Nom d'utilisateur",
          value: `\`${oldUser.username}\` → \`${newUser.username}\``,
        });
        hasContent = true;
      }
      if (globalNameChanged && config.watchGlobalName) {
        embed.addFields({
          name: 'Nom affiché',
          value: `${oldUser.globalName ?? '—'} → **${newUser.globalName ?? '—'}**`,
        });
        hasContent = true;
      }
      if (avatarChanged && config.watchAvatar) {
        embed.addFields({ name: 'Photo de profil', value: 'Avant, puis après 👇' });
        avatars = {
          before: oldUser.displayAvatarURL({ size: 256 }),
          after: newUser.displayAvatarURL({ size: 256 }),
        };
        hasContent = true;
      }
      if (!hasContent) continue;

      const channel = await resolveChannel(guild, config.watchChannelId);
      await sendWatch(channel, embed, avatars);
    }
  },
});

/**
 * Changement de PSEUDO SERVEUR (nickname) ou d'avatar de serveur. Évènement par
 * serveur (les rôles/timeout sont gérés par le module Logs).
 */
export const onGuildMemberUpdate = defineEvent({
  name: Events.GuildMemberUpdate,
  async execute(ctx, oldMember, newMember) {
    if (newMember.user.bot) return;
    // oldMember partiel = ancien état non fiable (membre pas en cache) : ses
    // champs seraient `null` et provoqueraient de faux changements (ex. un faux
    // « changement de pseudo » quand le membre est mis en cache par un autre
    // évènement).
    if (oldMember.partial) return;

    const nicknameChanged = oldMember.nickname !== newMember.nickname;
    const avatarChanged = oldMember.avatar !== newMember.avatar; // avatar de serveur
    if (!nicknameChanged && !avatarChanged) return;

    if (!(await ctx.config.isEnabled(newMember.guild.id, MODULE_NAME))) return;
    const config = await getInfoConfig(ctx, newMember.guild.id);
    if (!config.watchEnabled || !config.watchChannelId) return;
    if (!roleAllowed(config, [...newMember.roles.cache.keys()])) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.brand)
      .setAuthor({ name: newMember.user.tag, iconURL: newMember.displayAvatarURL() })
      .setDescription(`🪪 <@${newMember.id}> a mis à jour son profil sur le serveur.`)
      .setFooter({ text: `ID : ${newMember.id}` })
      .setTimestamp();

    let hasContent = false;
    let avatars: { before: string; after: string } | undefined;
    if (nicknameChanged && config.watchNickname) {
      embed.addFields({
        name: 'Pseudo serveur',
        value: `${oldMember.nickname ?? '*(aucun)*'} → **${newMember.nickname ?? '*(aucun)*'}**`,
      });
      hasContent = true;
    }
    if (avatarChanged && config.watchAvatar) {
      embed.addFields({ name: 'Photo de profil (serveur)', value: 'Avant, puis après 👇' });
      avatars = {
        before: oldMember.displayAvatarURL({ size: 256 }),
        after: newMember.displayAvatarURL({ size: 256 }),
      };
      hasContent = true;
    }
    if (!hasContent) return;

    const channel = await resolveChannel(newMember.guild, config.watchChannelId);
    await sendWatch(channel, embed, avatars);
  },
});
