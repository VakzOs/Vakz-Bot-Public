import type { GuildMember } from 'discord.js';
import type { BotContext, ScheduledTask, TaskReport } from '../../core/module.js';

/**
 * Renommage temporaire (effet `nickname` d'un objet). Le pseudo d'origine est
 * mémorisé en base : il est restauré par la tâche planifiée à l'expiration,
 * même si le bot a redémarré entre-temps.
 */
export type TempNicknameResult = 'ok' | 'tooHigh' | 'fail';

export async function applyTempNickname(
  ctx: BotContext,
  member: GuildMember,
  nickname: string,
  minutes: number,
): Promise<TempNicknameResult> {
  // Hierarchie : impossible de renommer le proprietaire du serveur ni un membre
  // dont le role le plus haut est >= a celui du bot (`manageable` couvre les deux).
  if (!member.manageable) return 'tooHigh';

  const guildId = member.guild.id;
  const expiresAt = new Date(Date.now() + minutes * 60_000);

  // Si un renommage est déjà en cours, on conserve le pseudo d'ORIGINE (sinon
  // on mémoriserait le surnom temporaire précédent) et on repousse l'échéance.
  const existing = await ctx.db.tempNickname.findUnique({
    where: { guildId_userId: { guildId, userId: member.id } },
  });
  const previousNick = existing ? existing.previousNick : member.nickname;

  const renamed = await member
    .setNickname(nickname.slice(0, 32))
    .then(() => true)
    .catch(() => false);
  if (!renamed) return 'fail';

  await ctx.db.tempNickname.upsert({
    where: { guildId_userId: { guildId, userId: member.id } },
    update: { expiresAt, previousNick },
    create: { guildId, userId: member.id, previousNick, expiresAt },
  });
  return 'ok';
}

/**
 * Restaure les pseudos dont le renommage temporaire est arrivé à échéance.
 * Best effort : une restauration impossible (membre parti, droits perdus)
 * supprime quand même la ligne pour ne pas réessayer indéfiniment.
 */
export async function restoreExpiredNicknames(ctx: BotContext): Promise<TaskReport> {
  const due = await ctx.db.tempNickname
    .findMany({ where: { expiresAt: { lte: new Date() } }, take: 100 })
    .catch(() => []);

  let restaures = 0;
  let abandons = 0;
  for (const row of due) {
    const guild = ctx.client.guilds.cache.get(row.guildId);
    const member = guild ? await guild.members.fetch(row.userId).catch(() => null) : null;
    if (member) {
      const ok = await member
        .setNickname(row.previousNick)
        .then(() => true)
        .catch(() => false);
      if (ok) restaures += 1;
      else abandons += 1;
    } else {
      abandons += 1;
    }
    await ctx.db.tempNickname.delete({ where: { id: row.id } }).catch(() => undefined);
  }
  // `abandons` compte les lignes supprimées sans avoir pu rendre son pseudo au
  // membre : c'est ce qu'on cherche quand quelqu'un signale être resté renommé.
  return { restaures, abandons };
}

/** Restaure les pseudos expirés chaque minute. */
export const tempNicknameTask: ScheduledTask = {
  name: 'restoreNicknames',
  cron: '* * * * *',
  execute: restoreExpiredNicknames,
};
