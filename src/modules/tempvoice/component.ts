import {
  ActionRowBuilder,
  ChannelType,
  type GuildMember,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  type RepliableInteraction,
  TextInputBuilder,
  TextInputStyle,
  type VoiceChannel,
} from 'discord.js';
import type { BotContext, ComponentHandler } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { MODULE_NAME } from './config.js';
import {
  applyBlacklist,
  applyWhitelist,
  buildControlMessage,
  buildMemberSelectView,
  getChannelState,
  deleteTempChannel,
  getTempRecord,
  purgeChannel,
  readState,
  savePreferenceFromChannel,
  setChannelStatus,
  setMode,
  setToggle,
  transferOwnership,
  type VoiceMode,
} from './service.js';

function reply(
  interaction: RepliableInteraction,
  key: string,
  vars?: Record<string, string | number>,
) {
  return interaction.reply({ content: t(key, vars), flags: MessageFlags.Ephemeral });
}

function isController(member: GuildMember, ownerId: string): boolean {
  return member.id === ownerId || member.permissions.has(PermissionFlagsBits.ManageChannels);
}

async function mainPage(ctx: BotContext, channel: VoiceChannel, ownerId: string) {
  return buildControlMessage(ctx, channel, ownerId);
}

function textModal(action: string, title: string, rows: ActionRowBuilder<TextInputBuilder>[]) {
  return new ModalBuilder()
    .setCustomId(`${MODULE_NAME}|${action}`)
    .setTitle(title)
    .addComponents(rows);
}

