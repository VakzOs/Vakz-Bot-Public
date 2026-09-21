import type {
  ActionRowBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  Interaction,
  MessageActionRowComponentBuilder,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { Guild } from 'discord.js';
import type { ZodType } from 'zod';
import type { CategoryId } from './module-catalog.js';
import type { TranslateFn } from './i18n.js';
import type { Scheduler } from './scheduler.js';
import type { GuildConfigService } from './guild-config.js';

/**
 * Contexte injecté à chaque module : tout ce dont une commande, un event ou
 * une tâche planifiée a besoin, sans dépendre d'imports globaux.
 */
export interface BotContext {
  client: Client;
  db: PrismaClient;
  logger: Logger;
  scheduler: Scheduler;
  /** Fonction de traduction i18n. */
  t: TranslateFn;
  /** Accès à la configuration par serveur. */
  config: GuildConfigService;
}

/**
 * Tout builder de slash command discord.js satisfait ce contrat minimal.
 * On évite ainsi les frictions de types entre `SlashCommandBuilder` et ses
 * variantes (options-only, subcommands-only).
 */
export interface CommandData {
  name: string;
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

/**
 * D'où viennent les métadonnées d'une commande : un builder, ou une **fabrique**
 * qui le construit.
 *
 * Un builder écrit tel quel est bâti à l'IMPORT du module, hors de tout
 * `runWithLocale` : ses `t('clé')` répondent en français, et le nom comme la
 * description partent figés dans cette langue vers Discord. Une fabrique peut
 * au contraire être rejouée dans chaque langue — c'est ce qui permet de
 * déployer `/rank` sur un serveur réglé en anglais et `/rang` sur son voisin.
 *
 * Les deux formes restent acceptées : un module qui donne un builder continue
 * d'être déployé, en français partout, et le loader le dit une fois au
 * démarrage plutôt que de le taire.
 */
export type CommandDataSource = CommandData | (() => CommandData);

/** Une slash command : ses métadonnées + ses handlers. */
export interface SlashCommand {
  data: CommandDataSource;
  /** Restreint la commande aux serveurs (pas en MP) si `true`. Défaut : true. */
  guildOnly?: boolean;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: BotContext): Promise<void>;
}

/** Un listener d'évènement Discord. */
export interface EventListener<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(ctx: BotContext, ...args: ClientEvents[K]): Promise<void> | void;
}

/** Helper préservant le typage fort au site de déclaration d'un event. */
export function defineEvent<K extends keyof ClientEvents>(
  listener: EventListener<K>,
): EventListener<K> {
  return listener;
}

/**
 * Ce qu'une tâche rapporte de son passage : des compteurs qu'elle nomme
 * elle-même (`{ remis: 3, ignores: 1 }`).
 *
 * Une tâche à la minute passe l'essentiel de ses journées à ne rien trouver.
 * Sans ce compte-rendu, le cœur ne sait pas distinguer le passage à vide — qui
 * n'intéresse personne — de celui qui a livré trente rappels, et il ne lui
 * reste qu'à annoncer les deux de la même façon : 1 440 lignes « Tâche
 * terminée » par jour et par tâche, dans lesquelles la seule qui comptait est
 * introuvable. Avec lui, le journal ne retient que les passages qui ont fait
 * quelque chose, et il dit quoi.
 *
 * Les compteurs à zéro sont retirés ; un compte-rendu vide (ou absent) vaut
 * « rien à faire », et la ligne descend en `debug`.
 */
export type TaskReport = Record<string, number>;

/** Une tâche planifiée (cron). */
export interface ScheduledTask {
  name: string;
  /** Expression cron compatible node-cron. */
  cron: string;
  /**
   * Seuil de lenteur propre à la tâche, en millisecondes. Au-delà, le cœur
   * écrit un avertissement.
   *
   * À relever pour une tâche qui attend **volontairement** — un étalement
   * aléatoire, une longue série d'appels réseau : sans cela, elle s'alerterait
   * elle-même à chaque passage et l'avertissement ne voudrait plus rien dire.
   */
  slowMs?: number;
  /**
   * Le travail. Rendre un {@link TaskReport} quand la tâche a fait quelque
   * chose : c'est ce qui la fait apparaître dans le journal, avec ses chiffres.
   * Ne rien rendre équivaut à un passage à vide.
   */
  execute(ctx: BotContext): Promise<TaskReport | void>;
}

/** Une rangée de composants d'un message (boutons, menus, sélecteurs de salon…). */
export type PanelRow = ActionRowBuilder<MessageActionRowComponentBuilder>;

