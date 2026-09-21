import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  MessageFlags,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createLogger } from './logger.js';
import { handleInteractionError, safeRun } from './errors.js';
import { contextFor } from './context.js';
import { scheduler } from './scheduler.js';
import { recordCommand, recordInteraction } from './metrics.js';
import { DEFAULT_LOCALE, currentLocale, runWithLocale, t } from './i18n.js';
import {
  canonicalCommandJSON,
  canonicalizeInteraction,
  commandPayloadFor,
  resetCommandLocales,
} from './command-locale.js';
import { withGuildLocale } from './guild-locale.js';
import type { BotContext, BotModule, SlashCommand, TaskReport } from './module.js';

const log = createLogger('loader');

/**
 * Au-delà, une commande a dépassé le délai de réponse de Discord (3 s) ou s'en
 * approche : l'utilisateur a vu « L'application ne répond pas », et on veut
 * savoir laquelle sans attendre qu'il le signale.
 */
const SLOW_COMMAND_MS = 2_500;

/**
 * Au-delà, une tâche est lente.
 *
 * La plupart tournent à la minute : passé une minute, la suivante part avant
 * que celle-ci ait fini et deux passages finissent par se marcher dessus. Une
 * tâche qui attend volontairement (étalement, longue série d'appels réseau)
 * relève son propre seuil avec `slowMs`, sinon elle s'alerterait elle-même.
 */
const SLOW_TASK_MS = 60_000;

/**
 * Ce qu'une tâche a réellement fait, compteurs à zéro retirés.
 *
 * Rend `null` pour un passage à vide — aucun compteur, ou tous nuls. C'est ce
 * `null` qui décide du niveau de la ligne de fin : un journal qui répète
 * « Tâche terminée » toutes les minutes pour dire « rien » coûte sa place dans
 * le tampon et dans l'archive, et noie les lignes qui, elles, disaient quelque
 * chose.
 */
function taskWork(report: TaskReport | void): TaskReport | null {
  if (!report) return null;
  const done: TaskReport = {};
  for (const [key, value] of Object.entries(report)) {
    if (typeof value === 'number' && value !== 0) done[key] = value;
  }
  return Object.keys(done).length > 0 ? done : null;
}

/** Le nom complet d'une commande, sous-commande comprise (`gacha tirer`). */
function commandPath(interaction: ChatInputCommandInteraction): string {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  // Seulement la STRUCTURE de l'appel : les valeurs d'options sont des données
  // d'utilisateur (pseudo cherché, motif de sanction…) et n'ont rien à faire
  // dans un journal d'exploitation gardé un mois.
  return [interaction.commandName, group, sub].filter(Boolean).join(' ');
}

/**
 * Le serveur concerné par un évènement Discord, quel qu'il soit.
 *
 * Les payloads n'ont pas de forme commune — un `Message` porte `guildId`, un
 * `GuildMember` porte `guild`, un `VoiceState` les deux, un `User` aucun des
 * deux. Le cœur n'a pourtant besoin que d'une chose : dans quelle langue ce
 * traitement doit parler. On prend donc le premier argument qui sait le dire,
 * et `undefined` (langue par défaut) quand aucun ne le sait — un évènement
 * hors serveur n'a pas de langue de serveur.
 */