function input(
  id: string,
  label: string,
  style: TextInputStyle,
  opts: Partial<{ value: string; max: number; required: boolean; placeholder: string }> = {},
) {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (opts.value !== undefined) field.setValue(opts.value);
  if (opts.max) field.setMaxLength(opts.max);
  field.setRequired(opts.required ?? true);
  if (opts.placeholder) field.setPlaceholder(opts.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

async function applyMode(
  ctx: BotContext,
  interaction: RepliableInteraction,
  channel: VoiceChannel,
  ownerId: string,
  mode: VoiceMode,
): Promise<void> {
  if (!interaction.isButton()) return;
  await setMode(ctx, channel, ownerId, mode);
  await interaction.update(await mainPage(ctx, channel, ownerId));
}

export const tempvoiceComponent: ComponentHandler = {
  prefix: MODULE_NAME,
  async handle(interaction, ctx: BotContext) {
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
    if (!interaction.inCachedGuild()) return;
    if (interaction.channel?.type !== ChannelType.GuildVoice) return;

    const channel = interaction.channel;
    const action = interaction.customId.split('|')[1];
    const record = await getTempRecord(ctx, channel.id);
    if (!record) {
      await reply(interaction, 'modules.tempvoice.control.notTemp');
      return;
    }
    const member = interaction.member;
    const ownerId = record.ownerId;

    // « Revendiquer » : ouvert aux non-propriétaires quand le propriétaire est absent.
    if (action === 'claim') {
      if (channel.members.has(ownerId)) {
        await reply(interaction, 'modules.tempvoice.control.ownerPresent');
        return;
      }
      if (!channel.members.has(member.id)) {
        await reply(interaction, 'modules.tempvoice.control.notInChannel');
        return;
      }
      await transferOwnership(ctx, channel, member.id);
      if (interaction.isButton()) await interaction.update(await mainPage(ctx, channel, member.id));
      return;
    }

    // Toutes les autres actions exigent d'être propriétaire (ou modérateur).
    if (!isController(member, ownerId)) {
      await reply(interaction, 'modules.tempvoice.control.notOwner');
      return;
    }

    switch (action) {
      case 'open':
        return applyMode(ctx, interaction, channel, ownerId, 'open');
      case 'closed':
        return applyMode(ctx, interaction, channel, ownerId, 'closed');
      case 'private':
        return applyMode(ctx, interaction, channel, ownerId, 'private');

      case 'micro':
      case 'video':
      case 'soundboard': {
        if (!interaction.isButton()) return;
        const state = readState(channel, ownerId);
        await setToggle(ctx, channel, ownerId, action, !state[action]);
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }

      case 'wl':
      case 'bl':
      case 'transfer': {
        if (!interaction.isButton()) return;
        await interaction.update(await buildMemberSelectView(ctx, channel, ownerId, action));
        return;
      }
      case 'back': {
        if (!interaction.isButton()) return;
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }
      case 'mwl': {
        if (!interaction.isUserSelectMenu()) return;
        const current = (await getChannelState(ctx, channel, ownerId)).whitelist;
        const roles = current.filter((id) => channel.guild.roles.cache.has(id));
        await applyWhitelist(ctx, channel, ownerId, [...roles, ...interaction.values]);
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }
      case 'rwl': {
        if (!interaction.isRoleSelectMenu()) return;
        const current = (await getChannelState(ctx, channel, ownerId)).whitelist;
        const members = current.filter((id) => !channel.guild.roles.cache.has(id));
        await applyWhitelist(ctx, channel, ownerId, [...members, ...interaction.values]);
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }
      case 'mbl': {
        if (!interaction.isUserSelectMenu()) return;
        await applyBlacklist(ctx, channel, ownerId, [...interaction.values]);
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }
      case 'mtransfer': {
        if (!interaction.isUserSelectMenu()) return;
        const target = interaction.values[0];
        if (!target || !channel.members.has(target)) {
          await reply(interaction, 'modules.tempvoice.control.transferAbsent');
          return;
        }
        await transferOwnership(ctx, channel, target);
        await interaction.update(await mainPage(ctx, channel, target));
        return;
      }

      case 'purge': {
        if (!interaction.isButton()) return;
        const count = await purgeChannel(ctx, channel, ownerId);
        await reply(interaction, 'modules.tempvoice.control.purged', { count });
        return;
      }
      case 'save': {
        if (!interaction.isButton()) return;
        await savePreferenceFromChannel(ctx, channel.guild.id, ownerId, channel);
        await reply(interaction, 'modules.tempvoice.control.saved');
        return;
      }
      case 'delete': {
        if (!interaction.isButton()) return;
        await reply(interaction, 'modules.tempvoice.control.deleting');
        await deleteTempChannel(ctx, channel);
        return;
      }

      case 'status': {
        if (!interaction.isButton()) return;
        await interaction.showModal(
          textModal('statusmodal', t('modules.tempvoice.control.statusTitle'), [
            input('status', t('modules.tempvoice.control.statusField'), TextInputStyle.Short, {
              max: 500,
              required: false,
              placeholder: t('modules.tempvoice.control.statusPlaceholder'),
            }),
          ]),
        );
        return;
      }
      case 'statusmodal': {
        if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
        await setChannelStatus(ctx, channel, interaction.fields.getTextInputValue('status').trim());
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }
      case 'settings': {
        if (!interaction.isButton()) return;
        await interaction.showModal(
          textModal('settingsmodal', t('modules.tempvoice.control.settingsTitle'), [
            input('name', t('modules.tempvoice.control.nameField'), TextInputStyle.Short, {
              value: channel.name,
              max: 100,
            }),
            input('limit', t('modules.tempvoice.control.limitField'), TextInputStyle.Short, {
              value: String(channel.userLimit),
              max: 2,
              placeholder: '0-99',
            }),
          ]),
        );
        return;
      }
      case 'settingsmodal': {
        if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return;
        const name = interaction.fields.getTextInputValue('name').trim().slice(0, 100);
        const raw = Number(interaction.fields.getTextInputValue('limit'));
        const limit = Number.isInteger(raw) ? Math.min(99, Math.max(0, raw)) : 0;
        if (name) await channel.setName(name).catch(() => undefined);
        await channel.setUserLimit(limit).catch(() => undefined);
        await interaction.update(await mainPage(ctx, channel, ownerId));
        return;
      }
      default:
        return;
    }
  },
};
