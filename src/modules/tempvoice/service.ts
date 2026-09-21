import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Collection,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  type OverwriteResolvable,
  OverwriteType,
  PermissionFlagsBits,
  type PermissionOverwrites,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  type VoiceChannel,
} from 'discord.js';
import type { BotContext, PanelRow } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors } from '../../lib/embeds.js';
import { MODULE_NAME, getTempvoiceConfig, type TempVoiceHub } from './config.js';

/** Permissions accordées au propriétaire sur son salon temporaire. */
const OWNER_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.UseSoundboard,
  PermissionFlagsBits.UseExternalSounds,
];

/**
 * Permissions garanties au bot sur chaque salon temporaire. Sans `ManageRoles`
 * le bot ne peut pas éditer les overwrites (mode/micro restent sans effet) et
 * sans `MuteMembers` il ne peut pas couper le micro des membres déjà connectés.
 */
const BOT_ALLOW =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.Stream |
  PermissionFlagsBits.UseSoundboard |
  PermissionFlagsBits.UseExternalSounds;

/** Verrou anti-doublon : évite de créer deux salons pour un même membre lors
 * d'événements vocaux concurrents/dupliqués. */
const provisioning = new Set<string>();

export type VoiceMode = 'open' | 'closed' | 'private';

export interface ChannelState {
  mode: VoiceMode;
  micro: boolean;
  video: boolean;
  soundboard: boolean;
  whitelist: string[];
  blacklist: string[];
  name: string;
  userLimit: number;
}

interface SavedPreference {
  name: string | null;
  userLimit: number;
  mode: VoiceMode;
  micro: boolean;
  video: boolean;
  soundboard: boolean;
  whitelist: string[];
  blacklist: string[];
}

function cid(action: string, ...params: string[]): string {
  return [MODULE_NAME, action, ...params].join('|');
}

/** Applique le gabarit de nom (`{user}`, `{username}`) borné à 100 caractères. */
export function nameFor(template: string, member: GuildMember): string {
  const name = template
    .replaceAll('{user}', member.displayName)
    .replaceAll('{username}', member.user.username);
  return (name.trim() || member.displayName).slice(0, 100);
}

function everyoneOverwrite(channel: VoiceChannel): PermissionOverwrites | undefined {
  return channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
}

function isDenied(channel: VoiceChannel, flag: bigint): boolean {
  return everyoneOverwrite(channel)?.deny.has(flag) ?? false;
}

export function getMode(channel: VoiceChannel): VoiceMode {
  if (isDenied(channel, PermissionFlagsBits.ViewChannel)) return 'private';
  if (isDenied(channel, PermissionFlagsBits.Connect)) return 'closed';
  return 'open';
}

interface RuntimeChannelState {
  mode?: VoiceMode;
  whitelist: string[];
  blacklist: string[];
}

function uniqueIds(ids: string[], max = 50): string[] {
  return [...new Set(ids.filter((id) => /^\d{5,25}$/.test(id)))].slice(0, max);
}

function overwriteTypeFor(guild: Guild, id: string): OverwriteType {
  return guild.roles.cache.has(id) ? OverwriteType.Role : OverwriteType.Member;
}

/** Exceptions explicites du salon (hors proprietaire/bot/@everyone). */
function accessOverwrites(channel: VoiceChannel, ownerId: string): PermissionOverwrites[] {
  const botId = channel.client.user.id;
  const everyoneId = channel.guild.roles.everyone.id;
  return [...channel.permissionOverwrites.cache.values()].filter(
    (o) => o.id !== ownerId && o.id !== botId && o.id !== everyoneId,
  );
}

export function readWhitelist(channel: VoiceChannel, ownerId: string): string[] {
  return accessOverwrites(channel, ownerId)
    .filter(
      (o) =>
        o.allow.has(PermissionFlagsBits.Connect) && o.allow.has(PermissionFlagsBits.ViewChannel),
    )
    .map((o) => o.id);
}