function guildIdOf(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const candidate = arg as { guildId?: unknown; guild?: { id?: unknown } | null };
    if (typeof candidate.guildId === 'string') return candidate.guildId;
    const id = candidate.guild?.id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

// src/core/loader.ts -> src/modules   ||   dist/core/loader.js -> dist/modules
const modulesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules');

const MODULE_ENTRY_FILES = ['index.js', 'index.mjs', 'index.ts'];

/** Registre des modules découverts au démarrage. */
export interface ModuleRegistry {
  modules: BotModule[];
  /** Commandes indexées par leur nom. */
  commands: Map<string, SlashCommand>;
  /** Nom de commande -> nom du module qui la fournit. */
  commandModule: Map<string, string>;
}

let currentRegistry: ModuleRegistry | null = null;

/** Renvoie le dernier registre chargé. */
export function getRegistry(): ModuleRegistry | null {
  return currentRegistry;
}

/** Découvre et charge tous les modules présents dans `src/modules/`. */
export async function loadModules(): Promise<ModuleRegistry> {
  resetCommandLocales();
  const registry: ModuleRegistry = {
    modules: [],
    commands: new Map(),
    commandModule: new Map(),
  };

  if (!existsSync(modulesDir)) {
    log.warn({ modulesDir }, 'Dossier de modules introuvable');
    return registry;
  }

  const directories = readdirSync(modulesDir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  for (const directory of directories) {
    const entryFile = MODULE_ENTRY_FILES.map((file) => join(modulesDir, directory.name, file)).find(
      (candidate) => existsSync(candidate),
    );

    if (!entryFile) {
      log.warn({ module: directory.name }, 'Aucun fichier index trouvé, module ignoré');
      continue;
    }

    const imported: unknown = await import(pathToFileURL(entryFile).href);
    const botModule = (imported as { default?: BotModule }).default;

    if (!botModule || typeof botModule.name !== 'string') {
      log.warn({ module: directory.name }, 'Export par défaut invalide, module ignoré');
      continue;
    }

    registry.modules.push(botModule);

    for (const command of botModule.commands ?? []) {
      // Le nom de référence est celui de la langue par défaut : c'est sous ce
      // nom-là que la commande est indexée, journalisée et mesurée, quelle que
      // soit la langue dans laquelle un serveur la voit.
      const name = canonicalCommandJSON(command).name;
      if (registry.commands.has(name)) {
        log.error({ command: name, module: botModule.name }, 'Commande en double, ignorée');
        continue;
      }
      registry.commands.set(name, command);
      registry.commandModule.set(name, botModule.name);
    }

    log.debug(
      { module: botModule.name, commands: botModule.commands?.length ?? 0 },
      'Module chargé',
    );
  }

  currentRegistry = registry;
  // Un récapitulatif plutôt que 43 lignes à relire : au redémarrage, la seule
  // question est « tout est-il bien là ? », et un compte y répond d'un coup
  // d'œil. Les modules muets sont nommés — un module sans commande ni tâche ni
  // évènement est plus souvent un oubli qu'un choix.
  const idle = registry.modules
    .filter(
      (m) =>
        (m.commands?.length ?? 0) === 0 &&
        (m.tasks?.length ?? 0) === 0 &&
        (m.events?.length ?? 0) === 0 &&
        !m.componentHandler,
    )
    .map((m) => m.name);
  log.info(
    {
      modules: registry.modules.length,
      commands: registry.commands.size,
      tasks: registry.modules.reduce((total, m) => total + (m.tasks?.length ?? 0), 0),
      ...(idle.length > 0 ? { sansPoint: idle } : {}),
    },
    'Modules chargés',
  );
  return registry;
}

/**
 * Construit le payload JSON des slash commands pour l'API Discord, dans une
 * langue donnée.
 *
 * Le déploiement se fait **par serveur** (voir `src/index.ts`) : chacun reçoit
 * donc ses commandes dans la langue qu'il a choisie au dashboard, noms compris.
 * Sans langue, c'est le français — le cas du déploiement global, qui ne vise
 * aucun serveur en particulier.
 */
export function buildCommandPayload(
  registry: ModuleRegistry,
  locale: string = DEFAULT_LOCALE,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commandPayloadFor(registry.commands.values(), locale);
}

/** Enregistre les listeners d'évènements déclarés par les modules. */
export function registerModuleEvents(
  client: Client,
  ctx: BotContext,
  registry: ModuleRegistry,
): void {
  for (const module of registry.modules) {
    for (const listener of module.events ?? []) {
      const exec = listener.execute as (
        ctx: BotContext,
        ...rest: unknown[]
      ) => Promise<void> | void;
      const moduleCtx = contextFor(ctx, module.name);
      const handler = (...args: unknown[]): void => {
        // Pas de ligne par évènement : `messageCreate` seul en produirait des
        // milliers par minute et noierait tout le reste. Seules les erreurs
        // parlent, et elles portent désormais le module.
        //
        // La langue du serveur enveloppe le listener : un message de bienvenue
        // ou une alerte de modération sort dans la langue choisie sans que le
        // module ait à la chercher.
        void safeRun(() => withGuildLocale(guildIdOf(args), async () => exec(moduleCtx, ...args)), {
          event: String(listener.name),
          module: module.name,
        });
      };
      const bind = client[listener.once ? 'once' : 'on'].bind(client) as (
        event: string,
        fn: (...args: unknown[]) => void,
      ) => unknown;
      bind(listener.name, handler);
    }
  }
}

/**
 * Démarre les tâches planifiées déclarées par les modules.
 *
 * **Le journal ne retient que les passages qui ont fait quelque chose.** Une
 * quinzaine de modules planifient des tâches, la plupart à la minute : encadrer
 * chaque passage d'un « démarrée » et d'un « terminée » en `info` remplissait le
 * hublot de dizaines de milliers de lignes par jour qui disaient toutes la même
 * chose — que le planificateur tourne — et repoussait hors du tampon celles qui
 * racontaient un fait. Le début et les passages à vide descendent donc en
 * `debug` : ils restent lisibles en `LOG_LEVEL=debug` quand on soupçonne une
 * tâche de ne plus partir, sans encombrer l'exploitation ni l'archive.
 *
 * Ce qui monte en `info`, c'est le passage qui a produit un effet, avec ses
 * chiffres (`{ remis: 3 }`) : c'est la question qu'on pose vraiment aux logs
 * d'un bot — « est-ce que l'import de cette nuit est passé, et qu'a-t-il
 * ramené ? ». Les tâches le disent en rendant un {@link TaskReport}.
 */
export function startModuleTasks(ctx: BotContext, registry: ModuleRegistry): void {
  for (const module of registry.modules) {
    const moduleCtx = contextFor(ctx, module.name);
    for (const task of module.tasks ?? []) {
      scheduler.register(`${module.name}:${task.name}`, task.cron, async () => {
        const startedAt = Date.now();
        moduleCtx.logger.debug({ task: task.name }, 'Tâche démarrée');
        try {
          // Une tâche ne concerne pas UN serveur : elle les parcourt. Elle part
          // donc dans la langue par défaut, et pose celle de chaque serveur au
          // fil de sa boucle (`useGuildLocale`). L'enveloppe borne cet effet à
          // la tâche : la langue posée par l'une ne déborde pas sur la suivante.
          const report = await runWithLocale(DEFAULT_LOCALE, () => task.execute(moduleCtx));
          const ms = Date.now() - startedAt;
          const work = taskWork(report);
          const fields = { task: task.name, ms, ...work };
          if (ms >= (task.slowMs ?? SLOW_TASK_MS)) {
            // Une tâche lente parle même les mains vides : c'est le passage qui
            // n'a rien trouvé mais a mis quarante secondes à s'en apercevoir
            // qu'on veut voir venir, pas celui qui a travaillé.
            moduleCtx.logger.warn(fields, 'Tâche lente');
          } else if (work) {
            moduleCtx.logger.info(fields, 'Tâche terminée');
          } else {
            moduleCtx.logger.debug(fields, 'Tâche terminée');
          }
        } catch (error) {
          // On log ici plutôt que de laisser `safeRun` le faire : le message y
          // gagne le module, le nom de la tâche et le temps passé avant la
          // chute. L'erreur ne remonte pas — le scheduler doit survivre.
          moduleCtx.logger.error(
            { err: error, task: task.name, ms: Date.now() - startedAt },
            'Tâche en échec',
          );
        }
      });
    }
  }
}

/** Exécute les hooks `onLoad` des modules. */
export async function runOnLoadHooks(ctx: BotContext, registry: ModuleRegistry): Promise<void> {
  for (const module of registry.modules) {
    if (module.onLoad) {
      const moduleCtx = contextFor(ctx, module.name);
      await safeRun(() => module.onLoad?.(moduleCtx), { hook: 'onLoad', module: module.name });
    }
  }
}

/**
 * Branche le routeur d'interactions central : dispatch des slash commands et
 * de l'autocomplétion vers la bonne commande, avec vérifications (serveur,
 * module activé) et gestion d'erreurs.
 */
export function registerInteractionRouter(
  client: Client,
  ctx: BotContext,
  registry: ModuleRegistry,
): void {
  client.on('interactionCreate', (interaction: Interaction) => {
    // Toute la suite — dispatch, refus, réponse d'erreur — parle dans la langue
    // du serveur. La poser ici, une fois, dispense les 1 200 appels à `t()` des
    // modules de la connaître : ils la retrouvent par le contexte asynchrone.
    void withGuildLocale(
      interaction.guildId,
      () => routeInteraction(interaction, ctx, registry),
      interaction.guild?.preferredLocale,
    );
  });
}

/**
 * Rend à l'interaction ses noms français avant tout dispatch.
 *
 * Un serveur réglé en anglais s'est vu déployer `/rank`, et c'est `rank` que
 * Discord renvoie : sans cette ligne, le registre — indexé en français — ne
 * trouverait aucune commande de ce nom. La langue est celle que
 * `registerInteractionRouter` vient de poser autour du traitement.
 */
function canonicalize(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  registry: ModuleRegistry,
): void {
  canonicalizeInteraction(
    interaction,
    registry.commands.values(),
    currentLocale() ?? DEFAULT_LOCALE,
  );
}

async function routeInteraction(
  interaction: Interaction,
  ctx: BotContext,
  registry: ModuleRegistry,
): Promise<void> {
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    recordInteraction(interaction.isModalSubmit() ? 'modal' : 'component');
    // Dispatch vers le module propriétaire du préfixe du customId.
    const prefix = interaction.customId.split('|')[0] ?? '';
    const owner = registry.modules.find((m) => m.componentHandler?.prefix === prefix);
    const handler = owner?.componentHandler;
    if (!handler || !owner) {
      // Un composant sans propriétaire ne fait rien et ne disait rien : c'est
      // exactement le symptôme d'un préfixe renommé ou d'un vieux message
      // encore en salon, et il valait un aller-retour dans le code pour être
      // diagnostiqué.
      log.warn({ prefix, customId: interaction.customId }, 'Composant sans module propriétaire');
      return;
    }
    const moduleCtx = contextFor(ctx, owner.name);
    const startedAt = Date.now();
    try {
      await handler.handle(interaction, moduleCtx);
      moduleCtx.logger.info(
        {
          customId: interaction.customId,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          ms: Date.now() - startedAt,
        },
        'Composant traité',
      );
    } catch (error) {
      moduleCtx.logger.error(
        { err: error, customId: interaction.customId, ms: Date.now() - startedAt },
        'Composant en échec',
      );
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    recordInteraction('autocomplete');
    canonicalize(interaction, registry);
    const command = registry.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    // Pas de ligne de succès : l'autocomplétion part à chaque frappe, et une
    // ligne par lettre rendrait le journal illisible. Seul l'échec parle.
    const owner = registry.commandModule.get(interaction.commandName);
    try {
      await command.autocomplete(interaction, owner ? contextFor(ctx, owner) : ctx);
    } catch (error) {
      (owner ? contextFor(ctx, owner).logger : log).error(
        { err: error, command: interaction.commandName },
        'Erreur d’autocomplétion',
      );
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  recordInteraction('command');
  canonicalize(interaction, registry);

  const command = registry.commands.get(interaction.commandName);
  if (!command) {
    log.warn(
      { command: interaction.commandName, guildId: interaction.guildId },
      'Commande inconnue reçue',
    );
    return;
  }

  const moduleName = registry.commandModule.get(interaction.commandName);
  const module = registry.modules.find((candidate) => candidate.name === moduleName);
  const moduleCtx = moduleName ? contextFor(ctx, moduleName) : ctx;
  const path = commandPath(interaction);

  if ((command.guildOnly ?? true) && !interaction.inGuild()) {
    // Les refus se tracent aussi : « la commande ne fait rien » a plus souvent
    // pour cause un module désactivé qu'un bug, et sans ligne on ne peut pas
    // faire la différence depuis le dashboard.
    moduleCtx.logger.debug(
      { command: path, userId: interaction.user.id },
      'Commande refusée : hors serveur',
    );
    await interaction.reply({
      content: t('errors.guildOnly'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (module && !module.internal && interaction.guildId) {
    const enabled = await ctx.config.isEnabled(interaction.guildId, module.name);
    if (!enabled) {
      moduleCtx.logger.info(
        { command: path, guildId: interaction.guildId, userId: interaction.user.id },
        'Commande refusée : module désactivé',
      );
      await interaction.reply({
        content: t('errors.moduleDisabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  // Deux instrumentations complémentaires sur un seul chronomètre : le
  // monitoring agrège (combien, quelle part en échec, laquelle est lente), le
  // journal raconte (quelle commande, quel serveur, quel auteur, quand). L'un
  // dit qu'une commande échoue souvent, l'autre laquelle a échoué à 14 h 03.
  const startedAt = Date.now();
  try {
    await command.execute(interaction, moduleCtx);
    const ms = Date.now() - startedAt;
    recordCommand(interaction.commandName, moduleName ?? null, ms, true);
    const fields = { command: path, guildId: interaction.guildId, userId: interaction.user.id, ms };
    if (ms >= SLOW_COMMAND_MS) {
      moduleCtx.logger.warn(fields, 'Commande lente');
    } else {
      moduleCtx.logger.info(fields, 'Commande exécutée');
    }
  } catch (error) {
    const ms = Date.now() - startedAt;
    recordCommand(interaction.commandName, moduleName ?? null, ms, false);
    await handleInteractionError(interaction, error, {
      module: moduleName,
      command: path,
      ms,
    });
  }
}
