import {
  AuditLogEvent,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type Invite,
} from 'discord.js';
import type { BotContext } from '../../core/module.js';
import { isInviteTrackingEnabled } from './config.js';

/** Comment une arrivée a été rattachée (ou non) à une invitation. */
export type JoinSource = 'invite' | 'vanity' | 'bot' | 'unknown';

/** Ce qu'on a pu établir de l'origine d'une arrivée. */
export interface JoinOrigin {
  source: JoinSource;
  /** Code emprunté, quand il y en a un. */
  code: string | null;
  /** Auteur de l'invitation, ou membre ayant ajouté le bot. */
  inviterId: string | null;
  /** Utilisations du code une fois cette arrivée comptée. */
  uses: number | null;
}

/** Ce qu'on retient d'une invitation entre deux arrivées. */
export interface InviteState {
  uses: number;
  /** `0` = sans limite. */
  maxUses: number;
  inviterId: string | null;
  /** L'URL personnalisée d'un serveur boosté, qui n'a pas d'auteur. */
  vanity: boolean;
}

const AUDIT_LOG_WINDOW_MS = 15_000;

/**
 * Compteurs d'utilisation vus au dernier passage, par serveur puis par code.
 *
 * Discord ne dit JAMAIS quelle invitation un arrivant a empruntée : la seule
 * façon de le savoir est de comparer les compteurs d'avant et d'après. D'où cet
 * instantané — en mémoire, et non en base. Il ne survit pas à un redémarrage,
 * et il n'a pas à le faire : un bot éteint ne reçoit aucune arrivée, donc il
 * n'y a rien à comparer au retour ; `warmInviteCache` repose l'instantané au
 * démarrage, avant la première arrivée.
 */
const snapshots = new Map<string, Map<string, InviteState>>();

/** Origine qu'on n'a pas su établir. */
function unknownOrigin(): JoinOrigin {
  return { source: 'unknown', code: null, inviterId: null, uses: null };
}

/**
 * Lit les compteurs d'utilisation du serveur, ou `null` si c'est impossible.
 *
 * `null` n'est pas « aucune invitation » mais « on n'a pas pu regarder » :
 * sans la permission « Gérer le serveur », Discord refuse la liste, et prendre
 * ce refus pour une liste vide ferait croire à un serveur sans invitations.
 */
async function readInvites(guild: Guild): Promise<Map<string, InviteState> | null> {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) return null;

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;

  const state = new Map<string, InviteState>();
  for (const invite of invites.values()) {
    state.set(invite.code, {
      uses: invite.uses ?? 0,
      maxUses: invite.maxUses ?? 0,
      inviterId: invite.inviterId ?? null,
      vanity: false,
    });
  }

  // L'URL personnalisée d'un serveur boosté ne figure pas dans cette liste :
  // sans elle, les arrivées d'un gros serveur seraient toutes « inconnues ».
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity?.code) {
      state.set(vanity.code, {
        uses: vanity.uses ?? 0,
        maxUses: 0,
        inviterId: null,
        vanity: true,
      });
    }
  }

  return state;
}

/**
 * Pose l'instantané d'un serveur. Rend `false` si les compteurs sont illisibles.
 */
export async function warmInviteCache(ctx: BotContext, guild: Guild): Promise<boolean> {
  const state = await readInvites(guild);
  if (!state) {
    // Se taire ici laisserait croire à un suivi qui suit : sans « Gérer le
    // serveur », chaque arrivée sera rendue « origine inconnue », et personne
    // ne saurait pourquoi.
    ctx.logger.warn(
      { guildId: guild.id },
      'Suivi des invitations impossible : permission « Gérer le serveur » manquante',
    );
    return false;
  }
  snapshots.set(guild.id, state);
  return true;
}

/** Amorce les instantanés des serveurs qui suivent leurs invitations. */
export async function warmAllInviteCaches(ctx: BotContext): Promise<void> {
  for (const guild of ctx.client.guilds.cache.values()) {
    if (!(await isInviteTrackingEnabled(ctx, guild.id))) continue;
    await warmInviteCache(ctx, guild);
  }
}

/**
 * Ajoute une invitation fraîchement créée à l'instantané.
 *
 * Sans cela, une invitation créée puis empruntée dans la foulée n'aurait aucun
 * compteur « d'avant » à qui se comparer, et l'arrivée serait perdue.
 */