export function readBlacklist(channel: VoiceChannel, ownerId: string): string[] {
  return accessOverwrites(channel, ownerId)
    .filter((o) => o.type === OverwriteType.Member && o.deny.has(PermissionFlagsBits.Connect))
    .map((o) => o.id);
}

export function readState(
  channel: VoiceChannel,
  ownerId: string,
  runtime?: Partial<RuntimeChannelState>,
): ChannelState {
  return {
    mode: runtime?.mode ?? getMode(channel),
    micro: !isDenied(channel, PermissionFlagsBits.Speak),
    video: !isDenied(channel, PermissionFlagsBits.Stream),
    soundboard: !isDenied(channel, PermissionFlagsBits.UseSoundboard),
    whitelist: runtime?.whitelist ?? readWhitelist(channel, ownerId),
    blacklist: runtime?.blacklist ?? readBlacklist(channel, ownerId),
    name: channel.name,
    userLimit: channel.userLimit,
  };
}

function isVoiceMode(value: unknown): value is VoiceMode {
  return value === 'open' || value === 'closed' || value === 'private';
}

function parseRuntimeState(data: string | null | undefined): RuntimeChannelState {
  if (!data) return { whitelist: [], blacklist: [] };
  try {
    const parsed = JSON.parse(data) as Partial<RuntimeChannelState>;
    return {
      mode: isVoiceMode(parsed.mode) ? parsed.mode : undefined,
      whitelist: uniqueIds(Array.isArray(parsed.whitelist) ? parsed.whitelist : []),
      blacklist: uniqueIds(Array.isArray(parsed.blacklist) ? parsed.blacklist : []),
    };
  } catch {
    return { whitelist: [], blacklist: [] };
  }
}
async function getRuntimeState(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
): Promise<RuntimeChannelState> {
  const record = await getTempRecord(ctx, channel.id);
  const raw = (record as { stateData?: string | null } | null)?.stateData;
  if (raw && raw !== '{}') return parseRuntimeState(raw);
  return {
    whitelist: uniqueIds(readWhitelist(channel, ownerId)),
    blacklist: uniqueIds(readBlacklist(channel, ownerId)),
  };
}

async function saveRuntimeState(
  ctx: BotContext,
  channelId: string,
  state: RuntimeChannelState,
): Promise<void> {
  await ctx.db.tempVoiceChannel
    .update({ where: { id: channelId }, data: { stateData: JSON.stringify(state) } })
    .catch(() => undefined);
}

export async function getChannelState(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
): Promise<ChannelState> {
  return readState(channel, ownerId, await getRuntimeState(ctx, channel, ownerId));
}

// --- Mutations d'etat -------------------------------------------------------

async function hubInheritedOverwrites(
  ctx: BotContext,
  channel: VoiceChannel,
): Promise<Collection<string, PermissionOverwrites> | null> {
  const record = await getTempRecord(ctx, channel.id);
  if (!record) return null;
  const config = await getTempvoiceConfig(ctx, channel.guild.id);
  const hub = config.hubs.find((item) => item.channelId === record.hubChannelId);
  if (!hub?.inheritPermissions) return null;

  const hubChannel =
    channel.guild.channels.cache.get(record.hubChannelId) ??
    (await channel.guild.channels.fetch(record.hubChannelId).catch(() => null));
  if (!hubChannel || !('permissionOverwrites' in hubChannel)) return null;
  return hubChannel.permissionOverwrites.cache;
}

async function rebuildAccessOverwrites(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
  patch: Partial<
    Pick<ChannelState, 'mode' | 'micro' | 'video' | 'soundboard' | 'whitelist' | 'blacklist'>
  > = {},
): Promise<void> {
  const current = await getChannelState(ctx, channel, ownerId);
  const next: ChannelState = { ...current, ...patch };
  const runtime = {
    mode: next.mode,
    whitelist: uniqueIds(next.whitelist.filter((id) => id !== ownerId)),
    blacklist: uniqueIds(
      next.blacklist.filter((id) => id !== ownerId && !next.whitelist.includes(id)),
    ),
  };
  next.whitelist = runtime.whitelist;
  next.blacklist = runtime.blacklist;

  const ownOverwrites = stateToOverwrites(channel.guild, ownerId, next);
  const botId = channel.guild.members.me?.id ?? ctx.client.user?.id;
  const inherited = await hubInheritedOverwrites(ctx, channel);
  const permissionOverwrites =
    inherited && botId
      ? mergeHubOverwrites(inherited, ownOverwrites, botId, channel.guild.roles.everyone.id)
      : ownOverwrites;

  await channel.permissionOverwrites.set(permissionOverwrites).catch(() => undefined);
  await saveRuntimeState(ctx, channel.id, runtime);
}

