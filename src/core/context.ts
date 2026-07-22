import type { Client } from 'discord.js';
import type { BotContext } from './module.js';
import { db } from './db.js';
import { logger } from './logger.js';
import { scheduler } from './scheduler.js';
import { t } from './i18n.js';
import { guildConfig } from './guild-config.js';

/** Construit le contexte injecté aux modules à partir des singletons cœur. */
export function createContext(client: Client): BotContext {
  return {
    client,
    db,
    logger,
    scheduler,
    t,
    config: guildConfig,
  };
}
