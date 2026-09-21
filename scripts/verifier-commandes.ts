/**
 * Vérification des slash commands dans toutes les langues (`npm run commandes:check`).
 *
 * Les commandes sont déployées PAR SERVEUR, dans la langue de ce serveur : un
 * serveur réglé en anglais reçoit `/rank member:@toto` là où son voisin garde
 * `/rang membre:@toto`. Rien, à la compilation, ne dit qu'une traduction est
 * déployable — les contraintes sont celles de Discord, et il ne les fait valoir
 * qu'au moment du PUT, en refusant le jeu de commandes **en entier**.
 *
 * Ce script joue donc le déploiement à blanc, langue par langue :
 *
 * - le nom traduit est-il un nom de commande valide (minuscules, ni espace ni
 *   point, 32 caractères) ;
 * - deux options voisines ne se traduisent-elles pas par le même mot ;
 * - une description traduite tient-elle dans les 100 caractères ;
 * - la commande garde-t-elle la même FORME d'une langue à l'autre (c'est ce qui
 *   permet au cœur de retraduire les noms reçus vers le français).
 *
 * Il finit par un aller-retour sur un vrai resolver de discord.js : une
 * interaction arrivée en anglais doit redevenir française avant d'atteindre le
 * module, sans quoi `getSubcommand()` renverrait un nom que personne ne teste.
 */
import {
  ApplicationCommandOptionType,
  CommandInteractionOptionResolver,
  type CommandInteractionOption,
} from 'discord.js';
import {
  canonicalCommandJSON,
  canonicalizeInteraction,
  commandData,
} from '../src/core/command-locale.js';
import { DEFAULT_LOCALE, listLocales, runWithLocale } from '../src/core/i18n.js';
import { loadModules } from '../src/core/loader.js';

/** Ce que Discord accepte comme nom de commande, de sous-commande ou d'option. */
const NOM = /^[-_\p{L}\p{N}]{1,32}$/u;
const DESCRIPTION_MAX = 100;

interface Noeud {
  name: string;
  type?: number;
  description?: string;
  required?: boolean;
  options?: Noeud[];
  choices?: { name: string; value: string | number }[];
}

const erreurs: string[] = [];
const identiques: string[] = [];

function faute(locale: string, message: string): void {
  erreurs.push(`[${locale}] ${message}`);
}

function verifieNoms(noeud: Noeud, chemin: string, locale: string): void {
  const vus = new Set<string>();
  for (const option of noeud.options ?? []) {
    const ou = `${chemin} ${option.name}`;
    if (!NOM.test(option.name) || option.name !== option.name.toLowerCase()) {
      faute(locale, `nom refusé par Discord : « ${option.name} » dans ${chemin}`);
    }
    if (vus.has(option.name)) faute(locale, `deux fois le nom « ${option.name} » dans ${chemin}`);
    vus.add(option.name);
    const description = option.description ?? '';
    if (description.length === 0) faute(locale, `description vide : ${ou}`);
    if (description.length > DESCRIPTION_MAX) {
      faute(
        locale,
        `description de ${description.length} caractères (max ${DESCRIPTION_MAX}) : ${ou}`,
      );
    }
    verifieNoms(option, ou, locale);
  }
}

/** La traduction n'a le droit de changer que le texte, jamais la structure. */
function memeForme(fr: Noeud, autre: Noeud, chemin: string, locale: string): void {
  const a = fr.options ?? [];
  const b = autre.options ?? [];
  if (a.length !== b.length) {
    faute(locale, `${chemin} : ${a.length} option(s) en français, ${b.length} ici`);
    return;
  }
  for (const [index, option] of a.entries()) {
    const jumelle = b[index];
    if (!jumelle) continue;
    if (option.type !== jumelle.type)
      faute(locale, `${chemin} : type différent pour l'option ${index + 1}`);
    if ((option.required ?? false) !== (jumelle.required ?? false)) {
      faute(locale, `${chemin} ${option.name} : caractère obligatoire différent`);
    }
    const choixFr = option.choices ?? [];
    const choix = jumelle.choices ?? [];
    if (choixFr.length !== choix.length) {
      faute(
        locale,
        `${chemin} ${option.name} : ${choixFr.length} choix en français, ${choix.length} ici`,
      );
    } else {
      for (const [rang, choisi] of choixFr.entries()) {
        // La VALEUR d'un choix est lue par le code du module : elle ne se
        // traduit pas. Seul son libellé change de langue.
        if (choisi.value !== choix[rang]?.value) {
          faute(
            locale,
            `${chemin} ${option.name} : valeur de choix traduite (${String(choisi.value)})`,
          );
        }
      }
    }
    memeForme(option, jumelle, `${chemin} ${option.name}`, locale);
  }
}