export async function setMode(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
  mode: VoiceMode,
): Promise<void> {
  await rebuildAccessOverwrites(ctx, channel, ownerId, { mode });
}
async function applyLiveMicroMute(
  channel: VoiceChannel,
  ownerId: string,
  runtime: RuntimeChannelState,
  muted: boolean,
): Promise<void> {
  const whitelistRoles = runtime.whitelist.filter((id) => channel.guild.roles.cache.has(id));
  for (const member of channel.members.values()) {
    const isWhitelisted =
      runtime.whitelist.includes(member.id) ||
      whitelistRoles.some((id) => member.roles.cache.has(id));
    if (member.id === ownerId || isWhitelisted) continue;
    if (member.voice.serverMute !== muted) {
      await member.voice.setMute(muted, 'Controle salon vocal temporaire').catch(() => undefined);
    }
  }
}

export async function setToggle(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
  kind: 'micro' | 'video' | 'soundboard',
  allowed: boolean,
): Promise<void> {
  await rebuildAccessOverwrites(ctx, channel, ownerId, { [kind]: allowed });
  if (kind === 'micro') {
    const runtime = await getRuntimeState(ctx, channel, ownerId);
    await applyLiveMicroMute(channel, ownerId, runtime, !allowed);
  }
}

/** Aligne la liste blanche : membres ou roles autorises selon le mode du salon. */
export async function applyWhitelist(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
  ids: string[],
): Promise<void> {
  const current = await getRuntimeState(ctx, channel, ownerId);
  const whitelist = uniqueIds(ids.filter((id) => id !== ownerId));
  await rebuildAccessOverwrites(ctx, channel, ownerId, {
    whitelist,
    blacklist: current.blacklist.filter((id) => !whitelist.includes(id)),
  });
}

/** Aligne la liste noire : bloque les selectionnes (et deconnecte), libere les autres. */
export async function applyBlacklist(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
  ids: string[],
): Promise<void> {
  const current = await getRuntimeState(ctx, channel, ownerId);
  const blacklist = uniqueIds(ids.filter((id) => id !== ownerId));
  await rebuildAccessOverwrites(ctx, channel, ownerId, {
    whitelist: current.whitelist.filter((id) => !blacklist.includes(id)),
    blacklist,
  });
  for (const id of blacklist) {
    const member = channel.members.get(id);
    if (member) await member.voice.disconnect().catch(() => undefined);
  }
}

/** Deconnecte tout le monde sauf le proprietaire et la liste blanche. */
export async function purgeChannel(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
): Promise<number> {
  const runtime = await getRuntimeState(ctx, channel, ownerId);
  const whitelistRoles = runtime.whitelist.filter((id) => channel.guild.roles.cache.has(id));
  let count = 0;
  for (const member of channel.members.values()) {
    const isWhitelisted =
      runtime.whitelist.includes(member.id) ||
      whitelistRoles.some((id) => member.roles.cache.has(id));
    if (member.id === ownerId || isWhitelisted) continue;
    await member.voice.disconnect().catch(() => undefined);
    count += 1;
  }
  return count;
}
export async function setChannelStatus(
  ctx: BotContext,
  channel: VoiceChannel,
  status: string,
): Promise<void> {
  await ctx.client.rest
    .put(`/channels/${channel.id}/voice-status`, { body: { status: status.slice(0, 500) } })
    .catch(() => undefined);
}

// --- Préférences ------------------------------------------------------------

