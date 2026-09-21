import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { DEFAULT_LOCALE, normalizeLocale, runWithLocale } from './i18n.js';
import { createLogger } from './logger.js';
import type { CommandData, SlashCommand } from './module.js';

const log = createLogger('i18n');

/** Le payload d'une commande, tel qu'il part vers Discord. */
type CommandJSON = RESTPostAPIChatInputApplicationCommandsJSONBody;

/**
 * Un nœud du payload, réduit à ce qui nous intéresse ici.
 *
 * Les types de `discord-api-types` distinguent quinze formes d'option selon
 * qu'elles portent des choix, des bornes ou des types de salon. On ne lit que
 * ce que toutes ont : un nom, un type, et parfois des enfants.
 */
interface OptionNode {
  name: string;
  type: number;
  description?: string;
  required?: boolean;
  options?: OptionNode[];
  choices?: { name: string; value: string | number }[];
}

/**
 * Ce que Discord accepte comme nom de commande, de sous-commande ou d'option :
 * lettres, chiffres, tiret et souligné, 32 caractères au plus. Les accents
 * passent (`\p{L}`), les espaces et les majuscules non.
 */
const NAME_PATTERN = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

/** Limite Discord sur une description de commande ou d'option. */
const DESCRIPTION_MAX = 100;

/** Une commande dans une langue, avec son original français en regard. */
interface LocalizedCommand {
  /** Le payload de référence, construit dans la langue par défaut. */
  canonical: CommandJSON;
  /** Le même, construit dans la langue voulue — l'original si elle a échoué. */
  localized: CommandJSON;
}

interface LocaleBundle {
  list: LocalizedCommand[];
  /** Nom TRADUIT -> la commande, pour retrouver l'original à l'arrivée. */
  byName: Map<string, LocalizedCommand>;
}

/**
 * Le payload français de chaque commande, construit une fois.
 *
 * Clé faible sur la commande elle-même : le registre est reconstruit au
 * rechargement des modules, et rien ne doit survivre à l'ancien.
 */
const canonicalCache = new WeakMap<SlashCommand, CommandJSON>();

/** Les payloads par langue, construits à la première demande. */
const bundles = new Map<string, LocaleBundle>();

/** Oublie tout ce qui a été construit (rechargement des modules, tests). */
export function resetCommandLocales(): void {
  bundles.clear();
}

/**
 * Les métadonnées d'une commande dans la langue ambiante.
 *
 * Une fabrique est rejouée, un builder est rendu tel quel — c'est ce qui laisse
 * cohabiter les deux formes de `SlashCommand.data`.
 */
export function commandData(command: SlashCommand): CommandData {
  return typeof command.data === 'function' ? command.data() : command.data;
}

/** Cette commande sait-elle se reconstruire dans une autre langue ? */
function isTranslatable(command: SlashCommand): boolean {
  return typeof command.data === 'function';
}

/** Le payload français d'une commande, construit une fois puis mémorisé. */
export function canonicalCommandJSON(command: SlashCommand): CommandJSON {
  const cached = canonicalCache.get(command);
  if (cached) return cached;
  const json = runWithLocale(DEFAULT_LOCALE, () => commandData(command).toJSON());
  canonicalCache.set(command, json);
  return json;
}

function children(node: CommandJSON | OptionNode): OptionNode[] {
  return (node.options as OptionNode[] | undefined) ?? [];
}

/**
 * Les deux arbres ont-ils la même forme ?
 *
 * On ne compare que ce qu'une traduction n'a pas le droit de changer : le
 * nombre d'options, leur ordre, leur type, leur caractère obligatoire et la
 * VALEUR de leurs choix. Le texte, lui, doit différer — c'est le but. Une forme
 * qui bouge trahit un builder dont le code dépend de la langue : on le déploie
 * alors en français plutôt que d'envoyer à Discord un payload dont on ne sait
 * plus rien dire.
 */
function sameShape(
  canonical: CommandJSON | OptionNode,
  localized: CommandJSON | OptionNode,
): boolean {
  const a = children(canonical);
  const b = children(localized);
  if (a.length !== b.length) return false;
  for (const [index, option] of a.entries()) {
    const other = b[index];
    if (!other) return false;
    if (option.type !== other.type) return false;
    if ((option.required ?? false) !== (other.required ?? false)) return false;
    const choicesA = option.choices ?? [];
    const choicesB = other.choices ?? [];
    if (choicesA.length !== choicesB.length) return false;
    for (const [rank, choice] of choicesA.entries()) {
      if (choice.value !== choicesB[rank]?.value) return false;
    }
    if (!sameShape(option, other)) return false;
  }
  return true;
}

