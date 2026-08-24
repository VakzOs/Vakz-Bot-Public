import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { SearchPlatform } from 'lavalink-client';
import type { BotContext, SlashCommand } from '../../core/module.js';
import { t } from '../../core/i18n.js';
import { successEmbed } from '../../lib/embeds.js';
import { type Player, getManager } from './manager.js';
import { SEARCH_PLATFORMS, getMusicConfig } from './config.js';
import {
  type Requester,
  formatTime,
  nowPlayingEmbed,
  parsePosition,
  queueEmbed,
  resolveControl,
  trackLine,
} from './service.js';

async function ephemeral(interaction: ChatInputCommandInteraction, key: string): Promise<void> {
  await interaction.reply({ content: t(key), flags: MessageFlags.Ephemeral });
}

// --- /play ------------------------------------------------------------------

const play: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription(t('modules.music.command.play'))
    .addStringOption((o) =>
      o.setName('recherche').setDescription(t('modules.music.command.playQuery')).setRequired(true),
    )
    .addStringOption((o) => {
      o.setName('source').setDescription(t('modules.music.command.playSource')).setRequired(false);
      for (const platform of SEARCH_PLATFORMS)
        o.addChoices({ name: platform.label, value: platform.value });
      return o;
    }),

  async execute(interaction, ctx: BotContext) {
    if (!interaction.inCachedGuild()) return;
    const manager = getManager();
    if (!manager) {
      await ephemeral(interaction, 'modules.music.notConfigured');
      return;
    }
    if (!manager.useable) {
      await ephemeral(interaction, 'modules.music.nodeDown');
      return;
    }
    const voiceId = interaction.member.voice.channelId;
    if (!voiceId) {
      await ephemeral(interaction, 'modules.music.notInVoice');
      return;
    }
    const config = await getMusicConfig(ctx, interaction.guildId);
    const existing = manager.getPlayer(interaction.guildId);
    if (
      existing &&
      config.requireSameChannel &&
      existing.voiceChannelId &&
      existing.voiceChannelId !== voiceId
    ) {
      await ephemeral(interaction, 'modules.music.notSameChannel');
      return;
    }

    const query = interaction.options.getString('recherche', true);
    const source = (interaction.options.getString('source') ??
      config.defaultSearch) as SearchPlatform;

    // Création + connexion du lecteur : peut échouer (permissions vocales,
    // nœud tombé). On isole pour renvoyer un message clair plutôt qu'une erreur
    // générique.
    const created = !existing;
    let player: Player;
    try {
      player =
        existing ??
        manager.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: voiceId,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: config.defaultVolume,
        });
      if (!player.connected) await player.connect();
    } catch (error) {
      ctx.logger.error(
        { err: error, guildId: interaction.guildId },
        'music: connexion au salon vocal échouée',
      );
      await ephemeral(interaction, 'modules.music.joinFailed');
      return;
    }

    await interaction.deferReply();

    try {
      const requester: Requester = { id: interaction.user.id, username: interaction.user.username };
      const result = await player.search({ query, source }, requester).catch(() => null);

      if (
        !result ||
        result.loadType === 'error' ||
        result.loadType === 'empty' ||
        !result.tracks.length
      ) {
        if (created) await player.destroy('noResults').catch(() => undefined);
        await interaction.editReply({ content: t('modules.music.noResults') });
        return;
      }

      if (result.loadType === 'playlist') {
        await player.queue.add(result.tracks);
        await interaction.editReply({
          embeds: [
            successEmbed({
              description: t('modules.music.addedPlaylist', {
                count: result.tracks.length,
                name: result.playlist?.name ?? t('modules.music.field.playlist'),
              }),
            }),
          ],
        });
      } else {
        const track = result.tracks[0]!;
        await player.queue.add(track);
        await interaction.editReply({
          embeds: [
            successEmbed({
              title: t('modules.music.addedTitle'),
              description: trackLine(track),
              thumbnail: track.info.artworkUrl ?? undefined,
            }),
          ],
        });
      }

      if (!player.playing && !player.paused) await player.play();
    } catch (error) {
      ctx.logger.error({ err: error, guildId: interaction.guildId }, 'music: lecture échouée');
      if (created) await player.destroy('error').catch(() => undefined);
      await interaction.editReply({ content: t('modules.music.playError') }).catch(() => undefined);
    }
  },
};

// --- Contrôles (rôle DJ / même salon requis) --------------------------------

const skip: SlashCommand = {
  data: new SlashCommandBuilder().setName('skip').setDescription(t('modules.music.command.skip')),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    const { player } = res;
    if (player.queue.tracks.length === 0) {
      await player.stopPlaying(true, false);
      await interaction.reply({ content: t('modules.music.skippedEnd') });
      return;
    }
    await player.skip();
    await interaction.reply({ content: t('modules.music.skipped') });
  },
};

