# Contribuer à Vakz-Bot

Merci de votre intérêt ! Ce document décrit les conventions du projet.

## Prérequis

- Node.js 24+
- npm

## Mise en route

```bash
npm install
cp .env.example .env   # renseignez vos secrets (jamais committés)
npx prisma migrate dev
npm run dev
```

## Conventions de code

- **TypeScript strict** : pas de `any` non justifié (règle `no-explicit-any`
  en `error`). Si un `any` est inévitable, isolez-le et commentez la raison.
- **oxlint + Prettier** sont la source de vérité du style. Avant tout commit :

  ```bash
  npm run format
  npm run lint
  npm run typecheck
  ```

- Fonctions courtes, nommage explicite, **gestion d'erreurs systématique**
  (rien ne doit faire crasher le process — passez par les helpers de `core/errors.ts`).
- **i18n** : aucun texte utilisateur en dur. Ajoutez vos clés dans
  `locales/fr/<module>.json` **et** `locales/en/<module>.json`, puis utilisez
  `t('clé')`. `npm run i18n:check` refuse une clé appelée qui n'existe pas et un
  désaccord entre les deux langues de référence.
  Une tâche planifiée qui parcourt les serveurs pose la langue de chacun en tête
  d'itération (`await useGuildLocale(guildId)`, `src/core/guild-locale.ts`) :
  sinon elle annonce en français à un serveur réglé en anglais. Commandes,
  composants et évènements n'ont rien à faire — le cœur s'en charge.
  Les **noms** de commandes, de sous-commandes et d'options sont du texte vu par
  les membres, donc traduits eux aussi : voir « Déclarer une slash command ».

## Architecture d'un module

Un module = un dossier `src/modules/<nom>/` avec un `index.ts` qui exporte par
défaut un objet `BotModule` (voir `src/core/module.ts`) :

```ts
import { defineModule } from '../../core/module.js';

export default defineModule({
  name: 'mon-module',
  labelKey: 'modules.monModule.label',
  descriptionKey: 'modules.monModule.description',
  commands: [/* SlashCommand[] */],
  events: [/* EventListener[] */],
  tasks: [/* ScheduledTask[] */],
});
```

Le loader découvre automatiquement le module : aucun branchement manuel dans le cœur.
Chaque module documente ses commandes et options de configuration.

### Déclarer une slash command

Les commandes sont déployées **par serveur, dans la langue de ce serveur** : un
serveur réglé en anglais voit `/rank member:@toto` là où son voisin garde
`/rang membre:@toto`. Deux conséquences pour qui écrit une commande.

**`data` est une fabrique, pas un builder.** Un builder écrit tel quel est
construit à l'import du module, hors de toute langue : ses textes partent figés
en français. Une fabrique peut être rejouée dans chaque langue.

```ts
export const rang: SlashCommand = {
  data: () =>
    new SlashCommandBuilder()
      .setName(t('modules.levels.noms.rang'))
      .setDescription(t('modules.levels.commands.rang.description'))
      .addUserOption((o) =>
        o
          .setName(t('modules.levels.noms.membre'))
          .setDescription(t('modules.levels.commands.rang.member')),
      ),
  async execute(interaction, ctx) {
    // Toujours le nom FRANÇAIS, sur tous les serveurs : le cœur retraduit
    // l'interaction avant de te la passer.
    const cible = interaction.options.getUser('membre') ?? interaction.user;
  },
};
```

**Les noms passent par `t()`, dans le bloc `noms` du module.** En français ils
se traduisent par eux-mêmes (`"membre": "membre"`) — c'est cette valeur-là qui
sert de nom de référence partout ailleurs : index du registre, `getUser('membre')`,
journal, métriques. Un nom doit rester un nom de commande Discord : minuscules,
ni espace ni point, 32 caractères au plus.

`npm run commandes:check` rejoue le déploiement à blanc dans toutes les langues
et refuse un nom que Discord rejetterait, deux options voisines traduites par le
même mot, une description qui dépasse 100 caractères, ou un builder resté figé.
À lancer dès qu'on touche à une commande : Discord, lui, refuse le jeu **entier**
au moment du déploiement.

### Déclarer les réglages d'un module

`configUI` décrit le formulaire que le dashboard affiche pour régler le module.
C'est là que vit l'essentiel de son texte : le titre de chaque bloc, le libellé
de chaque champ, le libellé de chaque choix, et l'**aide** qui dit à quoi le
réglage sert.

**`configUI` et `actions` sont des fabriques, pas des tableaux**, pour la même
raison que `data` plus haut — voir la règle dans [`CLAUDE.md`](./CLAUDE.md).

