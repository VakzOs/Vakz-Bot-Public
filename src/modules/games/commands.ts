import { randomInt } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { Colors, infoEmbed } from '../../lib/embeds.js';
import {
  PFC_EMOJI,
  type PfcChoice,
  botPfcChoice,
  getStats,
  pfcOutcome,
  recordResult,
  rollDie,
} from './service.js';
import { createDuel } from './duel.js';
import { BOT, buildTttEmbed, createGame, renderBoard } from './morpion.js';
import {
  BOARD_IMAGE,
  buildBnEmbed,
  buildFireRow,
  createBnGame,
  renderBoardImage,
} from './bataillenavale.js';

/** Choisit un élément au hasard (aléa non biaisé). */
function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)] as T;
}

/** `/boule8` — la boule magique répond à une question. */
export const boule8: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('boule8')
    .setDescription(t('modules.games.boule8.description'))
    .addStringOption((o) =>
      o
        .setName('question')
        .setDescription(t('modules.games.opt.question'))
        .setRequired(true)
        .setMaxLength(256),
    ),
  async execute(interaction) {
    const question = interaction.options.getString('question', true);
    const answers = t('modules.games.boule8.answers').split('|');
    const embed = infoEmbed({ title: t('modules.games.boule8.title') }).addFields(
      { name: t('modules.games.boule8.questionField'), value: question.slice(0, 1024) },
      { name: t('modules.games.boule8.answerField'), value: `🎱 ${pick(answers)}` },
    );
    await interaction.reply({ embeds: [embed] });
  },
};

/** Faces des dés proposés en commandes dédiées (`/d4`, `/d6`, …). */
const DICE_FACES = [4, 6, 8, 10, 12, 20, 100];

/** Fabrique une commande `/d<faces>` acceptant un nombre de dés à lancer. */
function makeDice(faces: number): SlashCommand {
  return {
    guildOnly: false,
    data: new SlashCommandBuilder()
      .setName(`d${faces}`)
      .setDescription(t('modules.games.dice.description', { faces }))
      .addIntegerOption((o) =>
        o
          .setName('nombre')
          .setDescription(t('modules.games.opt.count'))
          .setMinValue(1)
          .setMaxValue(20),
      ),
    async execute(interaction) {
      const count = interaction.options.getInteger('nombre') ?? 1;
      const rolls = Array.from({ length: count }, () => rollDie(faces));
      const total = rolls.reduce((sum, value) => sum + value, 0);
      const detail = count > 1 ? ` (${rolls.join('+').slice(0, 1500)})` : '';
      await interaction.reply({ content: `D${faces} (x${count}) : ${total}${detail}` });
    },
  };
}

const diceCommands = DICE_FACES.map(makeDice);

/** `/pileouface` — tire à pile ou face. */
export const pileouface: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('pileouface')
    .setDescription(t('modules.games.coin.description')),
  async execute(interaction) {
    const heads = randomInt(2) === 0;
    const embed = infoEmbed({
      title: t('modules.games.coin.title'),
      description: heads ? t('modules.games.coin.heads') : t('modules.games.coin.tails'),
    });
    await interaction.reply({ embeds: [embed] });
  },
};

/** `/choisir` — le bot choisit parmi plusieurs options. */
export const choisir: SlashCommand = {
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('choisir')
    .setDescription(t('modules.games.choose.description'))
    .addStringOption((o) =>
      o
        .setName('options')
        .setDescription(t('modules.games.opt.options'))
        .setRequired(true)
        .setMaxLength(500),
    ),
  async execute(interaction) {
    const raw = interaction.options.getString('options', true);
    const separator = raw.includes('|') ? '|' : ',';
    const options = raw
      .split(separator)
      .map((option) => option.trim())
      .filter(Boolean);

    if (options.length < 2) {
      await interaction.reply({
        embeds: [
          infoEmbed({
            title: t('modules.games.choose.title'),
            description: t('modules.games.choose.needTwo'),
          }),
        ],
      });
      return;
    }

    await interaction.reply({
      embeds: [
        infoEmbed({
          title: t('modules.games.choose.title'),
          description: t('modules.games.choose.result', { choice: pick(options).slice(0, 256) }),
        }),
      ],
    });
  },
};

function pfcButtons(duelId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`game|pfc|${duelId}|pierre`)
      .setLabel('🪨 Pierre')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`game|pfc|${duelId}|feuille`)
      .setLabel('📄 Feuille')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`game|pfc|${duelId}|ciseaux`)
      .setLabel('✂️ Ciseaux')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** `/pfc` — pierre-feuille-ciseaux contre le bot ou en défiant un membre. */
