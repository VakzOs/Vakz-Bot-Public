import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type OverwriteData,
  type PermissionOverwrites,
  type Role,
} from 'discord.js';

/**
 * Une config de module ne stocke que des **identifiants** Discord (salons,
 * rôles) propres au serveur d'origine. Réimporter cette config telle quelle sur
 * un autre serveur donne des IDs morts. Ce module capture, à l'export, la
 * *structure* référencée (métadonnées des salons/rôles + permissions) et, à
 * l'import, la recrée sur le serveur cible puis remappe les IDs dans la config.
 */

/** Un snowflake Discord (17 à 20 chiffres). */
const SNOWFLAKE = /^\d{17,20}$/;

const REASON = 'Import de configuration Vakz-Bot';

/** Métadonnées d'un rôle nécessaires à sa recréation. */
export interface RoleRef {
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
}

/** Une autorisation de salon (overwrite) sérialisée. */
export interface OverwriteRef {
  id: string;
  type: OverwriteType;
  allow: string;
  deny: string;
}

/** Métadonnées d'un salon nécessaires à sa recréation. */
export interface ChannelRef {
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  topic: string | null;
  nsfw: boolean;
  rateLimitPerUser: number | null;
  bitrate: number | null;
  userLimit: number | null;
  overwrites: OverwriteRef[];
}

/** Structure référencée par les configs, capturée à l'export. */
export interface BackupReferences {
  roles: Record<string, RoleRef>;
  channels: Record<string, ChannelRef>;
}

/** Bilan de la recréation de structure à l'import. */
export interface ReferenceStats {
  rolesCreated: number;
  rolesReused: number;
  channelsCreated: number;
  channelsReused: number;
  failed: number;
}

type ChannelWithOverwrites = GuildBasedChannel & {
  permissionOverwrites: { cache: { values(): Iterable<PermissionOverwrites> } };
};

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

/** Types de salons que l'on sait recréer. */
function isRestorableChannelType(
  type: ChannelType,
): type is NonNullable<GuildChannelCreateOptions['type']> {
  return (
    type === ChannelType.GuildText ||
    type === ChannelType.GuildAnnouncement ||
    type === ChannelType.GuildVoice ||
    type === ChannelType.GuildStageVoice ||
    type === ChannelType.GuildCategory ||
    type === ChannelType.GuildForum ||
    type === ChannelType.GuildMedia
  );
}

function snapshotRole(role: Role): RoleRef {
  return {
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
  };
}

function snapshotChannel(channel: GuildBasedChannel): ChannelRef {
  const data = channel as unknown as Record<string, unknown>;
  const overwrites: OverwriteRef[] =
    'permissionOverwrites' in channel
      ? [...(channel as ChannelWithOverwrites).permissionOverwrites.cache.values()].map((ow) => ({
          id: ow.id,
          type: ow.type,
          allow: ow.allow.bitfield.toString(),
          deny: ow.deny.bitfield.toString(),
        }))
      : [];

  return {
    name: channel.name,
    type: channel.type,
    parentId: readString(data, 'parentId'),
    position: readNumber(data, 'rawPosition') ?? readNumber(data, 'position') ?? 0,
    topic: readString(data, 'topic'),
    nsfw: readBoolean(data, 'nsfw') ?? false,
    rateLimitPerUser: readNumber(data, 'rateLimitPerUser'),
    bitrate: readNumber(data, 'bitrate'),
    userLimit: readNumber(data, 'userLimit'),
    overwrites,
  };
}

/**
 * Parcourt les configs et capture toute la structure (salons/rôles) qu'elles
 * référencent — y compris les catégories parentes et les rôles cités dans les
 * permissions de salon. Les rôles gérés (bots/intégrations) et `@everyone` ne
 * sont pas capturés : ils ne se recréent pas.
 */