/**
 * Tous les noms et descriptions de cet arbre sont-ils déployables ?
 *
 * Une traduction est du texte écrit à la main dans un fichier JSON : elle peut
 * arriver avec une majuscule, un espace, un point, ou dépasser les 100
 * caractères de description. Discord refuse alors le PUT **en entier** — les
 * quarante autres commandes du serveur avec. On vérifie donc avant d'envoyer,
 * et le message nomme le fautif.
 */
function namesAreValid(node: CommandJSON | OptionNode, path: string, locale: string): boolean {
  const seen = new Set<string>();
  let valid = true;
  for (const option of children(node)) {
    const where = `${path} ${option.name}`.trim();
    if (!NAME_PATTERN.test(option.name) || option.name !== option.name.toLowerCase()) {
      log.error({ locale, name: option.name, command: path }, 'Nom traduit refusé par Discord');
      valid = false;
    }
    if (seen.has(option.name)) {
      // Deux options traduites par le même mot : Discord refuse, et le sens
      // se perd de toute façon pour celui qui tape la commande.
      log.error({ locale, name: option.name, command: path }, 'Nom traduit en double');
      valid = false;
    }
    seen.add(option.name);
    if (option.description !== undefined && option.description.length > DESCRIPTION_MAX) {
      log.error(
        { locale, command: where, length: option.description.length },
        'Description traduite trop longue',
      );
      valid = false;
    }
    if (!namesAreValid(option, where, locale)) valid = false;
  }
  return valid;
}

/** Le payload d'une commande dans une langue, ou `null` si on doit s'abstenir. */
function translate(
  command: SlashCommand,
  canonical: CommandJSON,
  locale: string,
): CommandJSON | null {
  if (!isTranslatable(command)) return null;

  let localized: CommandJSON;
  try {
    localized = runWithLocale(locale, () => commandData(command).toJSON());
  } catch (error) {
    // Les builders de discord.js valident le nom et la longueur des textes :
    // une traduction hors clous jette ici, et c'est la seule commande touchée.
    log.error(
      { err: error, command: canonical.name, locale },
      'Commande intraduisible, laissée en français',
    );
    return null;
  }

  if (!NAME_PATTERN.test(localized.name) || localized.name !== localized.name.toLowerCase()) {
    log.error({ locale, name: localized.name }, 'Nom de commande traduit refusé par Discord');
    return null;
  }
  if (localized.description !== undefined && localized.description.length > DESCRIPTION_MAX) {
    log.error(
      { locale, command: localized.name, length: localized.description.length },
      'Description traduite trop longue',
    );
    return null;
  }
  if (!sameShape(canonical, localized)) {
    log.error({ locale, command: canonical.name }, 'Forme de commande différente selon la langue');
    return null;
  }
  if (!namesAreValid(localized, localized.name, locale)) return null;

  return localized;
}

/** Les commandes d'une langue, construites à la première demande puis gardées. */
function bundleFor(commands: Iterable<SlashCommand>, locale: string): LocaleBundle {
  const wanted = normalizeLocale(locale);
  const cached = bundles.get(wanted);
  if (cached) return cached;

  const list: LocalizedCommand[] = [];
  const byName = new Map<string, LocalizedCommand>();
  let untranslated = 0;

  for (const command of commands) {
    const canonical = canonicalCommandJSON(command);
    let localized =
      wanted === DEFAULT_LOCALE ? canonical : (translate(command, canonical, wanted) ?? canonical);
    if (localized !== canonical && byName.has(localized.name)) {
      // Deux commandes traduites par le même nom : Discord refuserait le PUT
      // entier. Celle-ci reste en français plutôt que d'emporter les autres.
      log.error(
        { locale: wanted, name: localized.name, command: canonical.name },
        'Nom de commande traduit en double',
      );
      localized = canonical;
    }
    if (localized === canonical && wanted !== DEFAULT_LOCALE) untranslated += 1;
    const entry: LocalizedCommand = { canonical, localized };
    list.push(entry);
    byName.set(localized.name, entry);
    // Le nom français reste une entrée valide : les commandes déjà déployées
    // sur un serveur qui vient de changer de langue arrivent encore sous leur
    // ancien nom, le temps que Discord prenne le nouveau jeu.
    if (!byName.has(canonical.name)) byName.set(canonical.name, entry);
  }

  if (untranslated > 0) {
    log.warn({ locale: wanted, commands: untranslated }, 'Commandes laissées en français');
  }

  const bundle: LocaleBundle = { list, byName };
  bundles.set(wanted, bundle);
  return bundle;
}