export const pfc: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('pfc')
    .setDescription(t('modules.games.pfc.description'))
    .addStringOption((o) =>
      o
        .setName('coup')
        .setDescription(t('modules.games.opt.move'))
        .setRequired(true)
        .addChoices(
          { name: '🪨 Pierre', value: 'pierre' },
          { name: '📄 Feuille', value: 'feuille' },
          { name: '✂️ Ciseaux', value: 'ciseaux' },
        ),
    )
    .addUserOption((o) => o.setName('adversaire').setDescription(t('modules.games.opt.opponent'))),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const player = interaction.options.getString('coup', true) as PfcChoice;
    const opponent = interaction.options.getUser('adversaire');

    // Duel joueur contre joueur.
    if (opponent && !opponent.bot && opponent.id !== interaction.user.id) {
      const duelId = createDuel(interaction.user.id, player, opponent.id);
      const embed = infoEmbed({
        title: t('modules.games.pfc.title'),
        description: t('modules.games.pfc.challenge', {
          challenger: `<@${interaction.user.id}>`,
          opponent: `<@${opponent.id}>`,
        }),
      });
      await interaction.reply({
        content: `<@${opponent.id}>`,
        embeds: [embed],
        components: [pfcButtons(duelId)],
        allowedMentions: { users: [opponent.id] },
      });
      return;
    }

    // Contre le bot.
    const bot = botPfcChoice();
    const outcome = pfcOutcome(player, bot);
    await recordResult(ctx, interaction.guildId, interaction.user.id, 'pfc', outcome);
    const stats = (await getStats(ctx, interaction.guildId, interaction.user.id)).find(
      (row) => row.game === 'pfc',
    );

    const color =
      outcome === 'win' ? Colors.success : outcome === 'loss' ? Colors.error : Colors.warning;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(t('modules.games.pfc.title'))
      .setDescription(
        t('modules.games.pfc.line', {
          player: `${PFC_EMOJI[player]} ${player}`,
          bot: `${PFC_EMOJI[bot]} ${bot}`,
        }) +
          '\n\n' +
          t(`modules.games.pfc.${outcome}`),
      );
    if (stats) {
      embed.addFields({
        name: t('modules.games.pfc.recordField'),
        value: t('modules.games.pfc.record', {
          wins: stats.wins,
          losses: stats.losses,
          draws: stats.draws,
        }),
      });
    }
    await interaction.reply({ embeds: [embed] });
  },
};

/** `/morpion` — morpion contre le bot ou en défiant un membre. */
export const morpion: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('morpion')
    .setDescription(t('modules.games.ttt.description'))
    .addUserOption((o) => o.setName('adversaire').setDescription(t('modules.games.opt.opponent'))),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const opponent = interaction.options.getUser('adversaire');
    const vsBot = !opponent || opponent.bot || opponent.id === interaction.user.id;
    const p2 = vsBot ? BOT : opponent.id;
    const { id, game } = createGame(interaction.user.id, p2);

    await interaction.reply({
      ...(vsBot ? {} : { content: `<@${p2}>` }),
      embeds: [buildTttEmbed(game, false, 0)],
      components: renderBoard(id, game, false, null),
      allowedMentions: vsBot ? {} : { users: [p2] },
    });
  },
};

/** `/bataille` — bataille navale contre le bot ou en défiant un membre. */
export const bataille: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('bataille')
    .setDescription(t('modules.games.bn.description'))
    .addUserOption((o) => o.setName('adversaire').setDescription(t('modules.games.opt.opponent'))),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const opponent = interaction.options.getUser('adversaire');
    const vsBot = !opponent || opponent.bot || opponent.id === interaction.user.id;
    const p2 = vsBot ? BOT : opponent.id;
    const { id, game } = createBnGame(interaction.user.id, p2);
    const attachment = new AttachmentBuilder(renderBoardImage(game, false), {
      name: BOARD_IMAGE,
    });

    await interaction.reply({
      ...(vsBot ? {} : { content: `<@${p2}>` }),
      files: [attachment],
      embeds: [buildBnEmbed(game, false, null)],
      components: buildFireRow(id, false, vsBot),
      allowedMentions: vsBot ? {} : { users: [p2] },
    });
  },
};

/** `/statsjeux` — affiche les statistiques de jeu d'un membre. */
export const statsjeux: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('statsjeux')
    .setDescription(t('modules.games.stats.description'))
    .addUserOption((o) => o.setName('membre').setDescription(t('modules.games.opt.member'))),
  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('membre') ?? interaction.user;
    const stats = await getStats(ctx, interaction.guildId, user.id);

    const embed = infoEmbed({
      title: t('modules.games.stats.title', { user: user.tag }),
    }).setThumbnail(user.displayAvatarURL({ size: 128 }));

    let any = false;
    for (const game of ['pfc', 'morpion', 'bataille']) {
      const row = stats.find((entry) => entry.game === game);
      if (!row || row.plays === 0) continue;
      any = true;
      const winrate = Math.round((row.wins / row.plays) * 100);
      embed.addFields({
        name: t(`modules.games.stats.${game}Field`),
        value: t('modules.games.stats.value', {
          plays: row.plays,
          wins: row.wins,
          losses: row.losses,
          draws: row.draws,
          winrate,
        }),
      });
    }
    if (!any) embed.setDescription(t('modules.games.stats.none'));
    await interaction.reply({ embeds: [embed] });
  },
};

export const gamesCommands: SlashCommand[] = [
  ...diceCommands,
  boule8,
  pileouface,
  choisir,
  pfc,
  morpion,
  bataille,
  statsjeux,
];
