import { PermissionFlagsBits } from 'discord.js';
import { db } from './db.js';
import { createLogger } from './logger.js';
import { LIST_VERBS, type ListVerb } from './config-parts.js';
import type { BotContext } from './module.js';

const log = createLogger('guild-access');

/**
 * Qui peut quoi, sur le dashboard d'un serveur.
 *
 * L'entrée était binaire : propriétaire du serveur ou « Gérer le serveur » d'un
 * côté, tout le reste dehors — et qui entrait pouvait TOUT régler. Un serveur
 * qui voulait laisser ses modérateurs toucher à l'auto-modération devait leur
 * donner « Gérer le serveur », donc aussi la sauvegarde, la purge et les
 * réglages du serveur Discord lui-même.
 *
 * Ici, le serveur se donne des **grades** : un nom qu'il choisit, ce que ce
 * grade ouvre, et ce qui le confère. Trois choix indépendants, et c'est ce qui
 * fait la souplesse :
 *   - un grade n'est PAS un rôle Discord et n'en crée aucun. Il peut s'adosser
 *     à des rôles (le porter, c'est l'avoir ; le perdre, c'est le perdre), à
 *     des membres nommés, ou aux deux ;
 *   - ce qu'il ouvre se compte par module, ou par **bloc de réglages** d'un
 *     module : « Anti-spam » sans le reste de l'auto-modération.
 *
 * Deux garde-fous dans tout ce fichier :
 *   - ce qui est irréversible (purge) ou qui distribue le pouvoir lui-même (les
 *     grades) ne se délègue PAS : un gradé ne peut pas s'élargir ;
 *   - aucun grade = comportement d'avant, à l'identique.
 */

/** Ce qu'un grade peut recevoir hors modules — un réglage à la fois. */
export const ACCESS_SCOPES = ['serveur.langue', 'serveur.sauvegarde'] as const;

export type AccessScope = (typeof ACCESS_SCOPES)[number];

/** Préfixe d'une permission qui vise un module (`module:automod`). */
const MODULE_PREFIX = 'module:';

/** Sépare le module du bloc visé (`module:automod/spam`). */
const PART_SEPARATOR = '/';

/** Sépare le bloc du verbe (`module:stickymessages/@0:creer`). */
const VERB_SEPARATOR = ':';

/** Sépare le module du bouton d'action visé (`module:stickymessages@repost`). */
const ACTION_SEPARATOR = '@';

function isListVerb(value: string): value is ListVerb {
  return (LIST_VERBS as readonly string[]).includes(value);
}

/**
 * L'identifiant réservé du bouton qui publie ou met à jour le panneau d'un
 * module (`publishPanel`). Ce n'est pas une action déclarée par le module, mais
 * il se délègue comme les autres : republier un panneau est un geste, pas un
 * réglage.
 */
export const PUBLISH_ACTION = 'publier';

/**
 * L'identifiant réservé de l'INTERRUPTEUR du module.
 *
 * Allumer ou éteindre vaut pour tout le serveur, mais c'est un geste, pas un
 * réglage : un serveur peut vouloir qu'une équipe puisse couper l'automod
 * pendant un raid sans pouvoir en changer une virgule.
 */
export const TOGGLE_ACTION = 'activer';

/**
 * La permission qui ouvre un module ENTIER : ses réglages, son interrupteur et
 * ses boutons d'action.
 */
export function modulePermission(moduleName: string): string {
  return `${MODULE_PREFIX}${moduleName}`;
}

/** La permission qui ouvre un bloc de réglages entier — tous ses verbes. */
export function modulePartPermission(moduleName: string, part: string): string {
  return `${MODULE_PREFIX}${moduleName}${PART_SEPARATOR}${part}`;
}

/** La permission qui n'ouvre qu'UN verbe d'un bloc. */
export function modulePartVerbPermission(moduleName: string, part: string, verb: ListVerb): string {
  return `${modulePartPermission(moduleName, part)}${VERB_SEPARATOR}${verb}`;
}

