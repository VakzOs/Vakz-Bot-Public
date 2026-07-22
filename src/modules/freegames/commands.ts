import { SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { ALL_PLATFORMS } from './config.js';
import { buildFreeGameEmbed, fetchFreeGames } from './service.js';

/** `/jeuxgratuits` — affiche les jeux actuellement gratuits (toutes plateformes). */
export const jeuxgratuits: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('jeuxgratuits')
    .setDescription(t('modules.freegames.command.description')),
  async execute(interaction) {
    await interaction.deferReply();
    const games = await fetchFreeGames(ALL_PLATFORMS);
    if (games.length === 0) {
      await interaction.editReply({ content: t('modules.freegames.command.none') });
      return;
    }
    await interaction.editReply({
      content: t('modules.freegames.command.title', { count: games.length }),
      embeds: games.slice(0, 8).map(buildFreeGameEmbed),
    });
  },
};

export const freegamesCommands: SlashCommand[] = [jeuxgratuits];
