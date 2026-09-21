import type { Client } from 'discord.js';
import type { BotContext } from './module.js';
import { db } from './db.js';
import { createLogger, logger } from './logger.js';
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

/**
 * Contextes dérivés, un par module. Mémoïsés parce qu'un contexte est demandé à
 * chaque interaction : sans cache, on allouerait un objet et un logger enfant
 * par clic de bouton.
 */
const perModule = new Map<string, BotContext>();

/**
 * Le contexte d'un module, avec **son** logger.
 *
 * Sans ça, les 43 modules partagent le logger racine et pas une seule de leurs
 * lignes ne porte de `scope` : le dashboard affiche une colonne « module » vide
 * et la recherche par module ne trouve rien. Le loader connaissant déjà le nom
 * du module, chaque `ctx.logger.warn(...)` déjà écrit devient attribuable sans
 * qu'aucun module ait à changer — et le module suivant en hérite d'office.
 */
export function contextFor(ctx: BotContext, moduleName: string): BotContext {
  const cached = perModule.get(moduleName);
  if (cached) return cached;
  const derived: BotContext = { ...ctx, logger: createLogger(moduleName) };
  perModule.set(moduleName, derived);
  return derived;
}
