import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { MODULE_NAME, getTempvoiceConfig } from './config.js';
import { createTempChannel, handleVoiceLeave } from './service.js';

/**
 * Cœur du module : à chaque changement d'état vocal, on crée un salon quand un
 * membre rejoint un hub, et on gère le départ (suppression si vide, sinon
 * auto-transfert de la propriété si le propriétaire s'en va).
 */
export const onVoiceStateUpdate = defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(ctx, oldState, newState) {
    const guild = newState.guild;
    if (!(await ctx.config.isEnabled(guild.id, MODULE_NAME))) return;
    const config = await getTempvoiceConfig(ctx, guild.id);

    // Le membre a rejoint un salon générateur → on lui crée son salon.
    if (newState.channelId && newState.member && newState.channelId !== oldState.channelId) {
      const hub = config.hubs.find((candidate) => candidate.channelId === newState.channelId);
      if (hub) {
        await createTempChannel(ctx, newState.member, hub, config.showControlPanel);
      }
    }

    // Le membre a quitté un salon temporaire : suppression si vide, sinon
    // auto-transfert de la propriété si c'est le propriétaire qui part.
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await handleVoiceLeave(ctx, guild, oldState.channelId, oldState.id);
    }
  },
});