/**
 * Gestionnaire d'interactions de composants (boutons, menus, modals) : un module
 * déclare le préfixe de customId qu'il possède (avant le premier `|`) et reçoit
 * toutes les interactions correspondantes.
 */
export interface ComponentHandler {
  /** Premier segment du customId (ex. "rr" pour `rr|<roleId>`). */
  prefix: string;
  handle(interaction: Interaction, ctx: BotContext): Promise<void>;
}

/**
 * Types de champ éditables depuis le dashboard web. Chaque type indique au site
 * quel contrôle afficher (sélecteur de salon, de rôle, interrupteur…).
 */
export type ConfigFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'color'
  | 'channel'
  | 'voiceChannel'
  | 'category'
  | 'role'
  | 'channels'
  | 'roles'
  | 'select'
  | 'multiselect'
  | 'tags'
  | 'list';

/** Un champ éditable d'une configuration de module (rendu par le dashboard). */
export interface ConfigField {
  /** Clé dans l'objet de config (relative au groupe). */
  key: string;
  /** Libellé affiché. */
  label: string;
  type: ConfigFieldType;
  /** Aide contextuelle affichée sous le champ. */
  help?: string;
  placeholder?: string;
  /** Options pour le type `select`. */
  options?: { value: string; label: string }[];
  /** Valeur par défaut à la création d'une nouvelle ligne de liste. */
  default?: unknown;
  /**
   * Type `list` : sous-champs de chaque élément (le champ édite un tableau
   * d'objets, ajout/suppression de lignes côté dashboard). La clé d'un
   * sous-champ peut être « pointée » (ex. `schedule.type`) pour cibler un
   * sous-objet imbriqué.
   */
  item?: ConfigField[];
  /** Type `list` : clé d'identifiant auto-généré à la création d'une ligne. */
  idKey?: string;
  /** Type `list` : libellé du bouton d'ajout (défaut « Ajouter »). */
  addLabel?: string;
}

/**
 * Un groupe de champs. Sans `key`, les champs s'appliquent à la racine de la
 * config ; avec `key`, ils s'appliquent à un sous-objet (ex. `welcome`).
 */
export interface ConfigGroup {
  /** Sous-objet ciblé (ex. "welcome"). Absent = racine de la config. */
  key?: string;
  label?: string;
  description?: string;
  fields: ConfigField[];
}

/** Description des champs éditables d'un module pour le dashboard web. */
export type ConfigUI = ConfigGroup[];

/**
 * Résultat d'une action de module déclenchée depuis le dashboard.
 * `message` est destiné à l'admin (succès comme échec) ; `configPatch` permet à
 * l'action de persister ce qu'elle vient de produire (ex. `messageId` d'un
 * panneau publié) sans que le module ait à réécrire la config lui-même.
 */
export interface ModuleActionResult {
  ok: boolean;
  message?: string;
  configPatch?: Record<string, unknown>;
}

/** Arguments passés à une action de module. */
export interface ModuleActionArgs {
  ctx: BotContext;
  guildId: string;
  /** Snowflake de l'admin à l'origine de l'action (en-tête `x-actor-id`). */
  actorId?: string;
  /** Valeurs des `fields` saisies dans le dashboard (brutes, à valider). */
  input: Record<string, unknown>;
}

/**
 * Une action ponctuelle d'un module, rendue comme un bouton dans le dashboard :
 * publier un panneau, envoyer un message tout de suite, tester une alerte,
 * rafraîchir des compteurs… Tout ce qui n'est pas « éditer un champ de config ».
 */
export interface ModuleAction {
  /** Identifiant stable, unique dans le module (segment d'URL). */
  id: string;
  label: string;
  help?: string;
  /** Apparence du bouton côté dashboard. */
  style?: 'primary' | 'secondary' | 'danger';
  /** Si présent, le dashboard demande confirmation avec ce texte. */
  confirm?: string;
  /** Champs à saisir avant de lancer l'action (mêmes types que `ConfigField`). */
  fields?: ConfigField[];
  /**
   * Champs calculés pour CE serveur, quand les options dépendent de sa config
   * (choisir un abonnement, un message planifié…). Prioritaire sur `fields`.
   */
  resolveFields?(ctx: BotContext, guildId: string): Promise<ConfigField[]>;
  run(args: ModuleActionArgs): Promise<ModuleActionResult>;
}

/**
 * Un module pluggable. Chaque dossier `src/modules/<nom>/` exporte par défaut
 * un objet conforme à cette interface ; le loader le découvre automatiquement.
 */