/** La permission qui n'ouvre qu'un bouton d'action du module. */
export function moduleActionPermission(moduleName: string, actionId: string): string {
  return `${MODULE_PREFIX}${moduleName}${ACTION_SEPARATOR}${actionId}`;
}

/**
 * Le niveau d'un acteur sur un serveur.
 *
 * `manager` — propriétaire du serveur ou « Gérer le serveur » : tout, y compris
 * ce qui ne se délègue pas. `staff` — un gradé, borné à ses permissions.
 * `none` — rien du tout, pas même la lecture.
 */
export type AccessLevel = 'manager' | 'staff' | 'none';

export interface GuildAccess {
  level: AccessLevel;
  /**
   * Permissions effectives. Toujours vide pour un `manager` : il les a toutes,
   * et les énumérer donnerait une liste à tenir à jour à chaque module ajouté.
   * On passe donc par `grants()` plutôt que par `includes()`.
   */
  permissions: string[];
  /** Les grades qui ont porté cet accès, pour que le dashboard puisse le dire. */
  grades: string[];
}

/** Un grade : son nom, ce qu'il ouvre, ce qui le confère. */
export interface Grade {
  id: string;
  name: string;
  /** Rôles Discord qui confèrent ce grade. Peut être vide. */
  roleIds: string[];
  /** Membres qui le portent nominativement. Peut être vide. */
  memberIds: string[];
  permissions: string[];
  position: number;
}

/** Un grade tel qu'il arrive du dashboard : l'identifiant manque à la création. */
export type GradeInput = Omit<Grade, 'id'> & { id?: string };

const NO_ACCESS: GuildAccess = { level: 'none', permissions: [], grades: [] };
const FULL_ACCESS: GuildAccess = { level: 'manager', permissions: [], grades: [] };

/** Bornes retenues : un nom de grade se lit, il ne se raconte pas. */
export const MAX_GRADES = 25;
export const MAX_GRADE_NAME = 60;
const MAX_IDS_PER_GRADE = 50;

/** L'acteur a-t-il CETTE permission ? Un `manager` les a toutes. */
export function grants(access: GuildAccess, permission: string): boolean {
  if (access.level === 'manager') return true;
  return access.level === 'staff' && access.permissions.includes(permission);
}

/** L'acteur peut-il tout faire sur ce module (réglages, interrupteur, actions) ? */
export function grantsModule(access: GuildAccess, moduleName: string): boolean {
  return grants(access, modulePermission(moduleName));
}

/** Ce qu'un grade ouvre d'un bloc : tous ses verbes (`'*'`), ou certains. */
export type PartGrant = '*' | Set<ListVerb>;

/** Ce qu'un grade ouvre d'un module, quand il ne l'ouvre pas en entier. */
export interface PartialGrant {
  /** Les blocs ouverts, et jusqu'où. */
  parts: Map<string, PartGrant>;
  /** Les boutons d'action ouverts, par identifiant. */
  actions: Set<string>;
}

/** Tout le module, ou le détail de ce qui en est ouvert. */
export type ModuleGrant = '*' | PartialGrant;

/**
 * Ce que l'acteur peut faire de ce module, dans le détail.
 *
 * Une permission partielle ne se vérifie pas d'un booléen : il faut savoir CE
 * QUI est ouvert — quels blocs, quels verbes sur leurs lignes, quels boutons —
 * pour ne réécrire que cela et ne lancer que ce qui est permis.
 */