const stop: SlashCommand = {
  data: new SlashCommandBuilder().setName('stop').setDescription(t('modules.music.command.stop')),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    await res.player.stopPlaying(true, false);
    await interaction.reply({ content: t('modules.music.stopped') });
  },
};

const pause: SlashCommand = {
  data: new SlashCommandBuilder().setName('pause').setDescription(t('modules.music.command.pause')),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    if (res.player.paused) {
      await interaction.reply({
        content: t('modules.music.alreadyPaused'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await res.player.pause();
    await interaction.reply({ content: t('modules.music.paused') });
  },
};

const resume: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription(t('modules.music.command.resume')),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    if (!res.player.paused) {
      await interaction.reply({
        content: t('modules.music.notPaused'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await res.player.resume();
    await interaction.reply({ content: t('modules.music.resumed') });
  },
};

const volume: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription(t('modules.music.command.volume'))
    .addIntegerOption((o) =>
      o
        .setName('niveau')
        .setDescription(t('modules.music.command.volumeValue'))
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(150),
    ),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    const requested = interaction.options.getInteger('niveau', true);
    const clamped = Math.min(requested, res.config.maxVolume);
    await res.player.setVolume(clamped);
    await interaction.reply({ content: t('modules.music.volumeSet', { volume: clamped }) });
  },
};

const loop: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription(t('modules.music.command.loop'))
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription(t('modules.music.command.loopValue'))
        .setRequired(true)
        .addChoices(
          { name: t('modules.music.loopState.off'), value: 'off' },
          { name: t('modules.music.loopState.track'), value: 'track' },
          { name: t('modules.music.loopState.queue'), value: 'queue' },
        ),
    ),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    const mode = interaction.options.getString('mode', true) as 'off' | 'track' | 'queue';
    await res.player.setRepeatMode(mode);
    await interaction.reply({
      content: t('modules.music.loopSet', { mode: t(`modules.music.loopState.${mode}`) }),
    });
  },
};

const shuffle: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription(t('modules.music.command.shuffle')),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    if (res.player.queue.tracks.length < 2) {
      await interaction.reply({
        content: t('modules.music.queueTooShort'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await res.player.queue.shuffle();
    await interaction.reply({ content: t('modules.music.shuffled') });
  },
};

const seek: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription(t('modules.music.command.seek'))
    .addStringOption((o) =>
      o.setName('position').setDescription(t('modules.music.command.seekValue')).setRequired(true),
    ),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    const current = res.player.queue.current;
    if (!current || current.info.isStream) {
      await interaction.reply({
        content: t('modules.music.cannotSeek'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const ms = parsePosition(interaction.options.getString('position', true));
    if (ms === null) {
      await interaction.reply({
        content: t('modules.music.badPosition'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const clamped = Math.min(ms, current.info.duration);
    await res.player.seek(clamped);
    await interaction.reply({ content: t('modules.music.seeked', { time: formatTime(clamped) }) });
  },
};

const remove: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription(t('modules.music.command.remove'))
    .addIntegerOption((o) =>
      o
        .setName('numero')
        .setDescription(t('modules.music.command.removeValue'))
        .setRequired(true)
        .setMinValue(1),
    ),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    const index = interaction.options.getInteger('numero', true) - 1;
    const target = res.player.queue.tracks[index];
    if (!target) {
      await interaction.reply({
        content: t('modules.music.badIndex'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    res.player.queue.splice(index, 1);
    await interaction.reply({ content: t('modules.music.removed', { title: target.info.title }) });
  },
};

const disconnect: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription(t('modules.music.command.disconnect')),
  async execute(interaction, ctx) {
    const res = await resolveControl(interaction, ctx);
    if (!res) return;
    await res.player.destroy('userDisconnect');
    await interaction.reply({ content: t('modules.music.left') });
  },
};

// --- Lecture seule (tout le monde dans le vocal) ----------------------------

const queue: SlashCommand = {
  data: new SlashCommandBuilder().setName('queue').setDescription(t('modules.music.command.queue')),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const manager = getManager();
    const player = manager?.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      await ephemeral(
        interaction,
        manager ? 'modules.music.nothingPlaying' : 'modules.music.notConfigured',
      );
      return;
    }
    await interaction.reply({ embeds: [queueEmbed(player)] });
  },
};

const nowplaying: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription(t('modules.music.command.nowplaying')),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const manager = getManager();
    const player = manager?.getPlayer(interaction.guildId);
    const current = player?.queue.current;
    if (!player || !current) {
      await ephemeral(
        interaction,
        manager ? 'modules.music.nothingPlaying' : 'modules.music.notConfigured',
      );
      return;
    }
    await interaction.reply({ embeds: [nowPlayingEmbed(player, current)] });
  },
};

export const musicCommands: SlashCommand[] = [
  play,
  skip,
  stop,
  pause,
  resume,
  volume,
  loop,
  shuffle,
  seek,
  remove,
  disconnect,
  queue,
  nowplaying,
];