/**
 * Une requête HTTP que le cœur remet à un module, dépouillée de `node:http`.
 *
 * Le module ne voit ni la socket ni les en-têtes : le cœur a déjà lu le corps,
 * identifié l'acteur et vérifié la garde `owner` quand la route l'exige. Un
 * module reste ainsi testable sans serveur, et le cœur garde la main sur ce
 * qui doit valoir pour tout le monde.
 */
/** Ce que rend la publication d'un panneau demandée par le dashboard. */
export interface PanelPublishResult {
  ok: boolean;
  /** Identifiant du message publié, à persister pour les mises à jour. */
  messageId?: string;
  error?: string;
}

export interface ModuleHttpRequest {
  method: string;
  /** Segments d'URL APRÈS celui que le module a réservé. */
  segments: string[];
  /** Corps JSON déjà lu ; `null` s'il est absent ou illisible. */
  body: unknown;
  /** L'utilisateur Discord au nom de qui le site agit, si le cœur le connaît. */
  actorId?: string;
  /** L'acteur est-il le propriétaire du bot (`BOT_OWNER_ID`) ? */
  isOwner: boolean;
  /** Le serveur visé, pour une route de portée `guild`. Absent sinon. */
  guildId?: string;
  /**
   * L'acteur peut-il gérer CE serveur ? Routes `guild` uniquement.
   *
   * Fourni par le cœur plutôt que recalculé par chaque module : c'est une
   * question d'autorisation, et une autorisation qui se réimplémente finit par
   * diverger. L'appel touche le cache Discord, d'où la promesse.
   */
  canManageGuild?(): Promise<boolean>;
  /**
   * L'acteur peut-il configurer LE MODULE qui sert cette route, sur ce serveur ?
   * Routes `guild` uniquement.
   *
   * C'est la garde à utiliser pour une mutation de module : elle est vraie pour
   * un administrateur du serveur comme pour un membre du staff à qui ce
   * module-là a été délégué (voir `src/core/guild-access.ts`). `canManageGuild`
   * reste réservé à ce qui ne se délègue pas — effacer, distribuer les droits.
   * Le cœur sait quel module a déclaré la route : le module n'a pas à se nommer.
   */
  canConfigureModule?(): Promise<boolean>;
  /** Le compteur d'appels du cœur : `false` = quota dépassé, répondre 429. */
  rateLimit(key: string, max: number, windowMs: number): boolean;
}

export interface ModuleHttpResponse {
  status: number;
  body: unknown;
}

/**
 * Un endpoint HTTP servi par un module.
 *
 * C'est le pendant de `commands` et `tasks` : le module DÉCLARE ce qu'il sert,
 * au lieu que le cœur aille le chercher par son nom. Sans cela, `web-api.ts`
 * importe le module en dur — et le dépôt ne compile plus dès qu'on retire le
 * dossier, ce qui interdit de publier une variante sans lui.
 */
export interface ModuleHttpRoute {
  /** Premier segment sous `/api/`, ou sous `/api/owner/` si `owner`. */
  segment: string;
  /** Réservé au propriétaire du bot (`BOT_OWNER_ID`), vérifié par le cœur. */
  owner?: boolean;
  /**
   * Servi sous `/api/guilds/:guildId/<segment>` plutôt qu'à la racine.
   *
   * Le cœur a déjà validé le format de l'identifiant ; il le passe dans
   * `guildId`, avec `canManageGuild()` pour les mutations. Le module décide
   * lui-même de ce qu'il ouvre en lecture — ce n'est pas la même chose selon
   * qu'on liste des objets ou qu'on efface un serveur.
   */
  guild?: boolean;
  /** Plafond de lecture du corps. Le défaut suffit à un échange de jeu. */
  maxBodyBytes?: number;
  handle(ctx: BotContext, req: ModuleHttpRequest): Promise<ModuleHttpResponse>;
}