export async function loadPreference(
  ctx: BotContext,
  guildId: string,
  userId: string,
): Promise<SavedPreference | null> {
  const row = await ctx.db.tempVoicePreference.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.data) as SavedPreference;
  } catch {
    return null;
  }
}

export async function savePreferenceFromChannel(
  ctx: BotContext,
  guildId: string,
  userId: string,
  channel: VoiceChannel,
): Promise<void> {
  const state = await getChannelState(ctx, channel, userId);
  const pref: SavedPreference = {
    name: channel.name,
    userLimit: state.userLimit,
    mode: state.mode,
    micro: state.micro,
    video: state.video,
    soundboard: state.soundboard,
    whitelist: state.whitelist,
    blacklist: state.blacklist,
  };
  const data = JSON.stringify(pref);
  await ctx.db.tempVoicePreference.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, data },
    update: { data },
  });
}

// --- Embed & composants -----------------------------------------------------

const d = (key: string): string => t('modules.tempvoice.control.' + key);

function listValue(channel: VoiceChannel, ids: string[]): string {
  if (!ids.length) return `\`${t('modules.tempvoice.control.none')}\``;
  return ids.map((id) => (channel.guild.roles.cache.has(id) ? `<@&${id}>` : `<@${id}>`)).join(', ');
}

/** Embed « Configuration du salon » : legende descriptive facon DraftBot. */
export function buildControlEmbed(
  channel: VoiceChannel,
  ownerId: string,
  providedState?: ChannelState,
): EmbedBuilder {
  const state = providedState ?? readState(channel, ownerId);
  const owner = channel.guild.members.cache.get(ownerId);
  const iconURL = owner?.displayAvatarURL({ size: 64 });
  const embed = new EmbedBuilder()
    .setColor(Colors.brand)
    .setDescription(d('intro'))
    .addFields(
      { name: d('open'), value: d('desc_open'), inline: true },
      { name: d('closed'), value: d('desc_closed'), inline: true },
      { name: d('private'), value: d('desc_private'), inline: true },
      {
        name: d('whitelistBtn'),
        value: `${d('desc_whitelist')}\n\n${listValue(channel, state.whitelist)}`,
        inline: true,
      },
      {
        name: d('blacklistBtn'),
        value: `${d('desc_blacklist')}\n\n${listValue(channel, state.blacklist)}`,
        inline: true,
      },
      { name: d('purge'), value: d('desc_purge'), inline: false },
      { name: d('transfer'), value: d('desc_transfer'), inline: false },
      { name: d('settings'), value: d('desc_settings'), inline: false },
    );

  embed.setAuthor(iconURL ? { name: d('title'), iconURL } : { name: d('title') });
  embed.setFooter(iconURL ? { text: d('tip'), iconURL } : { text: d('tip') });
  return embed;
}
function btn(
  action: string,
  label: string,
  style: ButtonStyle,
  ...params: string[]
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(cid(action, ...params))
    .setLabel(label)
    .setStyle(style);
}

/** Panneau de contrôle complet (mode actif mis en évidence). */
/** Panneau de controle complet (mode actif mis en evidence). */
export function buildControlComponents(
  channel: VoiceChannel,
  ownerId: string,
  providedState?: ChannelState,
): PanelRow[] {
  const state = providedState ?? readState(channel, ownerId);
  const active = (mode: VoiceMode) =>
    state.mode === mode ? ButtonStyle.Success : ButtonStyle.Secondary;
  const toggle = (on: boolean) => (on ? ButtonStyle.Success : ButtonStyle.Secondary);
  const make = () => new ActionRowBuilder<MessageActionRowComponentBuilder>();

  return [
    make().addComponents(
      btn('open', t('modules.tempvoice.control.open'), active('open')),
      btn('closed', t('modules.tempvoice.control.closed'), active('closed')),
      btn('private', t('modules.tempvoice.control.private'), active('private')),
    ),
    make().addComponents(
      btn('wl', t('modules.tempvoice.control.whitelistBtn'), ButtonStyle.Primary),
      btn('bl', t('modules.tempvoice.control.blacklistBtn'), ButtonStyle.Primary),
      btn('purge', t('modules.tempvoice.control.purge'), ButtonStyle.Secondary),
    ),
    make().addComponents(
      btn('micro', t('modules.tempvoice.control.micro'), toggle(state.micro)),
      btn('video', t('modules.tempvoice.control.video'), toggle(state.video)),
      btn('soundboard', t('modules.tempvoice.control.soundboard'), toggle(state.soundboard)),
    ),
    make().addComponents(
      btn('status', t('modules.tempvoice.control.status'), ButtonStyle.Secondary),
    ),
    make().addComponents(
      btn('transfer', t('modules.tempvoice.control.transfer'), ButtonStyle.Secondary),
      btn('settings', t('modules.tempvoice.control.settings'), ButtonStyle.Primary),
      btn('save', t('modules.tempvoice.control.save'), ButtonStyle.Success),
    ),
  ];
}

