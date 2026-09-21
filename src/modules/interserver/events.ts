import { Events } from 'discord.js';
import { defineEvent } from '../../core/module.js';
import { relayMessage } from './service.js';

/**
 * À chaque message posté, on tente un relais interserveurs. `relayMessage` filtre
 * lui-même (salon non lié, bots/webhooks, module désactivé) : la boucle de
 * relais est cassée car les messages relayés sont des messages de webhook.
 */
export const onInterserverMessage = defineEvent({
  name: Events.MessageCreate,
  execute: (ctx, message) => relayMessage(ctx, message),
});