const registry = await loadModules();
const commandes = [...registry.commands.values()];

for (const info of listLocales()) {
  const hauts = new Map<string, string>();
  for (const commande of commandes) {
    const fr = canonicalCommandJSON(commande) as Noeud;
    if (typeof commande.data !== 'function') {
      if (info.code === DEFAULT_LOCALE) {
        erreurs.push(
          `/${fr.name} : « data » est un builder, pas une fabrique — la commande partirait en français sur tous les serveurs`,
        );
      }
      continue;
    }

    let traduite: Noeud;
    try {
      traduite = runWithLocale(info.code, () => commandData(commande).toJSON()) as Noeud;
    } catch (error) {
      faute(info.code, `/${fr.name} : construction impossible — ${String(error)}`);
      continue;
    }

    if (!NOM.test(traduite.name) || traduite.name !== traduite.name.toLowerCase()) {
      faute(info.code, `nom de commande refusé par Discord : « ${traduite.name} »`);
    }
    const dejaPris = hauts.get(traduite.name);
    if (dejaPris && dejaPris !== fr.name) {
      faute(
        info.code,
        `/${dejaPris} et /${fr.name} se traduisent toutes deux par « ${traduite.name} »`,
      );
    }
    hauts.set(traduite.name, fr.name);
    if ((traduite.description ?? '').length > DESCRIPTION_MAX) {
      faute(
        info.code,
        `/${traduite.name} : description de ${(traduite.description ?? '').length} caractères (max ${DESCRIPTION_MAX})`,
      );
    }
    verifieNoms(traduite, `/${traduite.name}`, info.code);
    memeForme(fr, traduite, `/${fr.name}`, info.code);

    if (info.code !== DEFAULT_LOCALE && JSON.stringify(fr) === JSON.stringify(traduite)) {
      identiques.push(`[${info.code}] /${fr.name}`);
    }
  }
}

// Aller-retour sur un vrai resolver : c'est lui que les modules interrogent.
function allerRetour(): void {
  const bingo = commandes.find((commande) => canonicalCommandJSON(commande).name === 'bingo');
  if (!bingo || typeof bingo.data !== 'function') return;
  const anglais = runWithLocale('en', () => commandData(bingo).toJSON()) as Noeud;
  const sous = anglais.options?.[0];
  const option = sous?.options?.[0];
  if (!sous || !option) return;

  const brut = [
    {
      name: sous.name,
      type: ApplicationCommandOptionType.Subcommand,
      options: [{ name: option.name, type: ApplicationCommandOptionType.String, value: 'line' }],
    },
  ] as unknown as CommandInteractionOption[];
  // Le constructeur est privé côté types, public à l'exécution : c'est
  // exactement l'objet que discord.js pose sur une interaction.
  const Resolver = CommandInteractionOptionResolver as unknown as new (
    client: unknown,
    options: CommandInteractionOption[],
    resolved: unknown,
  ) => CommandInteractionOptionResolver;
  const options = new Resolver(null, brut, null);
  const interaction = { commandName: anglais.name, options };

  canonicalizeInteraction(interaction as never, commandes, 'en');

  if (interaction.commandName !== 'bingo') {
    erreurs.push(`aller-retour : /${anglais.name} n'est pas redevenu /bingo`);
  }
  if (options.getSubcommand(false) !== 'demarrer') {
    erreurs.push(
      `aller-retour : getSubcommand() rend « ${String(options.getSubcommand(false))} », pas « demarrer »`,
    );
  }
  if (options.getString('mode') !== 'line') {
    erreurs.push("aller-retour : getString('mode') ne retrouve pas son option");
  }
}
allerRetour();

console.log(
  `Commandes : ${commandes.length} · langues : ${listLocales()
    .map((l) => l.code)
    .join(', ')}`,
);
if (identiques.length > 0) {
  // Pas une faute : une langue communautaire a le droit d'être incomplète, et
  // `t()` retombe alors sur le français. Mais c'est ce qu'on veut voir.
  console.log(`Non traduites (repli sur le français) : ${identiques.join(', ')}`);
}
if (erreurs.length > 0) {
  console.error(`\n❌ ${erreurs.length} problème(s) :\n- ${erreurs.join('\n- ')}`);
  process.exit(1);
}
console.log('✅ Toutes les commandes sont déployables dans toutes les langues.');