export async function buildControlMessage(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
): Promise<{
  content: string;
  embeds: EmbedBuilder[];
  components: PanelRow[];
  allowedMentions: { users: string[] };
}> {
  const state = await getChannelState(ctx, channel, ownerId);
  return {
    content: t('modules.tempvoice.control.ownerLine', { owner: `<@${ownerId}>` }),
    embeds: [buildControlEmbed(channel, ownerId, state)],
    components: buildControlComponents(channel, ownerId, state),
    allowedMentions: { users: [ownerId] },
  };
}

/** Vue de selection de membres/roles (liste blanche / noire / transfert). */
export async function buildMemberSelectView(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
  kind: 'wl' | 'bl' | 'transfer',
): Promise<{
  content: string;
  embeds: EmbedBuilder[];
  components: PanelRow[];
  allowedMentions: { users: string[] };
}> {
  const state = await getChannelState(ctx, channel, ownerId);
  const embed = buildControlEmbed(channel, ownerId, state);
  const single = kind === 'transfer';
  const select = new UserSelectMenuBuilder()
    .setCustomId(cid(kind === 'transfer' ? 'mtransfer' : kind === 'wl' ? 'mwl' : 'mbl'))
    .setPlaceholder(t(`modules.tempvoice.control.${kind}Placeholder`))
    .setMinValues(single ? 1 : 0)
    .setMaxValues(single ? 1 : 25);

  if (kind === 'wl') {
    const members = state.whitelist.filter((id) => !channel.guild.roles.cache.has(id));
    if (members.length) select.setDefaultUsers(members.slice(0, 25));
  } else if (kind === 'bl' && state.blacklist.length) {
    select.setDefaultUsers(state.blacklist.slice(0, 25));
  }

  const components: PanelRow[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
  ];

  if (kind === 'wl') {
    const roles = state.whitelist.filter((id) => channel.guild.roles.cache.has(id));
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(cid('rwl'))
      .setPlaceholder(t('modules.tempvoice.control.wlRolePlaceholder'))
      .setMinValues(0)
      .setMaxValues(25);
    if (roles.length) roleSelect.setDefaultRoles(roles.slice(0, 25));
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(roleSelect),
    );
  }

  components.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      btn('back', t('modules.tempvoice.control.back'), ButtonStyle.Secondary),
    ),
  );

  return {
    content: t('modules.tempvoice.control.ownerLine', { owner: `<@${ownerId}>` }),
    embeds: [embed],
    components,
    allowedMentions: { users: [ownerId] },
  };
}
// --- Enregistrements & cycle de vie -----------------------------------------

export async function getTempRecord(ctx: BotContext, channelId: string) {
  return ctx.db.tempVoiceChannel.findUnique({ where: { id: channelId } });
}

