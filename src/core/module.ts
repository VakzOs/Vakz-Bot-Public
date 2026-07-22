import type {
  ActionRowBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  EmbedBuilder,
  Interaction,
  MessageActionRowComponentBuilder,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { ZodType } from 'zod';
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

/** Une slash command : ses métadonnées + ses handlers. */
export interface SlashCommand {
  data: CommandData;
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

/** Une tâche planifiée (cron). */
export interface ScheduledTask {
  name: string;
  /** Expression cron compatible node-cron. */
  cron: string;
  execute(ctx: BotContext): Promise<void>;
}

/** Une rangée de composants d'un message (boutons, menus, sélecteurs de salon…). */
export type PanelRow = ActionRowBuilder<MessageActionRowComponentBuilder>;

/** Contenu d'un panneau de configuration rendu dans `/config`. */
export interface PanelPage {
  embeds: EmbedBuilder[];
  components: PanelRow[];
}

/** Arguments passés au gestionnaire d'interactions d'un panneau de config. */
export interface PanelHandlerArgs {
  interaction: Interaction;
  ctx: BotContext;
  guildId: string;
  /** Action extraite du customId (`cfg|<module>|<action>|<params...>`). */
  action: string;
  params: string[];
  /** Recompose la page complète du module (chrome `/config` + panneau). */
  renderPage(): Promise<PanelPage>;
}

/**
 * Panneau de configuration interactif d'un module, affiché dans `/config`.
 * `render` produit l'embed + les composants ; `handle` traite les interactions
 * (boutons, menus, modals) dont le customId appartient au module.
 */
export interface ConfigPanel {
  render(ctx: BotContext, guildId: string): Promise<{ embed: EmbedBuilder; components: PanelRow[] }>;
  handle(args: PanelHandlerArgs): Promise<void>;
}

/**
 * Gestionnaire d'interactions de composants (boutons, menus, modals) hors
 * `/config` : un module déclare le préfixe de customId qu'il possède (avant le
 * premier `|`) et reçoit toutes les interactions correspondantes.
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
 * Un module pluggable. Chaque dossier `src/modules/<nom>/` exporte par défaut
 * un objet conforme à cette interface ; le loader le découvre automatiquement.
 */
export interface BotModule {
  /** Identifiant stable, utilisé comme clé en base. Ex. "levels". */
  name: string;
  /** Clé i18n du nom affiché (ex. dans `/config`). */
  labelKey: string;
  /** Clé i18n de la description. */
  descriptionKey: string;
  /** Module système non désactivable (ex. "core"). */
  internal?: boolean;
  commands?: SlashCommand[];
  events?: EventListener[];
  tasks?: ScheduledTask[];
  /** Schéma zod validant la config par serveur de ce module. */
  configSchema?: ZodType;
  /** Config par défaut appliquée à l'activation. */
  defaultConfig?: unknown;
  /** Champs éditables depuis le dashboard web (optionnel). */
  configUI?: ConfigUI;
  /** Panneau de configuration interactif affiché dans `/config` (optionnel). */
  configPanel?: ConfigPanel;
  /** Gestionnaire d'interactions de composants hors `/config` (optionnel). */
  componentHandler?: ComponentHandler;
  onLoad?(ctx: BotContext): Promise<void>;
  onUnload?(ctx: BotContext): Promise<void>;
}

/** Helper préservant le typage au site de déclaration d'un module. */
export function defineModule(module: BotModule): BotModule {
  return module;
}