**Tout champ porte un `help`.** Le dashboard est le seul endroit où
l'administrateur peut apprendre ce que fait un réglage : sans aide, il le règle
au juger, et un champ mal réglé ne proteste pas. Ce qu'il faut y écrire : ce que
le réglage change **pour les membres**, ce qui se passe s'il reste vide ou à
zéro, et ce qui le rendrait inopérant (un intent manquant, un module voisin
éteint, une hiérarchie de rôles). Jamais la paraphrase du libellé — « Salon des
annonces : le salon des annonces » n'apprend rien.

```ts
export default defineModule({
  // …
  configUI: () => [
    {
      label: t('modules.monModule.ui.g0.label'),
      description: t('modules.monModule.ui.g0.description'),
      fields: [
        {
          key: 'channelId',
          label: t('modules.monModule.ui.g0.champs.channelId.label'),
          type: 'channel',
          help: t('modules.monModule.ui.g0.champs.channelId.help'),
        },
        {
          key: 'mode',
          label: t('modules.monModule.ui.g0.champs.mode.label'),
          type: 'select',
          help: t('modules.monModule.ui.g0.champs.mode.help'),
          // La VALEUR ne se traduit jamais — elle est lue par le module et
          // enregistrée en base. Seul le libellé change de langue.
          options: [
            { value: 'strict', label: t('modules.monModule.ui.g0.champs.mode.opt.strict.label') },
          ],
        },
      ],
    },
  ],
});
```

Les clés vivent sous `modules.<module>.ui.<bloc>.*`, dans
`locales/fr/<module>.json` **et** `locales/en/<module>.json`. `<bloc>` est la
`key` du groupe quand il en a une, sinon son rang (`g0`, `g1`…) — réordonner des
blocs sans clé déplace donc leurs textes, comme cela déplace déjà les
délégations de grade. Un bloc porte `label` et, s'il a un mécanisme à expliquer,
`description` ; un champ porte `label`, `help`, et selon son type `placeholder`,
`addLabel`, `item.<sous-champ>.label` et `opt.<valeur>.label`. Un sous-champ de
ligne se contente de son libellé : dans une liste de récompenses, « Rôle » n'a
rien à expliquer de plus.

Un bouton prend `modules.<module>.actions.<id>.*` (`label`, `help`, `champs.*`,
`msg.*`) : ce que rend son `run()` est lu par l'admin, donc se traduit aussi.

`npm run reglages:check` construit les réglages de chaque module dans toutes les
langues et refuse : un `configUI` ou des `actions` restés en tableau, un libellé
vide, une clé de traduction affichée telle quelle, une fabrique qui ne rend pas
deux fois la même chose, et une traduction qui change la **forme** des réglages
plutôt que leur texte (clé d'un champ, type, valeur d'un choix — tout ce que le
code lit). Il compte enfin les champs sans aide et les liste par module.

Un champ sans aide fait **échouer** la vérification. Les 222 champs du dépôt en
ont une, il n'y a donc plus rien à rattraper : la règle vaut d'emblée pour le
prochain champ écrit. `AIDES_TOLEREES`, en tête du script, existe pour qu'un cas
vraiment indéfendable soit écrit noir sur blanc avec son motif — elle est vide,
et le rester est le but.

### Journaliser

`ctx.logger` est **déjà le logger de ton module** : le loader lui attache le nom du
module (`scope`), qui devient une colonne et un critère de recherche dans le panneau
Logs du dashboard. Écris simplement `ctx.logger.warn({ guildId }, 'Salon introuvable')`
— pas besoin de `createLogger`, et surtout pas d'importer le `logger` racine, qui
produirait une ligne orpheline, impossible à rattacher à ton module.

Le cœur journalise déjà, pour **tous** les modules, ce qui se répète : commande
exécutée (avec sa durée), commande lente, commande refusée parce que le module est
désactivé, composant traité, tâche terminée / lente / en échec, configuration
enregistrée ou refusée, action du dashboard. Ne réécris pas ces lignes. Écris ce que
le cœur ne peut pas deviner : une décision métier, une ressource absente, une API
tierce qui refuse, un état incohérent.

#### Une tâche planifiée rend un compte-rendu, elle ne se journalise pas

Une quinzaine de modules planifient des tâches, la plupart à la minute. Si chacune
annonçait son départ et son arrivée, le journal compterait des dizaines de milliers
de lignes par jour disant toutes la même chose — que le planificateur tourne — et
les lignes qui racontaient un fait seraient poussées hors du tampon.

Une tâche rend donc des compteurs qu'elle nomme elle-même, et le cœur décide :

```ts
export const reminderTask: ScheduledTask = {
  name: 'deliver',
  cron: '* * * * *',
  async execute(ctx) {
    const { remis, perdus } = await deliverDueReminders(ctx);
    return { remis, perdus }; // → « Tâche terminée task=deliver remis=3 » en info
  },
};
```

- **Un compteur non nul** → une ligne `info` avec les chiffres.
- **Rien, ou tous les compteurs à zéro** → `debug` : le passage à vide reste
  lisible en `LOG_LEVEL=debug` quand on soupçonne une tâche de ne plus partir.