function stateToOverwrites(
  guild: Guild,
  ownerId: string,
  state: Pick<ChannelState, 'mode' | 'micro' | 'video' | 'soundboard' | 'whitelist' | 'blacklist'>,
): OverwriteResolvable[] {
  const everyoneDeny: bigint[] = [];
  if (state.mode !== 'open') everyoneDeny.push(PermissionFlagsBits.Connect);
  if (state.mode === 'private') everyoneDeny.push(PermissionFlagsBits.ViewChannel);
  if (!state.micro) everyoneDeny.push(PermissionFlagsBits.Speak);
  if (!state.video) everyoneDeny.push(PermissionFlagsBits.Stream);
  if (!state.soundboard) {
    everyoneDeny.push(PermissionFlagsBits.UseSoundboard, PermissionFlagsBits.UseExternalSounds);
  }

  const overwrites: OverwriteResolvable[] = [
    { id: ownerId, type: OverwriteType.Member, allow: OWNER_ALLOW },
  ];
  const botId = guild.members.me?.id;
  if (botId && botId !== ownerId) {
    overwrites.push({ id: botId, type: OverwriteType.Member, allow: BOT_ALLOW });
  }
  if (everyoneDeny.length) {
    overwrites.unshift({
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: everyoneDeny,
    });
  }
  for (const id of state.whitelist) {
    if (id === ownerId) continue;
    overwrites.push({
      id,
      type: overwriteTypeFor(guild, id),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.UseSoundboard,
        PermissionFlagsBits.UseExternalSounds,
      ],
    });
  }
  for (const id of state.blacklist) {
    if (id === ownerId || state.whitelist.includes(id)) continue;
    overwrites.push({
      id,
      type: overwriteTypeFor(guild, id),
      deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    });
  }
  return overwrites;
}

/** Réduit une valeur `allow`/`deny` (flag unique ou tableau) en bitfield. */
function toBitfield(flags: OverwriteResolvable['allow']): bigint {
  if (flags === undefined || flags === null) return 0n;
  const list = Array.isArray(flags) ? flags : [flags];
  return list.reduce<bigint>((acc, flag) => acc | BigInt(flag as bigint), 0n);
}

/**
 * Fusionne les permissions du salon générateur (héritées) avec celles propres
 * au salon temporaire (propriétaire, mode, listes). Les overwrites du salon
 * temporaire priment case par case (un `allow` explicite écrase un `deny`
 * hérité, et inversement). Garantit aussi l'accès du bot pour publier le
 * panneau même si le hub masque le salon à `@everyone`.
 */
export function mergeHubOverwrites(
  hubOverwrites: Collection<string, PermissionOverwrites>,
  ownOverwrites: OverwriteResolvable[],
  botId: string,
  everyoneId: string,
): OverwriteResolvable[] {
  const merged = new Map<string, { type: OverwriteType; allow: bigint; deny: bigint }>();

  for (const po of hubOverwrites.values()) {
    merged.set(po.id, { type: po.type, allow: po.allow.bitfield, deny: po.deny.bitfield });
  }

  const apply = (id: string, type: OverwriteType, allow: bigint, deny: bigint): void => {
    const current = merged.get(id) ?? { type, allow: 0n, deny: 0n };
    merged.set(id, {
      type,
      allow: (current.allow & ~deny) | allow,
      deny: (current.deny & ~allow) | deny,
    });
  };

  for (const ow of ownOverwrites) {
    apply(
      String(ow.id),
      ow.type ?? OverwriteType.Member,
      toBitfield(ow.allow),
      toBitfield(ow.deny),
    );
  }

  const ownIds = new Set(ownOverwrites.map((ow) => String(ow.id)));
  const ownEveryone = ownOverwrites.find((ow) => String(ow.id) === everyoneId);
  const ownEveryoneDeny = toBitfield(ownEveryone?.deny);
  const denyView = (ownEveryoneDeny & PermissionFlagsBits.ViewChannel) !== 0n;

  const restrictedFlags = [
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream,
    PermissionFlagsBits.UseSoundboard,
    PermissionFlagsBits.UseExternalSounds,
  ];
  if (denyView) restrictedFlags.push(PermissionFlagsBits.ViewChannel);

  for (const [id, overwrite] of merged.entries()) {
    if (ownIds.has(id) || id === everyoneId || id === botId) continue;
    for (const flag of restrictedFlags) {
      if ((ownEveryoneDeny & flag) === 0n) continue;
      overwrite.allow &= ~flag;
      overwrite.deny |= flag;
    }
    if (denyView) {
      overwrite.allow &= ~PermissionFlagsBits.Connect;
      overwrite.deny |= PermissionFlagsBits.Connect;
    }
  }
  // Le bot garde de quoi voir/gerer le salon, editer les permissions, mute et
  // poster le panneau meme si le hub restreint l'acces a @everyone.
  apply(botId, OverwriteType.Member, BOT_ALLOW, 0n);
  return [...merged.entries()]
    .filter(([, o]) => o.allow !== 0n || o.deny !== 0n)
    .map(([id, o]) => ({ id, type: o.type, allow: o.allow, deny: o.deny }));
}
/**
 * Crée un salon vocal temporaire pour `member`, l'y déplace et publie le
 * panneau si demandé. Applique les préférences enregistrées du membre, sinon
 * les réglages du hub. Renvoie le salon ou `null` en cas d'échec.
 */
