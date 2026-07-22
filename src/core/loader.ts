import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type Client,
  type Interaction,
  MessageFlags,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createLogger } from './logger.js';
import { handleInteractionError, safeRun } from './errors.js';
import { scheduler } from './scheduler.js';
import { t } from './i18n.js';
import { handleConfigInteraction, isConfigCustomId } from './config-panel.js';
import type { BotContext, BotModule, SlashCommand } from './module.js';

const log = createLogger('loader');

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

/** Renvoie le dernier registre chargé (utilisé par `/config`). */
export function getRegistry(): ModuleRegistry | null {
  return currentRegistry;
}

/** Découvre et charge tous les modules présents dans `src/modules/`. */
export async function loadModules(): Promise<ModuleRegistry> {
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
      const name = command.data.name;
      if (registry.commands.has(name)) {
        log.error({ command: name, module: botModule.name }, 'Commande en double, ignorée');
        continue;
      }
      registry.commands.set(name, command);
      registry.commandModule.set(name, botModule.name);
    }

    log.info(
      { module: botModule.name, commands: botModule.commands?.length ?? 0 },
      'Module chargé',
    );
  }

  currentRegistry = registry;
  return registry;
}

/** Construit le payload JSON des slash commands pour l'API Discord. */
export function buildCommandPayload(
  registry: ModuleRegistry,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [...registry.commands.values()].map((command) => command.data.toJSON());
}

/** Enregistre les listeners d'évènements déclarés par les modules. */
export function registerModuleEvents(
  client: Client,
  ctx: BotContext,
  registry: ModuleRegistry,
): void {
  for (const module of registry.modules) {
    for (const listener of module.events ?? []) {
      const exec = listener.execute as (ctx: BotContext, ...rest: unknown[]) => Promise<void> | void;
      const handler = (...args: unknown[]): void => {
        void safeRun(() => exec(ctx, ...args), {
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

/** Démarre les tâches planifiées déclarées par les modules. */
export function startModuleTasks(ctx: BotContext, registry: ModuleRegistry): void {
  for (const module of registry.modules) {
    for (const task of module.tasks ?? []) {
      scheduler.register(`${module.name}:${task.name}`, task.cron, () => task.execute(ctx));
    }
  }
}

/** Exécute les hooks `onLoad` des modules. */
export async function runOnLoadHooks(ctx: BotContext, registry: ModuleRegistry): Promise<void> {
  for (const module of registry.modules) {
    if (module.onLoad) {
      await safeRun(() => module.onLoad?.(ctx), { hook: 'onLoad', module: module.name });
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
    void routeInteraction(interaction, ctx, registry);
  });
}

async function routeInteraction(
  interaction: Interaction,
  ctx: BotContext,
  registry: ModuleRegistry,
): Promise<void> {
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    if (isConfigCustomId(interaction.customId)) {
      await handleConfigInteraction(interaction, ctx, registry);
      return;
    }
    // Composants hors `/config` : dispatch vers le module propriétaire du préfixe.
    const prefix = interaction.customId.split('|')[0] ?? '';
    const handler = registry.modules.find((m) => m.componentHandler?.prefix === prefix)
      ?.componentHandler;
    if (handler) {
      await safeRun(() => handler.handle(interaction, ctx), {
        kind: 'component',
        customId: interaction.customId,
      });
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = registry.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction, ctx);
    } catch (error) {
      log.error({ err: error, command: interaction.commandName }, 'Erreur d’autocomplétion');
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = registry.commands.get(interaction.commandName);
  if (!command) {
    log.warn({ command: interaction.commandName }, 'Commande inconnue reçue');
    return;
  }

  if ((command.guildOnly ?? true) && !interaction.inGuild()) {
    await interaction.reply({
      content: t('errors.guildOnly'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const moduleName = registry.commandModule.get(interaction.commandName);
  const module = registry.modules.find((candidate) => candidate.name === moduleName);

  if (module && !module.internal && interaction.guildId) {
    const enabled = await ctx.config.isEnabled(interaction.guildId, module.name);
    if (!enabled) {
      await interaction.reply({
        content: t('errors.moduleDisabled'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    await command.execute(interaction, ctx);
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}