export interface BotModule {
  /** Identifiant stable, utilisé comme clé en base. Ex. "levels". */
  name: string;
  /** Clé i18n du nom affiché (dans le dashboard). */
  labelKey: string;
  /** Clé i18n de la description. */
  descriptionKey: string;
  /** Module système non désactivable (ex. "core"). */
  internal?: boolean;
  /**
   * Catégorie du dashboard. Absente, le module tombe dans « operations » —
   * sans rien casser, mais rangé au hasard : la déclarer est le plus sûr.
   */
  category?: CategoryId;
  /** Emoji illustrant le module dans le dashboard. */
  emoji?: string;
  /**
   * Chemins que le DASHBOARD (dépôt séparé) porte pour ce module — pages,
   * panneaux, helpers.
   *
   * Sert à la publication vers les miroirs publics : le bot et le site ont
   * chacun le leur, et une page laissée sur le site public alors que le module
   * n'est plus dans le bot donne un écran qui ne peut pas fonctionner. Le bot
   * ne lit pas le dépôt du dashboard, il ne peut donc pas les deviner — d'où
   * cette déclaration, faite par qui écrit le module et connaît ses deux
   * moitiés. Chemins relatifs à la racine du dépôt du site.
   */
  webPaths?: string[];
  commands?: SlashCommand[];
  events?: EventListener[];
  tasks?: ScheduledTask[];
  /** Schéma zod validant la config par serveur de ce module. */
  configSchema?: ZodType;
  /** Config par défaut appliquée à l'activation. */
  defaultConfig?: unknown;
  /**
   * Champs éditables depuis le dashboard web (optionnel).
   *
   * **Se déclare avec une FABRIQUE** — `configUI: () => [...]` — pour la même
   * raison qu'une slash command : ses libellés passent par `t()`, et un tableau
   * posé tel quel les figerait dans la langue qui se trouvait être ambiante au
   * chargement des modules, c'est-à-dire le français, pour tout le monde et
   * pour toujours. La fabrique est rejouée à chaque lecture, dans la langue du
   * dashboard qui demande. Un tableau reste accepté : un module sans aucun
   * texte à traduire n'a pas à se compliquer.
   */
  configUI?: ConfigUI | (() => ConfigUI);
  /**
   * Actions ponctuelles exposées comme boutons dans le dashboard (optionnel).
   *
   * Même règle que `configUI` : fabrique, parce que `label`, `help` et
   * `confirm` sont du texte. Ce que rend `run()` se traduit tout seul —
   * la fonction s'exécute dans la langue de la requête.
   */
  actions?: ModuleAction[] | (() => ModuleAction[]);
  /** Gestionnaire d'interactions de composants (optionnel). */
  componentHandler?: ComponentHandler;
  /** Endpoints HTTP servis par ce module (optionnel). */
  httpRoutes?: ModuleHttpRoute[];
  /**
   * Publie ou met à jour le panneau du module (embed + boutons) dans le salon
   * configuré, à la demande du dashboard.
   *
   * Le cœur tenait une table `PUBLISHERS` qui nommait les cinq modules
   * concernés et importait leur publication — cinq modules qu'on ne pouvait
   * donc pas retirer du dépôt. Déclaré ici, c'est le module qui se signale
   * publiable, et son absence ne laisse aucune trace.
   */
  publishPanel?(guild: Guild, config: unknown): Promise<PanelPublishResult>;
  /**
   * Le module est-il ouvert sur ce serveur (optionnel) ?
   *
   * Répondre `false` le retire de la liste servie au dashboard : le configurer
   * n'y ferait rien, et la carte promettrait ce que le module refusera. Sans
   * cette réponse, le module est disponible partout.
   */
  isAvailable?(ctx: BotContext, guildId: string): Promise<boolean>;
  /**
   * Appelé après chaque écriture de la config par le dashboard. Le module y
   * réaligne ce que l'édition d'un simple champ ne peut pas faire seule :
   * amorcer une cadence, annuler une tâche devenue sans objet…
   * Reçoit la config déjà validée et persistée, et celle qu'elle remplace.
   */
  onConfigSaved?(
    ctx: BotContext,
    guildId: string,
    config: unknown,
    previous: unknown,
  ): Promise<void>;
  onLoad?(ctx: BotContext): Promise<void>;
  onUnload?(ctx: BotContext): Promise<void>;
}

/** Helper préservant le typage au site de déclaration d'un module. */
export function defineModule(module: BotModule): BotModule {
  return module;
}

/**
 * Les blocs de configuration d'un module, dans la langue ambiante.
 *
 * Point de passage unique : le cœur ne lit jamais `module.configUI`
 * directement, sans quoi la moitié des lecteurs oublierait d'appeler la
 * fabrique et lirait un tableau de fonctions.
 */
export function moduleConfigUI(module: BotModule): ConfigUI {
  const ui = module.configUI;
  if (!ui) return [];
  return typeof ui === 'function' ? ui() : ui;
}

/** Les boutons d'action d'un module, dans la langue ambiante. */
export function moduleActions(module: BotModule): ModuleAction[] {
  const actions = module.actions;
  if (!actions) return [];
  return typeof actions === 'function' ? actions() : actions;
}
