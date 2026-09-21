import type {
  BotContext,
  ModuleHttpRequest,
  ModuleHttpResponse,
  ModuleHttpRoute,
} from '../../core/module.js';
import {
  type Item,
  countItems,
  createItem,
  deleteItem,
  getItem,
  listItems,
  sanitizeItemInput,
  updateItem,
} from './service.js';
import { getItemLimit, setItemLimit } from './limit.js';
import { itemEffectsUI } from './effects-ui.js';

/**
 * Les endpoints de la boutique, déclarés par le module lui-même.
 *
 * Ils vivaient dans `src/core/web-api.ts`, qui importait donc `service`,
 * `limit` et `effects-ui` en dur — quatre imports qui rendaient le module
 * impossible à retirer du dépôt public. Même remède que partout ailleurs : le
 * module déclare, le cœur relaie.
 *
 * Le comportement est repris tel quel, y compris les codes d'erreur et les
 * bornes de débit : ce déplacement ne doit RIEN changer pour le dashboard.
 */

/**
 * Un objet tel que le dashboard le lit. La liste est explicite plutôt qu'un
 * `...item` : une colonne ajoutée en base ne doit pas se retrouver publiée
 * sur l'API sans qu'on l'ait décidé.
 */
function serializeItem(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    emoji: item.emoji,
    description: item.description,
    rarity: item.rarity,
    price: item.price,
    buyable: item.buyable,
    tradable: item.tradable,
    droppable: item.droppable,
    usable: item.usable,
    roleReward: item.roleReward,
    effects: item.effects,
    consumable: item.consumable,
    cooldownSeconds: item.cooldownSeconds,
  };
}

/**
 * GET    /api/guilds/:id/items          -> les objets du serveur
 * POST   /api/guilds/:id/items          -> en crée un      (acteur requis)
 * POST   /api/guilds/:id/items/:itemId  -> en modifie un   (acteur requis)
 * DELETE /api/guilds/:id/items/:itemId  -> en supprime un  (acteur requis)
 */
const guildItemsRoute: ModuleHttpRoute = {
  segment: 'items',
  guild: true,
  // Une fiche d'objet porte ses effets : la borne des réglages (8 ko) serait
  // trop courte. C'est la limite qu'appliquait le cœur avant ce déplacement.
  maxBodyBytes: 512_000,
  handle: async (ctx: BotContext, req: ModuleHttpRequest): Promise<ModuleHttpResponse> => {
    const guildId = req.guildId;
    if (!guildId) return { status: 400, body: { error: 'invalid_guild_id' } };
    const itemId = req.segments[0];

    // Lecture : le token suffit (pas de mutation).
    if (req.method === 'GET' && !itemId) {
      const items = await listItems(ctx, guildId);
      // `effectsUI` décrit les effets disponibles : le dashboard génère son
      // éditeur à partir de là, sans connaître les types côté site.
      return {
        status: 200,
        body: {
          items: items.map(serializeItem),
          max: await getItemLimit(ctx),
          effectsUI: itemEffectsUI,
        },
      };
    }

    // Toute mutation exige un acteur autorisé à gérer CE serveur.
    const isMutation =
      (req.method === 'POST' && !itemId) ||
      ((req.method === 'POST' || req.method === 'DELETE') && Boolean(itemId));
    if (!isMutation) return { status: 404, body: { error: 'not_found' } };

    // Le catalogue d'objets appartient à ce module : sa garde est celle du
    // module, pas celle du serveur entier. Un administrateur la franchit
    // toujours ; un membre du staff à qui l'on a confié « Objets » aussi.
    if (!req.actorId || !(await req.canConfigureModule?.())) {
      return { status: 403, body: { error: 'forbidden' } };
    }
    if (!req.rateLimit(`items:${guildId}`, 60, 60_000)) {
      return { status: 429, body: { error: 'rate_limited' } };
    }

    // POST /items -> création
    if (req.method === 'POST' && !itemId) {
      const limit = await getItemLimit(ctx);
      if (limit !== null && (await countItems(ctx, guildId)) >= limit) {
        return { status: 409, body: { error: 'too_many_items', max: limit } };
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input = sanitizeItemInput(body);
      if (!input.name) return { status: 400, body: { error: 'name_required' } };
      const created = await createItem(ctx, guildId, { ...input, name: input.name });
      return { status: 201, body: { item: serializeItem(created) } };
    }

    // Les routes par objet vérifient d'abord son appartenance au serveur.
    const existing = itemId ? await getItem(ctx, guildId, itemId) : null;
    if (!existing || !itemId) return { status: 404, body: { error: 'unknown_item' } };

    if (req.method === 'DELETE') {
      await deleteItem(ctx, itemId);
      return { status: 200, body: { ok: true } };
    }

    // POST /items/:itemId -> mise à jour
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = sanitizeItemInput(body);
    // Interdit de vider le nom d'un objet existant.
    if (body.name !== undefined && !input.name) {
      return { status: 400, body: { error: 'name_required' } };
    }
    await updateItem(ctx, itemId, input);
    const updated = await getItem(ctx, guildId, itemId);
    return { status: 200, body: { item: updated ? serializeItem(updated) : null } };
  },
};

/**
 * Plafond GLOBAL d'objets par serveur.
 * GET  /api/items/limit         -> { max } (token seul)
 * POST /api/items/limit { max } -> fixe le plafond (propriétaire uniquement)
 *   max = null ou 0 => illimité.
 */
const itemLimitRoute: ModuleHttpRoute = {
  segment: 'items',
  handle: async (ctx: BotContext, req: ModuleHttpRequest): Promise<ModuleHttpResponse> => {
    if (req.segments[0] !== 'limit' || req.segments.length !== 1) {
      return { status: 404, body: { error: 'not_found' } };
    }

    if (req.method === 'GET') return { status: 200, body: { max: await getItemLimit(ctx) } };

    if (req.method === 'POST') {
      // Réglage d'instance : réservé au propriétaire du bot (comme /maj).
      if (!req.isOwner) return { status: 403, body: { error: 'forbidden' } };
      if (!req.rateLimit('items-limit', 20, 60_000)) {
        return { status: 429, body: { error: 'rate_limited' } };
      }
      const body = (req.body ?? {}) as { max?: unknown };
      const raw = body.max;
      // Accepte un entier >= 0 ou null ; 0/null => illimité.
      const value =
        raw === null
          ? null
          : typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
            ? Math.trunc(raw)
            : undefined;
      if (value === undefined) return { status: 400, body: { error: 'invalid_max' } };
      return { status: 200, body: { max: await setItemLimit(ctx, value) } };
    }

    return { status: 405, body: { error: 'method_not_allowed' } };
  },
};

export const itemsRoutes: ModuleHttpRoute[] = [guildItemsRoute, itemLimitRoute];