- **Un passage anormalement long** → `warn`, même les mains vides. Une tâche qui
  attend volontairement (étalement aléatoire, longue série d'appels réseau) relève
  son propre seuil avec `slowMs`, sinon elle s'alerterait elle-même.

Ne rapporte pas le travail de métronome — payer l'XP vocal à la minute, rééditer un
message de classement toutes les dix minutes — c'est le fonctionnement normal du
module, pas un évènement : le rapporter recrée exactement le bruit que le
compte-rendu sert à supprimer. Rapporte ce qui a eu lieu pour une raison (un rappel
remis, un tirage clôturé, une ligne purgée) et ce qui a échoué.

Les champs du premier argument sont mis à plat par le hublot du dashboard et
affichés à droite du message (`task=deliver ms=12 remis=3`) : ils sont aussi ce sur
quoi porte sa recherche.

Le niveau porte du sens, parce qu'il se coche dans le dashboard :

| Niveau  | Pour quoi                                                                    |
| ------- | ---------------------------------------------------------------------------- |
| `debug` | détail de mise au point, utile seulement quand on cherche                    |
| `info`  | un fait normal qu'on veut pouvoir retrouver (« import terminé, 412 ajouts ») |
| `warn`  | ça continue, mais quelqu'un devra s'en occuper (salon supprimé, quota bas)   |
| `error` | l'action demandée n'a pas eu lieu                                            |

Deux réflexes : mets les variables dans le **premier argument** (`{ guildId, count }`)
et non dans le texte — elles deviennent des champs cherchables ; et ne journalise
jamais de contenu de message, de valeur d'option de commande ni de jeton : l'archive
garde ces lignes un mois sur le disque du VPS.

### Modifier le schéma de base de données

```bash
# Éditez prisma/schema.prisma, puis :
npx prisma migrate dev --name description_courte
```

Restez compatible PostgreSQL : pas de SQL brut spécifique SQLite, et stockez les
structures en JSON sérialisé (champ `String`) validé par zod.

#### ⚠️ Les migrations sont **append-only** (jamais d'édition en place)

Une fois qu'une migration a pu être appliquée quelque part (un autre dev, un VPS,
la CI…), son fichier `migration.sql` est **gelé** : on ne le modifie plus jamais.
Pour corriger ou faire évoluer le schéma, on **crée une nouvelle migration**.

Pourquoi : en production, l'entrypoint Docker lance `prisma migrate deploy`, qui
applique uniquement les migrations dont le **nom** n'est pas encore enregistré dans
`_prisma_migrations`. Si on édite le contenu d'une migration **déjà appliquée**, son
nom est déjà connu → `migrate deploy` la **saute** et la correction n'atteint jamais
les bases existantes. On obtient alors une dérive silencieuse (`P2022 — column ...
does not exist`) impossible à rattraper sans intervention manuelle sur le volume.

```text
# ❌ Mauvais : rééditer 20260626120000_reminders/migration.sql (userId → targetKind)
# ✅ Bon : npx prisma migrate dev --name reminders_target_kind  (nouvelle migration ALTER TABLE)
```

Concrètement :

- **Avant** qu'une branche ne soit mergée et qu'une migration n'ait fuité hors de
  ton poste, tu peux encore la régénérer/squasher proprement.
- **Après**, toute évolution passe par une **nouvelle** migration additive
  (`ALTER TABLE … ADD COLUMN …`, etc.), portable SQLite **et** PostgreSQL.
- Ne « répare » pas un schéma au runtime via `$executeRawUnsafe`/`PRAGMA` : c'est
  spécifique à SQLite et ça contourne le suivi des migrations. La source de vérité
  reste `prisma/schema/migrations/`.

## Convention de commits — [Conventional Commits](https://www.conventionalcommits.org/)

Format : `type(scope): description`

Types courants : `feat`, `fix`, `docs`, `refactor`, `chore`, `build`, `test`, `perf`.

Exemples :

```
feat(levels): ajout de la courbe d'XP et des rôles récompense
fix(config): corrige la persistance de l'état d'un module
docs: complète la section sécurité du README
```

- **Commits atomiques** : un module / une feature par commit, pas de commit fourre-tout.
- Messages clairs, en français ou en anglais, cohérents.

## Workflow Git

- `main` est toujours fonctionnel.
- Développez chaque module/phase sur une branche dédiée puis ouvrez une **Pull Request**.
- Jamais de `force-push` sur `main`.

## Sécurité

- **Aucun secret dans Git.** Vérifiez avant chaque commit qu'aucun `.env`, `*.db`
  ni token n'est ajouté (`git status`, `git diff --cached`).
- Voir la section sécurité du [README](./README.md) en cas de fuite de token.
