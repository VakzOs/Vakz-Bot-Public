import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../../core/module.js';
import { getRegistry } from '../../../core/loader.js';
import { renderHome } from '../../../core/config-panel.js';
import { t } from '../../../core/i18n.js';

/**
 * `/config` (admins) — ouvre le panneau de configuration interactif des modules.
 * Toute la navigation (sélection de module, activation, réglages) se fait ensuite
 * via les composants du message, routés par `core/config-panel.ts`.
 */
export const config: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription(t('modules.core.config.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const guildName = interaction.guild?.name ?? '';
    const modules = getRegistry()?.modules ?? [];
    const home = await renderHome(ctx, guildId, guildName, modules);

    await interaction.reply({ ...home, flags: MessageFlags.Ephemeral });
  },
};
