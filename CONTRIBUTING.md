# Contribuer à Vakz-Bot

Merci de votre intérêt ! Ce document décrit les conventions du projet.

## Prérequis

- Node.js 20+
- npm

## Mise en route

```bash
npm install
cp .env.example .env   # renseignez vos secrets (jamais committés)
npx prisma migrate dev
npm run dev
```

## Conventions de code

- **TypeScript strict** : pas de `any` non justifié (règle ESLint `no-explicit-any`
  en `error`). Si un `any` est inévitable, isolez-le et commentez la raison.
- **ESLint + Prettier** sont la source de vérité du style. Avant tout commit :

  ```bash
  npm run format
  npm run lint
  npm run typecheck
  ```

- Fonctions courtes, nommage explicite, **gestion d'erreurs systématique**
  (rien ne doit faire crasher le process — passez par les helpers de `core/errors.ts`).
- **i18n** : aucun texte utilisateur en dur. Ajoutez vos clés dans `locales/fr.json`
  (et idéalement `locales/en.json`) et utilisez `t('clé')`.

## Architecture d'un module

Un module = un dossier `src/modules/<nom>/` avec un `index.ts` qui exporte par
défaut un objet `BotModule` (voir `src/core/module.ts`) :

```ts
import { defineModule } from '../../core/module.js';

export default defineModule({
  name: 'mon-module',
  labelKey: 'modules.monModule.label',
  descriptionKey: 'modules.monModule.description',
  commands: [
    /* SlashCommand[] */
  ],
  events: [
    /* EventListener[] */
  ],
  tasks: [
    /* ScheduledTask[] */
  ],
});
```

Le loader découvre automatiquement le module : aucun branchement manuel dans le cœur.
Chaque module documente ses commandes et options de configuration.

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
  reste `prisma/migrations/`.

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