export async function createTempChannel(
  ctx: BotContext,
  member: GuildMember,
  hub: TempVoiceHub,
  showPanel: boolean,
): Promise<VoiceChannel | null> {
  const guild = member.guild;
  const lockKey = `${guild.id}:${member.id}`;
  if (provisioning.has(lockKey)) return null;
  provisioning.add(lockKey);
  try {
    const pref = await loadPreference(ctx, guild.id, member.id);
    const mode: VoiceMode = pref?.mode ?? (hub.lockedByDefault ? 'closed' : 'open');
    const state = {
      mode,
      micro: pref?.micro ?? true,
      video: pref?.video ?? true,
      soundboard: pref?.soundboard ?? true,
      whitelist: pref?.whitelist ?? [],
      blacklist: pref?.blacklist ?? [],
    };
    const parentId = hub.categoryId ?? member.voice.channel?.parentId ?? null;
    const name = pref?.name?.trim() || nameFor(hub.nameTemplate, member);
    const userLimit = pref?.userLimit ?? hub.userLimit;
    const bitrate = hub.bitrate ? Math.min(hub.bitrate * 1000, guild.maximumBitrate) : undefined;

    // Permissions propres au salon temporaire, éventuellement fusionnées avec
    // celles du salon générateur pour hériter de ses restrictions d'accès.
    let permissionOverwrites = stateToOverwrites(guild, member.id, state);
    const hubChannel = guild.channels.cache.get(hub.channelId);
    const botId = guild.members.me?.id ?? ctx.client.user?.id;
    if (hub.inheritPermissions && botId && hubChannel && 'permissionOverwrites' in hubChannel) {
      permissionOverwrites = mergeHubOverwrites(
        hubChannel.permissionOverwrites.cache,
        permissionOverwrites,
        botId,
        guild.roles.everyone.id,
      );
    }

    const channel = await guild.channels
      .create({
        name,
        type: ChannelType.GuildVoice,
        parent: parentId ?? undefined,
        userLimit: userLimit || undefined,
        bitrate,
        permissionOverwrites,
        reason: t('modules.tempvoice.createReason', { user: member.user.tag }),
      })
      .catch((error: unknown) => {
        ctx.logger.warn(
          { err: error, guildId: guild.id, module: MODULE_NAME },
          'temp channel create failed',
        );
        return null;
      });
    if (!channel) return null;

    const moved = await member.voice.setChannel(channel).catch(() => false);
    if (moved === false) {
      await channel.delete().catch(() => undefined);
      return null;
    }

    await ctx.db.tempVoiceChannel.create({
      data: {
        id: channel.id,
        guildId: guild.id,
        hubChannelId: hub.channelId,
        ownerId: member.id,
        stateData: JSON.stringify({
          mode: state.mode,
          whitelist: state.whitelist,
          blacklist: state.blacklist,
        }),
      },
    });

    if (showPanel) await postPanel(ctx, channel, member.id);
    return channel;
  } finally {
    provisioning.delete(lockKey);
  }
}