export function collectReferences(guild: Guild, configs: unknown[]): BackupReferences {
  const roles: Record<string, RoleRef> = {};
  const channels: Record<string, ChannelRef> = {};

  const addRole = (id: string): void => {
    if (roles[id]) return;
    const role = guild.roles.cache.get(id);
    if (!role || role.managed || role.id === guild.id) return;
    roles[id] = snapshotRole(role);
  };

  const addChannel = (id: string): void => {
    if (channels[id]) return;
    const channel = guild.channels.cache.get(id);
    if (!channel || !isRestorableChannelType(channel.type)) return;
    const ref = snapshotChannel(channel);
    channels[id] = ref;
    if (ref.parentId) addChannel(ref.parentId);
    for (const ow of ref.overwrites) {
      if (ow.type === OverwriteType.Role) addRole(ow.id);
    }
  };

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (!SNOWFLAKE.test(value)) return;
      if (guild.roles.cache.has(value)) addRole(value);
      else if (guild.channels.cache.has(value)) addChannel(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };

  for (const config of configs) visit(config);
  return { roles, channels };
}

/** Une chaîne de bits de permission valide (que des chiffres), sinon « 0 ». */
function normPermissions(value: unknown): string {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '0';
}

function normalizeRole(raw: unknown): RoleRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return null;
  return {
    name: r.name.slice(0, 100),
    color: typeof r.color === 'number' ? r.color : 0,
    hoist: r.hoist === true,
    mentionable: r.mentionable === true,
    permissions: normPermissions(r.permissions),
    position: typeof r.position === 'number' ? r.position : 0,
  };
}

function normalizeChannel(raw: unknown): ChannelRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== 'string' || c.name.length === 0) return null;
  if (typeof c.type !== 'number' || !isRestorableChannelType(c.type as ChannelType)) return null;

  const overwrites: OverwriteRef[] = [];
  if (Array.isArray(c.overwrites)) {
    for (const ow of c.overwrites) {
      if (!ow || typeof ow !== 'object') continue;
      const o = ow as Record<string, unknown>;
      if (typeof o.id !== 'string') continue;
      overwrites.push({
        id: o.id,
        type: o.type === OverwriteType.Member ? OverwriteType.Member : OverwriteType.Role,
        allow: normPermissions(o.allow),
        deny: normPermissions(o.deny),
      });
    }
  }

  return {
    name: c.name.slice(0, 100),
    type: c.type,
    parentId: typeof c.parentId === 'string' ? c.parentId : null,
    position: typeof c.position === 'number' ? c.position : 0,
    topic: typeof c.topic === 'string' ? c.topic : null,
    nsfw: c.nsfw === true,
    rateLimitPerUser: typeof c.rateLimitPerUser === 'number' ? c.rateLimitPerUser : null,
    bitrate: typeof c.bitrate === 'number' ? c.bitrate : null,
    userLimit: typeof c.userLimit === 'number' ? c.userLimit : null,
    overwrites,
  };
}

/**
 * Valide/normalise une structure de références lue depuis un fichier importé.
 * Chaque entrée mal formée est ignorée ; les bitfields sont normalisés en
 * chaînes de chiffres pour que `BigInt(...)` ne puisse jamais lever à la
 * recréation (le fichier pouvant avoir été édité à la main).
 */
export function parseReferences(value: unknown): BackupReferences | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const roles: Record<string, RoleRef> = {};
  const channels: Record<string, ChannelRef> = {};

  if (source.roles && typeof source.roles === 'object') {
    for (const [id, raw] of Object.entries(source.roles as Record<string, unknown>)) {
      const ref = normalizeRole(raw);
      if (ref) roles[id] = ref;
    }
  }
  if (source.channels && typeof source.channels === 'object') {
    for (const [id, raw] of Object.entries(source.channels as Record<string, unknown>)) {
      const ref = normalizeChannel(raw);
      if (ref) channels[id] = ref;
    }
  }
  return { roles, channels };
}

/**
 * Recrée la structure sur le serveur cible et construit la table de
 * correspondance `ancien ID → nouvel ID`.
 *
 * - Un rôle/salon **déjà présent** (même nom, même type) est réutilisé — jamais
 *   de doublon (idempotent, y compris pour une restauration sur le même serveur).
 * - Sinon, il est **créé** si `create` est vrai et si le bot a la permission.
 * - `@everyone` est mappé du serveur d'origine vers celui-ci.
 */