export function rememberInvite(invite: Invite): void {
  const guildId = invite.guild?.id;
  if (!guildId) return;
  // Pas d'instantané = suivi éteint sur ce serveur : rien à tenir à jour.
  const state = snapshots.get(guildId);
  if (!state) return;
  state.set(invite.code, {
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    inviterId: invite.inviterId ?? null,
    vanity: false,
  });
}

/** Oublie un serveur quitté : son instantané n'a plus d'objet. */
export function forgetGuildInvites(guildId: string): void {
  snapshots.delete(guildId);
}

/** Auteur de la dernière entrée d'audit d'un type donné, si elle est récente. */
export async function recentAuditExecutor(
  guild: Guild,
  action: AuditLogEvent,
): Promise<string | null> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

  // Sans filtrage sur la cible, contrairement à `findAuditExecutor` : une
  // entrée d'audit d'invitation ne porte pas d'identifiant de cible, il n'y a
  // donc rien à comparer — seule la fenêtre de temps fait foi.
  const logs = await guild.fetchAuditLogs({ type: action, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find(
    (item) => Date.now() - item.createdTimestamp <= AUDIT_LOG_WINDOW_MS,
  );
  return entry?.executorId ?? null;
}

/**
 * Établit par quelle invitation un membre vient d'entrer, et repose
 * l'instantané au passage.
 */
export async function resolveJoinOrigin(ctx: BotContext, member: GuildMember): Promise<JoinOrigin> {
  // Un bot n'entre pas par une invitation mais par une autorisation OAuth :
  // les compteurs ne bougent pas, et c'est le journal d'audit qui sait qui l'a
  // ajouté.
  if (member.user.bot) {
    const addedBy = await recentAuditExecutor(member.guild, AuditLogEvent.BotAdd);
    return { source: 'bot', code: null, inviterId: addedBy, uses: null };
  }

  const before = snapshots.get(member.guild.id);
  const after = await readInvites(member.guild);
  if (after) snapshots.set(member.guild.id, after);
  // Sans point de comparaison (premier passage, permission manquante), toute
  // invitation non nulle aurait l'air d'avoir servi : on préfère ne rien dire.
  if (!before || !after) return unknownOrigin();
  return diffInvites(before, after);
}

/**
 * Compare deux relevés et désigne l'invitation qui a servi.
 *
 * Séparé de la lecture pour être éprouvable sans Discord : c'est ici que se
 * joue tout le suivi, et une erreur y attribuerait chaque arrivée au mauvais
 * membre sans que rien n'échoue.
 */
export function diffInvites(
  before: ReadonlyMap<string, InviteState>,
  after: ReadonlyMap<string, InviteState>,
): JoinOrigin {
  for (const [code, state] of after) {
    const previous = before.get(code);
    if (!previous || state.uses <= previous.uses) continue;
    return {
      source: state.vanity ? 'vanity' : 'invite',
      code,
      inviterId: state.inviterId,
      uses: state.uses,
    };
  }

  // Une invitation qui atteint son plafond est supprimée par Discord au moment
  // même où elle sert : elle a disparu de la liste au lieu de voir son compteur
  // monter. C'est pourquoi `onInviteDelete` ne touche pas à l'instantané — la
  // trace qu'il effacerait est précisément la réponse. On ne conclut que si une
  // seule a disparu : deux, et la question n'en a plus.
  const spent = [...before].filter(
    ([code, state]) => !after.has(code) && state.maxUses > 0 && state.uses + 1 >= state.maxUses,
  );
  const only = spent.length === 1 ? spent[0] : undefined;
  if (!only) return unknownOrigin();

  return {
    source: 'invite',
    code: only[0],
    inviterId: only[1].inviterId,
    uses: only[1].uses + 1,
  };
}

/** Écrit l'arrivée et son origine. */
export async function recordJoin(
  ctx: BotContext,
  member: GuildMember,
  origin: JoinOrigin,
): Promise<void> {
  await ctx.db.logInviteJoin.create({
    data: {
      guildId: member.guild.id,
      userId: member.id,
      inviterId: origin.inviterId,
      code: origin.code ?? '',
      source: origin.source,
    },
  });
}

/** Ce qu'on a retenu d'une arrivée. */
export interface RecordedJoin {
  inviterId: string | null;
  code: string;
  source: JoinSource;
  joinedAt: Date;
}

/**
 * Referme la dernière arrivée ouverte d'un membre et la rend.
 *
 * Rendre la ligne permet au log de départ de nommer celui qui l'avait fait
 * entrer, sans relire la base une seconde fois.
 */
export async function closeJoin(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<RecordedJoin | null> {
  const open = await ctx.db.logInviteJoin.findFirst({
    where: { guildId, userId, leftAt: null },
    orderBy: { joinedAt: 'desc' },
  });
  if (!open) return null;

  await ctx.db.logInviteJoin.update({ where: { id: open.id }, data: { leftAt: new Date() } });
  return {
    inviterId: open.inviterId,
    code: open.code,
    source: asJoinSource(open.source),
    joinedAt: open.joinedAt,
  };
}

/** La dernière arrivée connue d'un membre, refermée ou non. */
export async function lastJoinOf(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<RecordedJoin | null> {
  const row = await ctx.db.logInviteJoin.findFirst({
    where: { guildId, userId },
    orderBy: { joinedAt: 'desc' },
  });
  if (!row) return null;
  return {
    inviterId: row.inviterId,
    code: row.code,
    source: asJoinSource(row.source),
    joinedAt: row.joinedAt,
  };
}

/** Une valeur relue en base n'est pas forcément un `JoinSource` connu. */
function asJoinSource(value: string): JoinSource {
  return value === 'invite' || value === 'vanity' || value === 'bot' ? value : 'unknown';
}

/** Combien de membres quelqu'un a fait entrer, et combien sont restés. */
export interface InviterStats {
  total: number;
  present: number;
  left: number;
}

export async function inviterStats(
  ctx: BotContext,
  guildId: string,
  inviterId: string,
): Promise<InviterStats> {
  const [total, present] = await Promise.all([
    ctx.db.logInviteJoin.count({ where: { guildId, inviterId } }),
    ctx.db.logInviteJoin.count({ where: { guildId, inviterId, leftAt: null } }),
  ]);
  return { total, present, left: total - present };
}

/** Les derniers membres qu'une personne a fait entrer. */
export async function recentlyInvitedBy(
  ctx: BotContext,
  guildId: string,
  inviterId: string,
  limit: number,
): Promise<{ userId: string; joinedAt: Date; leftAt: Date | null }[]> {
  const rows = await ctx.db.logInviteJoin.findMany({
    where: { guildId, inviterId },
    orderBy: { joinedAt: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({ userId: row.userId, joinedAt: row.joinedAt, leftAt: row.leftAt }));
}

/** Une ligne du classement des invitations. */
export interface InviterRank {
  inviterId: string;
  total: number;
  present: number;
}

/**
 * Le classement des invitations d'un serveur.
 *
 * Deux regroupements et non un seul : SQLite ne compte pas conditionnellement
 * ici, et le total seul récompenserait qui invite des comptes qui repartent
 * aussitôt.
 */
export async function topInviters(
  ctx: BotContext,
  guildId: string,
  limit: number,
): Promise<InviterRank[]> {
  const totals = await ctx.db.logInviteJoin.groupBy({
    by: ['inviterId'],
    where: { guildId, inviterId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { inviterId: 'desc' } },
    take: limit,
  });
  if (totals.length === 0) return [];

  const inviterIds = totals.flatMap((row) => (row.inviterId ? [row.inviterId] : []));
  const staying = await ctx.db.logInviteJoin.groupBy({
    by: ['inviterId'],
    where: { guildId, inviterId: { in: inviterIds }, leftAt: null },
    _count: { _all: true },
  });
  const present = new Map(
    staying.flatMap((row) => (row.inviterId ? [[row.inviterId, row._count._all] as const] : [])),
  );

  return totals.flatMap((row) =>
    row.inviterId
      ? [
          {
            inviterId: row.inviterId,
            total: row._count._all,
            present: present.get(row.inviterId) ?? 0,
          },
        ]
      : [],
  );
}

/** Nombre d'arrivées suivies sur un serveur. */
export function countTrackedJoins(ctx: BotContext, guildId: string): Promise<number> {
  return ctx.db.logInviteJoin.count({ where: { guildId } });
}

/**
 * Établit et mémorise l'origine d'une arrivée, ou rend `null` si le serveur ne
 * suit pas ses invitations.
 */
export async function trackJoin(ctx: BotContext, member: GuildMember): Promise<JoinOrigin | null> {
  if (!(await isInviteTrackingEnabled(ctx, member.guild.id))) return null;
  const origin = await resolveJoinOrigin(ctx, member);
  await recordJoin(ctx, member, origin);
  return origin;
}
