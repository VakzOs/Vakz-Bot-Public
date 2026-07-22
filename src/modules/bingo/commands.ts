import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { ComponentHandler, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, infoEmbed } from '../../lib/embeds.js';
import { getBingoConfig } from './config.js';
import { CARD_IMAGE, renderCardImage } from './render.js';
import {
  type BingoMode,
  drawNumber,
  drawnSet,
  endGame,
  findWinners,
  getCard,
  getGame,
  joinGame,
  startGame,
} from './service.js';

function isStaff(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

async function ephemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Image du carton d'un membre (numéros tirés en rouge). */
function cardAttachment(cells: number[], drawn: ReadonlySet<number>): AttachmentBuilder {
  return new AttachmentBuilder(renderCardImage(cells, drawn), { name: CARD_IMAGE });
}

/** Bouton « Mon carton » ajouté sous chaque tirage. */
function cardButtonRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('bingo|card')
      .setLabel(t('modules.bingo.myCardButton'))
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Secondary),
  );
}

const bingo: SlashCommand = {
  data: (() => {
    const b = new SlashCommandBuilder()
      .setName('bingo')
      .setDescription(t('modules.bingo.description'));
    b.addSubcommand((s) =>
      s
        .setName('demarrer')
        .setDescription(t('modules.bingo.commands.start'))
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription(t('modules.bingo.opt.mode'))
            .addChoices(
              { name: t('modules.bingo.modeLine'), value: 'line' },
              { name: t('modules.bingo.modeFull'), value: 'full' },
            ),
        ),
    );
    b.addSubcommand((s) => s.setName('rejoindre').setDescription(t('modules.bingo.commands.join')));
    b.addSubcommand((s) => s.setName('carte').setDescription(t('modules.bingo.commands.card')));
    b.addSubcommand((s) => s.setName('tirer').setDescription(t('modules.bingo.commands.draw')));
    b.addSubcommand((s) => s.setName('terminer').setDescription(t('modules.bingo.commands.stop')));
    return b;
  })(),
  async execute(interaction, ctx) {
    if (!interaction.inGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'demarrer') {
      if (!isStaff(interaction)) return ephemeral(interaction, t('modules.bingo.staffOnly'));
      const config = await getBingoConfig(ctx, guildId);
      const mode =
        (interaction.options.getString('mode') as BingoMode | null) ?? config.defaultMode;
      await startGame(ctx, guildId, mode);
      await interaction.reply({
        embeds: [
          infoEmbed({
            title: t('modules.bingo.startedTitle'),
            description: t('modules.bingo.startedBody', {
              mode: t(mode === 'full' ? 'modules.bingo.modeFull' : 'modules.bingo.modeLine'),
            }),
          }),
        ],
      });
      return;
    }

    const game = await getGame(ctx, guildId);
    if (!game) return ephemeral(interaction, t('modules.bingo.noGame'));

    if (sub === 'rejoindre') {
      const cells = await joinGame(ctx, game, interaction.user.id);
      await interaction.reply({
        content: t('modules.bingo.joined'),
        files: [cardAttachment(cells, drawnSet(game))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'carte') {
      const cells = await getCard(ctx, game.id, interaction.user.id);
      if (!cells) return ephemeral(interaction, t('modules.bingo.noCard'));
      await interaction.reply({
        content: t('modules.bingo.yourCard'),
        files: [cardAttachment(cells, drawnSet(game))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'terminer') {
      if (!isStaff(interaction)) return ephemeral(interaction, t('modules.bingo.staffOnly'));
      await endGame(ctx, guildId);
      await interaction.reply({ content: t('modules.bingo.stopped') });
      return;
    }

    if (sub === 'tirer') {
      if (!isStaff(interaction)) return ephemeral(interaction, t('modules.bingo.staffOnly'));
      const result = await drawNumber(ctx, game);
      if (!result) return ephemeral(interaction, t('modules.bingo.allDrawn'));

      const drawnGame = { ...game, drawn: JSON.stringify([...result.drawn]) };
      const winners = await findWinners(ctx, drawnGame, result.drawn);
      const embed = new EmbedBuilder()
        .setColor(winners.length ? Colors.success : Colors.brand)
        .setTitle(t('modules.bingo.drawTitle'))
        .setDescription(
          t('modules.bingo.drawBody', { number: result.number, count: result.count }),
        );
      if (winners.length) {
        embed.addFields({
          name: t('modules.bingo.winnersField'),
          value: winners.map((winnerId) => `🎉 <@${winnerId}>`).join('\n'),
        });
        await endGame(ctx, guildId);
      }

      await interaction.reply({
        embeds: [embed],
        components: winners.length ? [] : [cardButtonRow()],
        allowedMentions: { users: winners },
      });

      // Le carton du membre qui tire s'affiche automatiquement (en privé).
      const own = await getCard(ctx, game.id, interaction.user.id);
      if (own) {
        await interaction
          .followUp({
            content: t('modules.bingo.yourCard'),
            files: [cardAttachment(own, result.drawn)],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      }
    }
  },
};

/** Bouton « Mon carton » : renvoie au membre son carton à jour (éphémère). */
export const bingoComponent: ComponentHandler = {
  prefix: 'bingo',
  async handle(interaction, ctx) {
    if (!interaction.isButton() || !interaction.inGuild()) return;
    const game = await getGame(ctx, interaction.guildId);
    if (!game) {
      await interaction
        .reply({ content: t('modules.bingo.noGame'), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }
    const cells = await getCard(ctx, game.id, interaction.user.id);
    if (!cells) {
      await interaction
        .reply({ content: t('modules.bingo.noCard'), flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
      return;
    }
    await interaction
      .reply({
        content: t('modules.bingo.yourCard'),
        files: [cardAttachment(cells, drawnSet(game))],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  },
};

export const bingoCommands: SlashCommand[] = [bingo];