export async function applyReferences(
  guild: Guild,
  oldGuildId: string,
  references: BackupReferences,
  opts: { create: boolean },
): Promise<{ remap: Map<string, string>; stats: ReferenceStats }> {
  const remap = new Map<string, string>();
  const stats: ReferenceStats = {
    rolesCreated: 0,
    rolesReused: 0,
    channelsCreated: 0,
    channelsReused: 0,
    failed: 0,
  };

  // `@everyone` : son ID est celui du serveur.
  if (oldGuildId) remap.set(oldGuildId, guild.id);

  const me = guild.members.me;
  const canRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;
  const canChannels = me?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false;

  // Rôles d'abord (les salons peuvent les référencer dans leurs permissions).
  const roleEntries = Object.entries(references.roles).sort(
    (a, b) => a[1].position - b[1].position,
  );
  for (const [oldId, ref] of roleEntries) {
    const existing = guild.roles.cache.find(
      (role) => !role.managed && role.id !== guild.id && role.name === ref.name,
    );
    if (existing) {
      remap.set(oldId, existing.id);
      stats.rolesReused += 1;
      continue;
    }
    if (!opts.create || !canRoles) continue;
    const created = await guild.roles
      .create({
        name: ref.name,
        color: ref.color,
        hoist: ref.hoist,
        mentionable: ref.mentionable,
        permissions: BigInt(ref.permissions),
        reason: REASON,
      })
      .catch(() => null);
    if (created) {
      remap.set(oldId, created.id);
      stats.rolesCreated += 1;
    } else {
      stats.failed += 1;
    }
  }

  // Salons : catégories d'abord (parents), puis le reste, chacun par position.
  const byPosition = (a: [string, ChannelRef], b: [string, ChannelRef]): number =>
    a[1].position - b[1].position;
  const channelEntries = Object.entries(references.channels);
  const ordered = [
    ...channelEntries.filter(([, ref]) => ref.type === ChannelType.GuildCategory).sort(byPosition),
    ...channelEntries.filter(([, ref]) => ref.type !== ChannelType.GuildCategory).sort(byPosition),
  ];

  for (const [oldId, ref] of ordered) {
    const existing = guild.channels.cache.find(
      (channel) => channel.type === ref.type && channel.name === ref.name,
    );
    if (existing) {
      remap.set(oldId, existing.id);
      stats.channelsReused += 1;
      continue;
    }
    if (!opts.create || !canChannels) continue;

    const parent = ref.parentId ? remap.get(ref.parentId) : undefined;
    const overwrites: OverwriteData[] = [];
    for (const ow of ref.overwrites) {
      // Les permissions par membre ne se transfèrent pas d'un serveur à l'autre.
      if (ow.type === OverwriteType.Member) continue;
      const targetId = remap.get(ow.id) ?? (guild.roles.cache.has(ow.id) ? ow.id : undefined);
      if (!targetId) continue;
      overwrites.push({
        id: targetId,
        type: OverwriteType.Role,
        allow: BigInt(ow.allow),
        deny: BigInt(ow.deny),
      });
    }

    const created = await guild.channels
      .create({
        name: ref.name,
        type: ref.type as GuildChannelCreateOptions['type'],
        parent: parent ?? undefined,
        topic: ref.topic ?? undefined,
        nsfw: ref.nsfw,
        rateLimitPerUser: ref.rateLimitPerUser ?? undefined,
        bitrate: ref.bitrate ?? undefined,
        userLimit: ref.userLimit ?? undefined,
        permissionOverwrites: overwrites,
        reason: REASON,
      })
      .catch(() => null);
    if (created) {
      remap.set(oldId, created.id);
      stats.channelsCreated += 1;
    } else {
      stats.failed += 1;
    }
  }

  return { remap, stats };
}

/** Remplace récursivement dans une config tout ID présent dans la table de correspondance. */
export function remapIds(value: unknown, remap: Map<string, string>): unknown {
  if (typeof value === 'string') return remap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapIds(item, remap));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = remapIds(item, remap);
    return out;
  }
  return value;
}