/**
 * Le nom DÉPLOYÉ de chaque commande dans une langue, indexé par son nom
 * français.
 *
 * Métriques et journal ne connaissent qu'un seul nom, le français : c'est tout
 * l'objet de `canonicalizeInteraction`, et c'est ce qui les garde comparables
 * d'un serveur à l'autre. Un panneau qui les affiche a pourtant à les nommer
 * comme le membre les tape — sinon le dashboard en anglais annonce `/rang` à
 * quelqu'un dont le serveur n'a jamais vu que `/rank`.
 *
 * La table se construit sur les payloads du déploiement, pas sur une lecture de
 * clés à part : elle ne peut donc pas annoncer un nom que Discord n'a pas reçu
 * — une commande laissée en français faute de traduction valable se nomme ici
 * en français, comme elle se tape.
 */
export function commandNamesFor(
  commands: Iterable<SlashCommand>,
  locale: string,
): Map<string, string> {
  return new Map(
    bundleFor(commands, locale).list.map((entry) => [entry.canonical.name, entry.localized.name]),
  );
}

/** Le payload complet des slash commands dans une langue. */
export function commandPayloadFor(commands: Iterable<SlashCommand>, locale: string): CommandJSON[] {
  return bundleFor(commands, locale).list.map((entry) => entry.localized);
}

/**
 * Renomme en place les options reçues vers leurs noms français.
 *
 * On avance en parallèle dans l'arbre déployé et dans l'arbre français : à
 * position égale, même option. Chercher par nom dans une table plate suffirait
 * neuf fois sur dix, mais pas si deux options d'une même commande se traduisent
 * par le mot qu'une autre porte déjà en français.
 */
function renameTree(nodes: OptionNode[], localized: OptionNode[], canonical: OptionNode[]): void {
  for (const node of nodes) {
    const index = localized.findIndex((option) => option.name === node.name);
    if (index === -1) continue;
    const source = canonical[index];
    if (!source) continue;
    node.name = source.name;
    const inner = node.options;
    if (inner && inner.length > 0) {
      renameTree(inner, localized[index]?.options ?? [], source.options ?? []);
    }
  }
}

/**
 * Rend à une interaction ses noms français, avant que le module la voie.
 *
 * Un serveur réglé en anglais s'est vu déployer `/rank member:@toto` : Discord
 * renvoie ces noms-là, tels qu'il les a publiés. Les modules, eux, sont écrits
 * en français (`sub === 'demarrer'`, `getUser('membre')`) et le resteront — les
 * traduire un à un serait refaire les quarante-trois modules à chaque langue
 * ajoutée. Le cœur retraduit donc à l'entrée, exactement comme il pose déjà la
 * langue ambiante autour du traitement.
 *
 * C'est aussi ce qui garde le journal et les métriques comparables d'un serveur
 * à l'autre : une commande y porte un seul nom, le français.
 */
export function canonicalizeInteraction(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  commands: Iterable<SlashCommand>,
  locale: string,
): void {
  const wanted = normalizeLocale(locale);
  if (wanted === DEFAULT_LOCALE) return;

  const entry = bundleFor(commands, wanted).byName.get(interaction.commandName);
  if (!entry || entry.localized === entry.canonical) return;

  // `options.data` est gelé en surface : le tableau ne bouge pas, les nœuds
  // qu'il contient si — et `_hoistedOptions` pointe sur ces mêmes nœuds, donc
  // les renommer ici suffit à ce que `getUser('membre')` retrouve son option.
  const resolver = interaction.options as unknown as {
    _group: string | null;
    _subcommand: string | null;
    data: OptionNode[];
  };

  renameTree(resolver.data, children(entry.localized), children(entry.canonical));

  // `_group` et `_subcommand` sont des COPIES des noms, faites à la
  // construction du resolver : les renommer dans l'arbre ne les touche pas. On
  // les recalcule comme discord.js le fait lui-même.
  let level = resolver.data;
  let group: string | null = null;
  let subcommand: string | null = null;
  if (level[0]?.type === ApplicationCommandOptionType.SubcommandGroup) {
    group = level[0].name;
    level = level[0].options ?? [];
  }
  if (level[0]?.type === ApplicationCommandOptionType.Subcommand) {
    subcommand = level[0].name;
  }
  resolver._group = group;
  resolver._subcommand = subcommand;

  (interaction as { commandName: string }).commandName = entry.canonical.name;
}