/** (Re)publie le panneau de contrôle et mémorise son message. */
export async function postPanel(
  ctx: BotContext,
  channel: VoiceChannel,
  ownerId: string,
): Promise<void> {
  const message = await channel
    .send(await buildControlMessage(ctx, channel, ownerId))
    .catch(() => null);
  if (!message) return;
  await ctx.db.tempVoiceChannel
    .update({ where: { id: channel.id }, data: { panelMessageId: message.id } })
    .catch(() => undefined);
}

/** Rafraîchit le message du panneau existant (au changement d'état/proprio). */
export async function refreshPanel(ctx: BotContext, channel: VoiceChannel): Promise<void> {
  const record = await getTempRecord(ctx, channel.id);
  if (!record?.panelMessageId) return;
  const message = await channel.messages.fetch(record.panelMessageId).catch(() => null);
  await message
    ?.edit(await buildControlMessage(ctx, channel, record.ownerId))
    .catch(() => undefined);
}

/** Transfère la propriété : met à jour la base et accorde les droits au nouveau proprio. */
export async function transferOwnership(
  ctx: BotContext,
  channel: VoiceChannel,
  newOwnerId: string,
): Promise<void> {
  await ctx.db.tempVoiceChannel
    .update({ where: { id: channel.id }, data: { ownerId: newOwnerId } })
    .catch(() => undefined);
  await rebuildAccessOverwrites(ctx, channel, newOwnerId);
}
export async function deleteTempChannel(ctx: BotContext, channel: VoiceChannel): Promise<void> {
  await channel.delete().catch(() => undefined);
  await ctx.db.tempVoiceChannel.delete({ where: { id: channel.id } }).catch(() => undefined);
}

/**
 * Réagit au départ d'un membre d'un salon temporaire : suppression si vide,
 * sinon auto-transfert de la propriété si c'est le propriétaire qui est parti.
 */
export async function handleVoiceLeave(
  ctx: BotContext,
  guild: Guild,
  channelId: string,
  leaverId: string,
): Promise<void> {
  const record = await getTempRecord(ctx, channelId);
  if (!record) return;

  // Le mute serveur est global : si le membre avait été coupé par le panneau du
  // salon, on lève ce mute en le quittant pour ne pas le laisser muet ailleurs.
  const leaver = guild.members.cache.get(leaverId);
  if (leaver?.voice.channelId && leaver.voice.serverMute && leaver.voice.channelId !== channelId) {
    await leaver.voice
      .setMute(false, t('modules.tempvoice.createReason', { user: leaver.user.tag }))
      .catch(() => undefined);
  }

  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await ctx.db.tempVoiceChannel.delete({ where: { id: channelId } }).catch(() => undefined);
    return;
  }

  const humans = channel.members.filter((member) => !member.user.bot);
  if (humans.size === 0) {
    await deleteTempChannel(ctx, channel);
    return;
  }

  // Le propriétaire est parti mais le salon vit encore → on transfère au suivant.
  if (leaverId === record.ownerId && !channel.members.has(record.ownerId)) {
    const next = humans.first();
    if (next) {
      await transferOwnership(ctx, channel, next.id);
      await refreshPanel(ctx, channel);
      await channel
        .send({
          content: t('modules.tempvoice.autoTransfer', { user: `<@${next.id}>` }),
          allowedMentions: { users: [next.id] },
        })
        .catch(() => undefined);
    }
  }
}

/** Nettoie les salons temporaires orphelins (vides ou disparus). */
export async function cleanupOrphans(ctx: BotContext): Promise<void> {
  const records = await ctx.db.tempVoiceChannel.findMany();
  for (const record of records) {
    const guild = ctx.client.guilds.cache.get(record.guildId);
    if (!guild) continue;
    const channel =
      guild.channels.cache.get(record.id) ??
      (await guild.channels.fetch(record.id).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await ctx.db.tempVoiceChannel.delete({ where: { id: record.id } }).catch(() => undefined);
      continue;
    }
    if (channel.members.size === 0) await deleteTempChannel(ctx, channel);
  }
}