export function moduleGrant(access: GuildAccess, moduleName: string): ModuleGrant {
  if (grantsModule(access, moduleName)) return '*';
  const partPrefix = `${modulePermission(moduleName)}${PART_SEPARATOR}`;
  const actionPrefix = `${modulePermission(moduleName)}${ACTION_SEPARATOR}`;
  const parts = new Map<string, PartGrant>();
  const actions = new Set<string>();
  for (const permission of access.permissions) {
    if (permission.startsWith(actionPrefix)) {
      actions.add(permission.slice(actionPrefix.length));
      continue;
    }
    if (!permission.startsWith(partPrefix)) continue;
    const rest = permission.slice(partPrefix.length);
    // Le verbe est ce qui suit le DERNIER `:` — un bloc sans clé se nomme
    // « @0 », qui n'en contient pas, et une clé de config non plus.
    const cut = rest.lastIndexOf(VERB_SEPARATOR);
    const verb = cut > 0 ? rest.slice(cut + 1) : '';
    if (cut > 0 && isListVerb(verb)) {
      const part = rest.slice(0, cut);
      const current = parts.get(part);
      // Le bloc entier l'emporte : il contient déjà tous les verbes.
      if (current === '*') continue;
      const verbs = current ?? new Set<ListVerb>();
      verbs.add(verb);
      parts.set(part, verbs);
      continue;
    }
    parts.set(rest, '*');
  }
  return { parts, actions };
}

/** Le grade ouvre-t-il quelque chose de ce module ? */
export function grantsAnything(grant: ModuleGrant): boolean {
  return grant === '*' || grant.parts.size > 0 || grant.actions.size > 0;
}

/** Les verbes ouverts sur ce bloc, ou `undefined` si le bloc est fermé. */
export function partVerbs(grant: ModuleGrant, part: string): Set<ListVerb> | undefined {
  if (grant === '*') return new Set(LIST_VERBS);
  const value = grant.parts.get(part);
  if (!value) return undefined;
  return value === '*' ? new Set(LIST_VERBS) : value;
}

/** Ce bouton d'action est-il ouvert à ce grade ? */
export function grantsAction(grant: ModuleGrant, actionId: string): boolean {
  return grant === '*' || grant.actions.has(actionId);
}

/**
 * Les grades d'un serveur, en mémoire.
 *
 * Ils sont relus à chaque appel de l'API web — et un dashboard ouvert en fait
 * beaucoup. Le cache est invalidé à l'écriture et à la purge, les deux seuls
 * endroits d'où ils changent.
 */
const cache = new Map<string, Grade[]>();

