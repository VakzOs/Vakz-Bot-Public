import {
  ActionRowBuilder,
  type MessageActionRowComponentBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
} from 'discord.js';
import type { BotContext, ConfigPanel, PanelHandlerArgs, PanelRow } from '../../core/module.js';
import { panelCustomId } from '../../core/config-panel.js';
import { t } from '../../core/i18n.js';
import { infoEmbed } from '../../lib/embeds.js';
import { MODULE_NAME, getAutorolesConfig, updateAutorolesConfig } from './config.js';

function row(): PanelRow {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>();
}

async function render(ctx: BotContext, guildId: string) {
  const config = await getAutorolesConfig(ctx, guildId);
  const guild = ctx.client.guilds.cache.get(guildId);
  const me = guild?.members.me ?? null;
  const botHighest = me?.roles.highest.position ?? 0;
  const canManageRoles = me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;

  let hasUnassignable = false;
  const formatRoles = (ids: string[]): string => {
    if (ids.length === 0) return t('modules.autoroles.panel.none');
    return ids
      .map((id) => {
        const role = guild?.roles.cache.get(id);
        const assignable = canManageRoles && !!role && role.position < botHighest;
        if (!assignable) hasUnassignable = true;
        return `<@&${id}>${assignable ? '' : ' ⚠️'}`;
      })
      .join(' ');
  };

  const embed = infoEmbed({
    title: t('modules.autoroles.label'),
    description: t('modules.autoroles.panel.intro'),
  }).addFields(
    { name: t('modules.autoroles.panel.humansField'), value: formatRoles(config.roleIds) },
    { name: t('modules.autoroles.panel.botsField'), value: formatRoles(config.botRoleIds) },
    { name: t('modules.autoroles.panel.voiceField'), value: formatRoles(config.voiceRoleIds) },
  );

  if (hasUnassignable) {
    embed.addFields({ name: '⚠️', value: t('modules.autoroles.panel.roleWarning') });
  }

  const existingHumans = config.roleIds.filter((id) => guild?.roles.cache.has(id));
  const existingBots = config.botRoleIds.filter((id) => guild?.roles.cache.has(id));
  const existingVoice = config.voiceRoleIds.filter((id) => guild?.roles.cache.has(id));

  const humanSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'humans'))
    .setPlaceholder(t('modules.autoroles.panel.humansPlaceholder'))
    .setMinValues(0)
    .setMaxValues(10);
  if (existingHumans.length) humanSelect.setDefaultRoles(existingHumans);

  const botSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'bots'))
    .setPlaceholder(t('modules.autoroles.panel.botsPlaceholder'))
    .setMinValues(0)
    .setMaxValues(10);
  if (existingBots.length) botSelect.setDefaultRoles(existingBots);

  const voiceSelect = new RoleSelectMenuBuilder()
    .setCustomId(panelCustomId(MODULE_NAME, 'voice'))
    .setPlaceholder(t('modules.autoroles.panel.voicePlaceholder'))
    .setMinValues(0)
    .setMaxValues(10);
  if (existingVoice.length) voiceSelect.setDefaultRoles(existingVoice);

  return {
    embed,
    components: [
      row().addComponents(humanSelect),
      row().addComponents(botSelect),
      row().addComponents(voiceSelect),
    ],
  };
}

async function handle({
  interaction,
  ctx,
  guildId,
  action,
  renderPage,
}: PanelHandlerArgs): Promise<void> {
  if (!interaction.isRoleSelectMenu()) return;

  if (action === 'humans') {
    await updateAutorolesConfig(ctx, guildId, { roleIds: [...interaction.values] });
    await interaction.update(await renderPage());
    return;
  }
  if (action === 'bots') {
    await updateAutorolesConfig(ctx, guildId, { botRoleIds: [...interaction.values] });
    await interaction.update(await renderPage());
    return;
  }
  if (action === 'voice') {
    await updateAutorolesConfig(ctx, guildId, { voiceRoleIds: [...interaction.values] });
    await interaction.update(await renderPage());
  }
}

/** Panneau de configuration interactif du module « Rôles automatiques ». */
export const autorolesPanel: ConfigPanel = { render, handle };