/** Une liste sérialisée façon i18n : une chaîne jointe par « | ». */
function parseList(raw: string): string[] {
  return raw
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isSnowflake(value: string): boolean {
  return /^\d{5,25}$/.test(value);
}

/** Les grades en vigueur sur ce serveur (liste vide s'il n'y en a aucun). */
export async function listGrades(guildId: string): Promise<Grade[]> {
  const cached = cache.get(guildId);
  if (cached) return cached;
  let grades: Grade[];
  try {
    const rows = await db.guildGrade.findMany({
      where: { guildId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    grades = rows.map((row) => ({
      id: row.id,
      name: row.name,
      roleIds: parseList(row.roleIds),
      memberIds: parseList(row.memberIds),
      permissions: parseList(row.permissions),
      position: row.position,
    }));
  } catch (error) {
    // Une base injoignable ne doit pas OUVRIR le dashboard : on retombe sur
    // « aucun grade », c'est-à-dire sur les seuls administrateurs.
    log.error({ err: error, guildId }, 'Lecture des grades impossible');
    return [];
  }
  cache.set(guildId, grades);
  return grades;
}

/**
 * Remplace les grades d'un serveur par ceux-ci.
 *
 * `known` est le vocabulaire admis (modules présents, leurs blocs, les
 * portées) : une permission hors de cette liste est SILENCIEUSEMENT écartée
 * plutôt que refusée, parce qu'elle désigne le plus souvent un module retiré de
 * cette instance — le serveur n'a pas à voir sa page échouer pour ça.
 *
 * Un grade sans permission est conservé : c'est un brouillon que le serveur est
 * en train d'écrire, et le supprimer sous ses doigts serait pire que de garder
 * une ligne qui n'ouvre rien. Un grade sans nom, en revanche, n'est pas un
 * grade — il n'y aurait rien à afficher ni à retrouver.
 */
export async function saveGrades(
  guildId: string,
  grades: GradeInput[],
  known: ReadonlySet<string>,
): Promise<Grade[]> {
  const cleaned = grades.slice(0, MAX_GRADES).flatMap((grade, index): GradeInput[] => {
    const name = grade.name.trim().slice(0, MAX_GRADE_NAME);
    if (!name) return [];
    const ids = (values: string[]): string[] =>
      [...new Set(values.filter(isSnowflake))].slice(0, MAX_IDS_PER_GRADE);
    return [
      {
        ...(grade.id ? { id: grade.id } : {}),
        name,
        roleIds: ids(grade.roleIds),
        memberIds: ids(grade.memberIds),
        permissions: [...new Set(grade.permissions)].filter((p) => known.has(p)).sort(),
        position: index,
      },
    ];
  });

  const previous = await listGrades(guildId);
  const kept = new Set(cleaned.map((grade) => grade.id).filter(Boolean));
  await db.$transaction([
    db.guild.upsert({ where: { id: guildId }, update: {}, create: { id: guildId } }),
    // Ce qui n'est pas revenu a été supprimé dans le panneau : celui-ci envoie
    // la liste entière, c'est donc la seule lecture possible de son silence.
    ...previous
      .filter((grade) => !kept.has(grade.id))
      .map((grade) => db.guildGrade.delete({ where: { id: grade.id } })),
    ...cleaned.map((grade) => {
      const data = {
        guildId,
        name: grade.name,
        roleIds: grade.roleIds.join('|'),
        memberIds: grade.memberIds.join('|'),
        permissions: grade.permissions.join('|'),
        position: grade.position,
      };
      // `upsert` et non `update` : un identifiant que la base ne connaît pas ne
      // doit pas faire échouer tout l'enregistrement — il crée un grade, ce que
      // l'admin voulait de toute façon en cliquant « Ajouter ».
      return grade.id
        ? db.guildGrade.upsert({
            where: { id: grade.id },
            update: data,
            create: { ...data, id: grade.id },
          })
        : db.guildGrade.create({ data });
    }),
  ]);

  cache.delete(guildId);
  return listGrades(guildId);
}

/** Oublie les grades mémorisés d'un serveur (purge des données, tests). */
export function forgetGuildAccess(guildId: string): void {
  cache.delete(guildId);
}

/**
 * Ce que cet acteur peut faire sur ce serveur.
 *
 * La source de vérité est le cache Discord du bot, pas le dashboard : le token
 * de l'API prouve que le site parle, jamais qu'il parle pour quelqu'un
 * d'autorisé. Un serveur que le bot ne voit pas ne délègue rien — on ne sait
 * même pas quels rôles porte l'acteur.
 */
export async function accessFor(
  ctx: BotContext,
  guildId: string,
  actorId: string | undefined,
): Promise<GuildAccess> {
  if (!actorId) return NO_ACCESS;
  const guild = ctx.client.guilds.cache.get(guildId);
  if (!guild) return NO_ACCESS;
  if (guild.ownerId === actorId) return FULL_ACCESS;

  // Il faut de toute façon le membre : pour ses rôles, et parce qu'être
  // administrateur l'emporte sur tout grade.
  const member = await guild.members.fetch(actorId).catch(() => null);
  if (!member) return NO_ACCESS;
  // `has()` tient l'administrateur pour tout-puissant : même règle qu'avant.
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return FULL_ACCESS;

  const permissions = new Set<string>();
  const held: string[] = [];
  for (const grade of await listGrades(guildId)) {
    const byMember = grade.memberIds.includes(actorId);
    const byRole = grade.roleIds.some((roleId) => member.roles.cache.has(roleId));
    if (!byMember && !byRole) continue;
    held.push(grade.name);
    for (const permission of grade.permissions) permissions.add(permission);
  }
  if (permissions.size === 0) return NO_ACCESS;
  return { level: 'staff', permissions: [...permissions].sort(), grades: held };
}
