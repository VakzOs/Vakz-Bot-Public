# Vakz-Bot

Vakz-Bot est un bot Discord **multi-serveurs**, **modulaire**, **auto-hébergé** et pensé comme une alternative libre aux gros bots généralistes. Tout se configure serveur par serveur depuis le **dashboard web** (voir [Dashboard web](#dashboard-web-configuration-à-distance)) : activation des modules, réglages détaillés et actions ponctuelles (publier un panneau, tester une alerte, envoyer un message…).

Le projet couvre aujourd'hui le socle, la communauté, la modération, la sécurité, les logs avancés, les tickets, les giveaways, les salons vocaux temporaires, la musique, les automatisations et les jeux.

## Sommaire

- [État actuel](#état-actuel)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Prérequis Discord](#prérequis-discord)
- [Installation locale](#installation-locale)
- [Déploiement VPS Docker](#déploiement-vps-docker)
- [Dashboard web (configuration à distance)](#dashboard-web-configuration-à-distance)
- [Musique (Lavalink)](#musique-lavalink)
- [Commandes slash](#commandes-slash)
- [Modules configurables](#modules-configurables)
- [Langues](#langues)
- [Permissions et intents](#permissions-et-intents)
- [Données persistantes](#données-persistantes)
- [Scripts npm](#scripts-npm)
- [Checklist de test](#checklist-de-test)

## État actuel

Bot en service : une quarantaine de modules activables et un peu plus de 70
commandes slash, réglés serveur par serveur depuis le dashboard web.

- **Configuration** — chaque serveur active les modules qu'il veut et les règle
  par formulaires, sans passer par le code. Quelques modules font exception :
  un catalogue partagé et ce que les membres y accumulent valent pour toute
  l'instance, pas par serveur — leur fiche dans
  [`docs/modules/`](docs/modules/) le précise.
- **Données** — SQLite via Prisma, migrations appliquées au démarrage du
  conteneur. Sauvegarde et restauration complètes par serveur, purge RGPD
  incluse.
- **Exploitation** — mise à jour à distance par `/maj` depuis le dashboard, ou
  automatique chaque nuit si `FORCE_UPDATE=true`. Logs de serveur avec boutons
  de rollback sur certains événements.
- **Langues** — français et anglais, français par défaut.

Le détail des fonctionnalités vit dans
[Modules configurables](#modules-configurables) et
[Commandes slash](#commandes-slash) : cette section ne les répète pas.

## Stack technique

| Domaine          | Choix                                |
| ---------------- | ------------------------------------ |
| Langage          | TypeScript strict                    |
| Runtime          | Node.js 24+                          |
| Discord          | discord.js v14                       |
| Base de données  | SQLite via Prisma                    |
| Scheduler        | node-cron                            |
| Validation env   | dotenv + zod                         |
| Logs applicatifs | pino                                 |
| Qualité          | oxlint + Prettier                    |
| Déploiement      | Docker Compose, compatible VPS ARM64 |

## Architecture

```text
src/
  core/       client, env, i18n, loader, config serveur, scheduler
  modules/    un dossier autonome par module
  lib/        helpers partagés
  index.ts    bootstrap du bot
prisma/       schema + migrations
locales/      un dossier par langue, un fichier par module
```

Chaque module exporte ses commandes, listeners, tâches planifiées, handlers de composants, champs de configuration (`configUI`) et actions (`actions`) rendus par le dashboard. Le loader découvre les modules au démarrage.

## Prérequis Discord

Dans le portail développeur Discord :

1. Crée une application puis un bot.
2. Copie le token dans `DISCORD_TOKEN`.
3. Copie l'Application ID dans `DISCORD_CLIENT_ID`.
4. Active les intents nécessaires :
   - **Server Members Intent** : arrivées/départs, rôles automatiques, anniversaires, vérification.
   - **Message Content Intent** : auto-modération, niveaux, commandes personnalisées, réactions de mots, starboard/logs avec contenu.
5. Invite le bot avec les scopes `bot` et `applications.commands`.

## Installation locale

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run deploy
npm run dev
```

Variables minimales dans `.env` :

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DATABASE_URL="file:./dev.db"
DEPLOY_COMMANDS_ON_START=true
TZ=Europe/Paris
```

`DISCORD_GUILD_ID` peut rester vide. Avec `DEPLOY_COMMANDS_ON_START=true`, le bot déploie ses commandes sur chaque serveur où il est présent, sans attendre la propagation globale.

## Déploiement VPS Docker

```bash
git clone <url-du-repo> Vakz-Bot
cd Vakz-Bot
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f bot
```

Au démarrage du conteneur, l'entrypoint applique les migrations Prisma avant de lancer le bot. Les données persistent dans `./data` (bind mount, base SQLite et fichiers `/maj`) et dans le volume `vakzbot-assets`.

#### Quand Discord ne répond pas

La connexion à la passerelle est **réessayée sur place** — 3 s, 6 s, 12 s… plafonné
à une minute — pendant une demi-heure au plus, chaque tentative laissant une
alerte dans les logs. Sortir au premier refus serait pire que la panne : le
superviseur relance le conteneur, qui remigre, recharge tous les modules et
retombe sur le même 503. C'est arrivé le 15 septembre 2026 — vingt minutes de
panne Discord, vingt-six redémarrages complets pour rien.

Deux erreurs restent fatales tout de suite, parce qu'aucune attente ne les
répare : un **token invalide** (401) et des **intents privilégiés refusés**.
Au-delà de la demi-heure, le bot sort aussi : passé ce délai, ce n'est
probablement plus un incident passager, et mieux vaut un process qui meurt
franchement qu'un process qui s'entête en silence.

> 🖥️ **Architectures** : fonctionne sur **x86_64** et **ARM64** (aarch64). Le
> `docker compose up --build` construit l'image **nativement** pour ta machine —
> l'image de base `node:24-bookworm-slim`, `@napi-rs/canvas` et Prisma fournissent les
> binaires des deux architectures. Aucun réglage spécifique à prévoir (le projet
> tourne en prod sur un VPS ARM Oracle Ampere).

Après une mise à jour :

```bash
git pull --ff-only
docker compose up -d --build
```

Si `DEPLOY_COMMANDS_ON_START=false`, redéploie les commandes manuellement :

```bash
docker compose exec bot npm run deploy:prod
```

### Mise à jour depuis le bot (`/maj`)

La commande `/maj`, réservée au **propriétaire** du bot, permet de déclencher un
`git pull` + `docker compose up -d --build` sans se connecter au serveur. Comme
le bot tourne dans un conteneur, il ne peut pas se reconstruire lui-même : il se
contente d'écrire une **demande** dans le volume partagé, et un petit **updater
côté hôte** exécute la mise à jour.

1. Renseigne `BOT_OWNER_ID` (ton ID Discord) dans `.env`. `DEPLOY_DIR` doit
   pointer sur le volume monte (par defaut `/app/data` cote conteneur). Le
   `docker-compose.yml` monte `./data:/app/data` : le bot et l updater hote
   voient donc les memes fichiers `deploy.*`.

   Si tu viens d une ancienne version avec le volume Docker nomme
   `vakzbot-data`, copie son contenu vers `./data` avant de redemarrer pour
   conserver `prod.db`.

2. Installe l'updater sur l'hôte (adapte les chemins/branche) :

   ```bash
   sudo cp scripts/systemd/vakzbot-update.{path,service} /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now vakzbot-update.path
   ```

   Le `.path` surveille l'apparition de `deploy.request` dans le dossier data et
   lance `vakzbot-updater.sh` (git pull + rebuild), qui réécrit `deploy.result`.
   Sans systemd, tu peux lancer `scripts/vakzbot-updater.sh loop` dans un `tmux`.

   Par défaut, l'updater met à jour **la branche extraite dans `REPO_DIR`** (ex.
   `main` en prod, ou une branche de test) — il fait
   `git pull origin <branche-courante>`. Pour forcer une branche précise,
   définis `BRANCH=<nom>` (variable d'env ou ligne `Environment=BRANCH=` du
   service systemd).

3. Dans Discord : `/maj` → choisis la **branche** dans le sélecteur (voir
   « D'où viennent les branches proposées » ci-dessous) → **Mettre à jour** → le bot enregistre la demande, se reconstruit
   puis redémarre. La branche choisie prime sur le défaut de l'updater. Quand il
   revient, il envoie une confirmation éphémère dans le salon où la demande a
   été confirmée ; le dernier résultat reste aussi visible au prochain `/maj`.

#### Mode complet ou mode rapide

Le panneau `/maj` porte un bouton qui bascule entre deux façons de reconstruire.
Le mode **complet** reste celui par défaut : on ne change rien tant qu'on n'a pas
cliqué.

| Mode                    | Ce que l'updater lance                               | Effet                                                                                                                                       |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐢 **Complet** (défaut) | `docker compose build` puis `up -d --force-recreate` | Tous les conteneurs du projet sont recréés. Le bot redémarre à coup sûr.                                                                    |
| ⚡ **Rapide**           | `docker compose build bot` puis `up -d bot`          | Seul le service `bot` est visé et le conteneur n'est recréé **que si l'image a changé**. Flaresolverr & co. ne sont pas balayés au passage. |

Le build est lancé **séparément** du démarrage, et ce n'est pas un détail de
présentation : `docker compose up -d --build` a été pris à sortir en **0** sur
un build raté (constructeur bake, 18/09/2026). L'updater déclarait alors la
mise à jour réussie, le conteneur continuait sur l'ancienne image, et trois
mises à jour se sont perdues sans que rien ne le signale. `docker compose
build` propage son code de sortie, lui — et par prudence l'updater relit aussi
sa sortie, parce qu'on sait maintenant qu'un code de sortie peut mentir. Le
conteneur n'est démarré que si les deux sont d'accord, et son état est vérifié
après coup.

Le cache de couches Docker sert dans les deux cas — c'est le comportement normal
de `--build`. Ce que le mode rapide enlève, c'est le `--force-recreate` : une
mise à jour qui ne change rien ne coupe donc pas le bot, et `/maj` répond alors
« terminé sans redémarrage » au lieu d'un avertissement. À l'inverse, le mode
complet reste le bon réflexe quand on soupçonne le cache (image de base à
rafraîchir, couche douteuse) ou qu'on veut simplement tout remettre à plat.

Le mode voyage dans `deploy.request` (champ `mode`). Un updater hôte plus ancien
que ce champ l'ignore et reconstruit comme avant : mettre le bot à jour avant
l'updater ne casse rien, ça ne fait que retarder le mode rapide.

> ⚠️ L'updater agit sur l'hôte (Docker) : garde `BOT_OWNER_ID` correct et le
> dossier data accessible uniquement à l'hôte.

### Suivre une mise à jour depuis le dashboard

Le panneau « Mise à jour » suit le déroulé en direct : les étapes de l'updater
(récupération, bascule de branche, alignement, reconstruction), le temps écoulé,
et **le journal au fil de l'eau**. Le bot lit pour cela `.deploy.log.tmp`, que
l'updater alimente pendant qu'il travaille et supprime en terminant — son
absence dit donc « rien en cours ».

Le sélecteur « Mode » y double celui des branches : mêmes deux modes que sur
`/maj`, complet par défaut. En mode complet, la mise à jour redémarre le bot :
le dashboard perd sa réponse pendant une poignée de secondes et l'annonce comme
telle (« il redémarre »), au lieu de présenter un silence attendu comme une
panne. En mode rapide, il n'y a souvent rien à perdre — le conteneur n'est
recréé que si l'image a changé. À la fin, le résultat affiche la
branche, le commit avant → après, et le journal complet — replié en cas de
succès, ouvert en cas d'échec, là où on le cherche.

### D'où viennent les branches proposées

Elles sont **lues sur le dépôt**, pas saisies à la main. Le conteneur du bot n'a
ni le dépôt ni les identifiants git : c'est l'**updater hôte** qui les lit
(`git ls-remote --heads origin`) et les dépose dans `deploy.branches`, le
dossier partagé. Lui confier un jeton d'accès au dépôt pour cette seule liste
aurait été un secret de plus à garder.

Deux moments de mise à jour :

- **à chaque `/maj`**, avant même le test « déjà à jour » — un `/maj` sans
  changement est justement le geste qu'on fait après avoir poussé une branche ;
- **à la demande** : le bouton 🔄 du panneau « Mise à jour » fait écrire au bot
  une demande `{"action":"branches"}` dans `deploy.request`. L'updater la
  reconnaît, publie la liste et s'arrête là : ni `git fetch`, ni reconstruction,
  ni redémarrage, et le résultat du dernier déploiement reste intact. La demande
  passe par ce fichier pour réutiliser l'unité systemd `.path` déjà installée —
  **rien à reconfigurer sur l'hôte**. Le bot attend la réponse une douzaine de
  secondes ; sans updater à l'écoute, le dashboard le dit au lieu de laisser
  croire à une liste à jour.

`DEPLOY_BRANCHES` (`.env`) n'est plus qu'une **liste de secours**, servie tant
qu'aucune récupération n'a eu lieu.

Ce qui protège reste le nom de branche lui-même : le bot refuse tout ce qui sort
de `[A-Za-z0-9._/-]` ou commence par un tiret (`--upload-pack=…` serait lu par
git comme une option — vecteur d'exécution de commande connu), et l'updater
refait cette validation, `git check-ref-format` compris, avant de toucher au
dépôt. Seul le propriétaire du bot peut déclencher une mise à jour, ou demander
la liste.

Une allowlist stricte reste possible côté hôte : si l'updater voit
`DEPLOY_BRANCHES` dans **son** environnement (`Environment=` du service
systemd), il refuse toute branche absente de cette liste-là.

### Mise à jour automatique nocturne (`FORCE_UPDATE`)

Par défaut, ton instance récupère **toute seule** les mises à jour publiées chaque
nuit : à l'heure de `FORCE_UPDATE_CRON` (2 h du matin, fuseau `TZ`) **plus un
délai aléatoire de 0 à 59 min** — la mise à jour tombe donc entre 2 h et 3 h — le
bot écrit exactement la même demande qu'un `/maj` sur `FORCE_UPDATE_BRANCH`, et
l'updater hôte enchaîne `git pull` + rebuild. Aucune commande à lancer, et pas
besoin de `BOT_OWNER_ID`.

| Variable              | Défaut      | Rôle                                                                                          |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `FORCE_UPDATE`        | `true`      | `false` (ou `0`) désactive complètement la mise à jour automatique — `/maj` reste disponible. |
| `FORCE_UPDATE_CRON`   | `0 2 * * *` | Heure de déclenchement (cron 5 champs, fuseau `TZ`).                                          |
| `FORCE_UPDATE_BRANCH` | `main`      | Branche récupérée.                                                                            |

- **Déjà à jour = rien ne bouge.** Quand le dépôt est déjà aligné sur
  `origin/<branche>`, l'updater s'arrête juste après le `git fetch` (état
  `up_to_date`) : ni rebuild, ni redémarrage. Un `/maj` manuel, lui, force
  toujours la reconstruction.
- **Prérequis : l'updater hôte** de la section précédente. Sans lui, la demande
  reste dans `data/deploy.request`, le bot le signale dans ses logs et n'empile
  pas les demandes des nuits suivantes.
- **Tu as forké le dépôt ?** Le `git pull` se fait depuis **ton** `origin` : un
  fork ne bouge pas tout seul. Le workflow `.github/workflows/auto-update.yml`
  réaligne chaque nuit ton fork sur `VakzOs/Vakz-Bot-Public` (fast-forward
  uniquement, jamais d'écrasement de tes commits). Pour le couper : _Settings →
  Secrets and variables → Actions → Variables_ → `FORCE_UPDATE` = `false`.

## Dashboard web (configuration à distance)

Le **dashboard web** (site Next.js séparé, déployé sur Vercel — voir le dépôt
`VakzBot-Web`) est le **seul point de configuration** du bot : activer/désactiver
les modules, éditer leur configuration via des formulaires, **publier/mettre à
jour les panneaux** (tickets, rôles-réactions, règlement, vérification, mode
streameur), lancer les **actions** d'un module (publier une note de patch,
tester une alerte, envoyer un message programmé, rafraîchir les compteurs, lier
un salon interserveurs…), déclencher `/maj` à distance (choix de branche + statut, réservé au
propriétaire), et **supprimer toutes les données d'un serveur** en un clic
(purge RGPD : données en base, messages/salons/webhooks créés par le bot, puis
le bot quitte le serveur).

L'API vérifie deux niveaux : le **token** partagé (« le site parle ») **et**
l'identité de l'utilisateur (en-tête `x-actor-id`) que le bot recoupe avec ses
propres droits (propriétaire du serveur / « Gérer le serveur » / propriétaire du
bot, plus les **grades** ci-dessous). On ne délègue donc pas l'autorisation au
seul site.

Le dashboard dialogue avec une petite **API HTTP** exposée par le bot :

1. Dans le `.env` du bot :

   ```
   WEB_API_TOKEN=<secret partagé>   # openssl rand -hex 32 ; vide = API désactivée
   WEB_API_PORT=3210
   ```

   Le `docker-compose.yml` publie ce port. L'API exige ce token
   (`Authorization: Bearer …`) sur toutes les routes sauf `/api/health`. Côté
   site (Vercel), on renseigne `BOT_API_URL`, `BOT_API_TOKEN` (le même secret)
   et `BOT_OWNER_ID`.

2. Chaque module déclare les champs éditables depuis le web via `configUI`
   (sélecteurs de salon/rôle, textes, booléens, listes…). Toute config reçue est
   **revalidée par zod** avant d'être persistée.

### Grades : déléguer une partie du dashboard (Réglages → Équipe)

L'entrée du dashboard était binaire : le propriétaire du serveur et les membres
qui ont **Gérer le serveur** pouvaient **tout** régler, les autres rien. Un
serveur qui voulait laisser ses modérateurs toucher à l'auto-modération devait
donc leur donner « Gérer le serveur » — c'est-à-dire aussi la sauvegarde, la
purge et les réglages du serveur Discord lui-même.

Le panneau **Équipe** (Réglages du serveur) laisse le propriétaire ou un
administrateur créer des **grades** : un nom qu'il choisit, ce que le grade
ouvre, et ce qui le confère. Les trois sont indépendants.

- **Un grade n'est pas un rôle Discord et n'en crée aucun.** Il se confère par
  des rôles Discord (le porter, c'est l'avoir ; le perdre, c'est le perdre), par
  des membres nommés un par un, ou par les deux. Un grade sans rôle ni membre
  existe et ne confère rien : c'est un brouillon.
- **Ce qu'il ouvre se compte à quatre mailles**, de la plus large à la plus
  fine :
  1. le **module** entier — `module:moderation` ;
  2. un **bloc de réglages** — `module:automod/spam` n'ouvre que l'anti-spam.
     Les blocs sont les groupes que le module déclare dans son `configUI` ;
  3. un **verbe** dans un bloc — `module:stickymessages/@0:creer` laisse
     ajouter un message épinglé sans toucher à ceux des autres. Six verbes, du
     plus inoffensif au plus lourd :

     | verbe        | ce qu'il ouvre                                 | quand il est proposé            |
     | ------------ | ---------------------------------------------- | ------------------------------- |
     | `lire`       | voir le bloc, sans rien enregistrer            | toujours                        |
     | `modifier`   | écrire ses champs et le contenu de ses lignes  | toujours                        |
     | `creer`      | ajouter une ligne                              | le bloc porte une liste         |
     | `supprimer`  | en retirer une                                 | le bloc porte une liste         |
     | `reordonner` | changer l'ordre des lignes                     | la liste déclare un `idKey`     |
     | `basculer`   | activer/désactiver une ligne, sans la réécrire | une ligne porte un interrupteur |

     Ils se **déduisent de la forme du bloc** : proposer `reordonner` là où les
     lignes n'ont pas d'identifiant serait promettre un réglage inapplicable —
     l'ordre y est leur seule identité ;

  4. un **bouton** — `module:stickymessages@repost` laisse republier un message
     sans rien pouvoir régler. Deux identifiants réservés : `@publier` (le
     panneau du module, `publishPanel`) et `@activer` (son interrupteur).

  S'y ajoutent deux portées transversales : `serveur.langue` (la langue dans
  laquelle le bot parle ici) et `serveur.sauvegarde`. Tout ce vocabulaire se
  **déduit du code chargé** : un module ajouté, un bloc renommé, un bouton
  nouveau apparaissent dans le panneau sans que rien ne les nomme ici.

- **L'interrupteur ne se déduit d'aucun bloc** : il allume ou éteint pour tout
  le serveur, et se délègue donc sous son propre nom (`@activer`) — de quoi
  laisser une équipe couper l'auto-modération pendant un raid sans lui confier
  une seule virgule de ses réglages.
- **Ce qui distribue le pouvoir ou l'exerce sans retour ne se délègue pas** : le
  panneau Équipe lui-même et la **purge** restent au propriétaire du serveur et
  aux administrateurs. Un gradé ne peut donc pas s'élargir.
- **Aucun grade = comportement d'avant, à l'identique.**

Les gardes sont **côté bot**, pas seulement côté site : `GET
/api/guilds/:id/modules` ne sert que les modules délégués à l'acteur, amputés
des blocs, des valeurs et des boutons qu'il n'a pas. Et l'enregistrement d'une
config ne refuse pas : il **repart de la config en place** et n'y rejoue que les
gestes permis — une ligne ajoutée sans le droit de créer est ignorée, une ligne
retirée sans le droit de supprimer revient, une ligne réécrite sans le droit de
modifier retrouve son texte. Quoi que contienne le corps de la requête. Masquer
un bouton dans le dashboard ne protégerait rien : une server action reste un
endpoint HTTP.

Les lignes s'apparient par leur `idKey` quand la liste en déclare un — exact
même après un réordonnancement. Sans identifiant, elles n'ont d'autre identité
que leur rang : retirer une ligne au milieu se lit alors comme « les suivantes
ont été réécrites, la dernière supprimée ». Le compte y est, les droits aussi ;
seul le récit diffère. `npm run check:acces` éprouve tout cela sur une base
jetable.

```
POST /api/access/me          { guildIds }  -> ce que l'acteur ouvre, serveur par serveur
GET  /api/guilds/:id/grades               -> ses droits ici, le vocabulaire, les grades
POST /api/guilds/:id/grades  { grades }   -> remplace les grades (admins seulement)
```

### Réglages d'instance (onglet « Réglages », propriétaire du bot)

Certains réglages ne valent pas pour un serveur mais pour **l'instance entière** :
ils vivent dans l'onglet « Réglages » du dashboard et n'apparaissent que pour
`BOT_OWNER_ID`. Masquer un panneau ne protège rien : leurs routes exigent le
propriétaire **en lecture comme en écriture** (`x-actor-id` recoupé par
`isOwner`, comme `/maj`). Le token partagé dit « le site parle », pas _qui_
parle — il ne suffit donc jamais seul sur ces routes : `/api/presence`,
`/api/restart`, `/api/tasks`, `/api/logs` et `/api/metrics`. D'autres se lisent avec le token
seul mais ne s'**écrivent** que par le propriétaire : `/api/deploy` et
`/api/items/limit`, plus ceux que déclarent certains modules. La
sauvegarde d'un serveur, elle, reste ouverte à qui peut gérer CE serveur.

- **🐾 Statuts du bot** — les « messages de profil » affichés sous le nom du bot
  (« fixe le vide intensément », « escalade les rideaux »). Un statut par ligne
  dans un champ multiligne ; le bot en tire **un au hasard à chaque démarrage**.
  La liste vit en base (`AppSetting`, clé `presence.lines`) ; vidée, elle revient
  à la liste d'origine de `src/core/presence.ts`. Enregistrer applique un statut
  tout de suite, sans attendre le prochain redémarrage.

  ```
  GET  /api/presence           -> { lines, defaults, current, maxLines, maxLength }
  POST /api/presence { lines } -> remplace la liste
  ```

- **📊 Monitoring** — l'état de santé de l'instance, en lecture seule : depuis
  quand le process tourne, ce qu'il consomme (mémoire, processeur, retard de la
  boucle d'évènements), ce que Discord répond (latence de la passerelle,
  serveurs, membres, requêtes et limites de débit) et ce que le bot exécute
  (commandes, interactions, alertes et erreurs, tâches planifiées, taille de la
  base).

  Deux natures de chiffres dans la même réponse, et les confondre rendrait les
  courbes fausses. Les **jauges** (mémoire, latence, serveurs) sont lues à
  l'instant de l'appel et se **moyennent** quand plusieurs mesures sont
  regroupées ; les **compteurs** (commandes, erreurs, requêtes) disent ce qui
  s'est produit _pendant_ un intervalle et s'**additionnent**.

  L'historique est **écrit en base** : il traverse les redémarrages du bot, ce
  qu'un tampon mémoire ne sait pas faire — et c'est justement après un plantage
  qu'on veut savoir si la mémoire montait déjà la veille. Une mesure toutes les
  **15 secondes**, gardée `METRICS_RETENTION_DAYS` jours (30 par défaut ; `0`
  désactive l'écriture et retombe sur une heure de tampon mémoire, ce que la
  réponse annonce dans `persistence`).

  Au-delà de **24 heures**, les mesures sont **fondues par tranches de cinq
  minutes** (colonne `span` = nombre de mesures fusionnées, jauges moyennées au
  prorata, compteurs additionnés). C'est ce qui rend un mois tenable : ~172 000
  lignes deviennent ~14 000, une dizaine de mégaoctets, et une période d'un mois
  se relit en une demi-seconde au lieu de plusieurs.

  La période se demande en **millisecondes** plutôt qu'en mots-clés : le
  dashboard propose aussi bien des fenêtres glissantes (« temps réel », « 1 h »)
  que des périodes de calendrier (« hier », « le mois »), et lui seul connaît le
  fuseau de l'administrateur — refaire ce calendrier côté bot le ferait dans le
  fuseau du VPS, qui n'est pas forcément le même.

  ```
  GET /api/metrics?from=<ms>&to=<ms>     (défaut : la dernière heure)
    -> { now, startedAt, sampleIntervalMs,
         window:      { from, to, bucketMs, samples, truncated },
         persistence: { enabled, retentionDays, stored, oldest },
         process, system, discord,
         totals:   (compteurs de la PÉRIODE, pas depuis le démarrage),
         commands: (cumul par commande, sur toute la vie de l'instance),
         tasks, modules, db,
         history: [{ t, rss, heap, cpu, lag, ping, guilds, members,
                     commands, interactions, errors, warnings, rest, rateLimits }] }
  ```

  L'historique est rendu en **au plus 240 points**, regroupés sur une grille de
  **temps** et non sur un nombre de lignes : les mesures n'ont pas toutes le même
  pas, et il en manque là où le bot était arrêté. Une grille de temps garde donc
  l'axe honnête et laisse un **trou** visible à l'endroit de la panne, au lieu de
  relier ses deux bords. `bucketMs` dit ce que vaut un point, `truncated` prévient
  quand une période trop chargée a dû être rognée par son début.

  Les compteurs sont alimentés là où tout passe déjà : le routeur d'interactions
  (`src/core/loader.ts`) pour les commandes — durée et issue comprises —, et la
  destination « dashboard » du logger pour les niveaux de log, de sorte qu'une
  erreur émise par un module comme par une dépendance compte pareil.

  Deux tables portent tout cela : `MetricSample` (les mesures, purgées et
  fondues) et `MetricCommand` (le cumul par commande, jamais purgé — « quelles
  commandes servent vraiment ? » est une question qui n'a de sens que sur la
  durée).

- **🔄 Redémarrage** — une cadence cron (`0 5 * * *` par défaut, désactivée) au
  terme de laquelle le bot **s'arrête proprement** : le même chemin que
  `SIGTERM` (Uptime Kuma prévenu d'une maintenance, tâches arrêtées, client
  Discord fermé, base déconnectée). Le bot **ne se relance pas lui-même** —
  c'est le superviseur qui le remonte : `restart: unless-stopped` du
  `docker-compose.yml`, ou l'unité systemd / pm2 d'une installation sans Docker.
  Lancé à la main dans un terminal, il resterait éteint. Un bouton
  « Redémarrer maintenant » déclenche la même chose sans attendre la cadence.

  ```
  GET  /api/restart                     -> { auto, cron, lastRestartAt, startedAt, scheduled, presets }
  POST /api/restart { auto, cron, now } -> règle la cadence ou redémarre
  ```

  L'expression est **validée avant d'être enregistrée** : le planificateur
  ignorant en silence ce qu'il ne comprend pas, on refuse plutôt que de laisser
  croire à un redémarrage programmé qui ne tomberait jamais. Le panneau affiche
  `scheduled`, c'est-à-dire ce que le planificateur exécute vraiment.

- **🚀 Mise à jour** — le `/maj` à distance : choix de la branche parmi
  `DEPLOY_BRANCHES`, statut de la demande en cours et résultat du dernier
  déploiement.

  ```
  GET  /api/deploy            -> { branches, status, result }
  POST /api/deploy { branch } -> écrit la demande pour l'updater hôte
  ```

- **📜 Logs** et **⏱️ Tâches planifiées** — une lecture seule sur les logs
  applicatifs du bot et sur les tâches cron réellement installées par le
  planificateur, avec leur module d'origine.

  Les logs se lisent à **deux distances**, derrière la même route. Sans `date`,
  c'est le tampon mémoire — les 500 dernières lignes, vidées à chaque
  redémarrage, pour « qu'est-ce qui vient de se passer ? ». Avec une `date`
  (`YYYY-MM-DD`), c'est l'**archive sur disque**, qui survit aux redémarrages et
  répond à « que s'est-il passé mardi ? ». Les deux acceptent `levels` (des
  niveaux cochés, ex. `warn,error`) et `search` (module, message ou erreur).
  La réponse dit toujours quelle source a répondu et ce que l'archive contient
  réellement, pour que le dashboard ne laisse jamais croire à un historique qui
  n'existe pas.

  ```
  GET /api/logs?limit=&levels=&date=&search=
    -> { source: 'buffer'|'archive', logs, capacity,
         archive: { enabled, retentionDays, minLevel, days, bytes } }
  GET /api/tasks
    -> { tasks: [{ name, cron, module }] }
  ```

  `level=` (seuil cumulatif `level >= N`) reste accepté pour les appelants
  antérieurs au multi-choix ; `levels=` le remplace et gagne quand les deux sont
  fournis.

#### Ce que le bot journalise

Le cœur instrumente **tous** les modules, sans qu'aucun ait à le demander : le
loader route déjà chaque commande, composant, tâche et évènement, et c'est là que
les lignes sont écrites. Un module ajouté demain en hérite sans une ligne de code.

| Évènement                            | Niveau           | Ce qu'on y lit                            |
| ------------------------------------ | ---------------- | ----------------------------------------- |
| Commande exécutée                    | `info`           | module, commande, serveur, auteur, durée  |
| Commande lente (≥ 2,5 s)             | `warn`           | idem — Discord coupe à 3 s                |
| Commande refusée (module désactivé)  | `info`           | pourquoi elle « ne fait rien »            |
| Commande en échec                    | `error`          | l'erreur, avec sa commande                |
| Composant traité / en échec          | `info` / `error` | customId, serveur, auteur, durée          |
| Composant sans module propriétaire   | `warn`           | préfixe orphelin (vieux message en salon) |
| Tâche démarrée / terminée / en échec | `info` / `error` | nom de la tâche et durée                  |
| Config enregistrée / refusée         | `info` / `warn`  | serveur, acteur, champs fautifs           |
| Action du dashboard                  | `info` / `error` | action, serveur, acteur, durée            |
| Modules chargés (démarrage)          | `info`           | compte de modules, commandes, tâches      |

Chaque ligne porte le **module émetteur** (`scope`) : c'est la colonne « module »
du dashboard et ce que trouve sa recherche. `ctx.logger` est déjà le logger du
module — voir [CONTRIBUTING.md](./CONTRIBUTING.md#journaliser) pour ce qu'un module
doit ajouter de son côté.

Ce qui n'est **jamais** journalisé, et ne doit pas l'être : le contenu des messages,
les valeurs d'options d'une commande (le pseudo cherché, le motif d'une sanction) et
les jetons. Seule la structure de l'appel est gardée — l'archive vit un mois sur le
disque du VPS et se lit depuis le dashboard.

Pas de ligne par évènement Discord (`messageCreate` seul en produirait des milliers
par minute), ni par frappe d'autocomplétion : là, seules les erreurs parlent.

Pour faire taire le battement de fond sans rien perdre des problèmes,
`LOG_LEVEL=warn` supprime les lignes de succès et garde alertes et erreurs.

#### Rétention des logs et espace disque

L'archive s'écrit dans `LOG_ARCHIVE_DIR` (défaut `./data/logs`, dans le volume
persistant), un fichier `YYYY-MM-DD.jsonl` par jour, purgé au-delà de
`LOG_RETENTION_DAYS` (défaut **30 jours**). La purge passe au démarrage et à
chaque changement de jour. `LOG_RETENTION_DAYS=0` désactive l'archive : le
dashboard retombe alors sur le seul tampon mémoire, et le dit.

Une ligne archivée pèse **150 à 250 octets** (souvent moins ; une ligne courte
tourne autour de 100). Le volume dépend surtout du trafic et des modules
actifs — pour une rétention de **30 jours** :

| Activité                         | Lignes/jour | Par jour | **Sur 30 jours** |
| -------------------------------- | ----------- | -------- | ---------------- |
| Petite instance (1-2 serveurs)   | ~1 000      | ~200 Ko  | **~6 Mo**        |
| Instance moyenne                 | ~5 000      | ~1 Mo    | **~30 Mo**       |
| Grosse instance, modules bavards | ~20 000     | ~4 Mo    | **~120 Mo**      |
| `LOG_LEVEL=debug` (déconseillé)  | ~100 000    | ~20 Mo   | **~600 Mo**      |

Autrement dit, à `LOG_LEVEL=info` — le défaut — un mois de rétention coûte
**quelques dizaines de mégaoctets**, négligeable à côté de la base et des
assets générés.

Deux leviers si le disque est compté. `LOG_RETENTION_DAYS` réduit la fenêtre
proportionnellement. `LOG_ARCHIVE_LEVEL` relève le plancher de ce qui est
archivé sans toucher à ce que voient stdout et le tampon : à `warn`, l'archive
ne garde plus que les alertes et les erreurs, soit typiquement **moins d'un
centième** du volume — au prix du contexte autour d'une erreur, qui est
justement ce qu'on vient y chercher. À n'utiliser que si le disque l'impose.

L'occupation réelle n'a pas à être devinée : le dashboard l'affiche, mesurée
sur l'instance (`archive.bytes`).

#### Rétention du monitoring et espace disque

Les mesures vivent en base (`MetricSample`), pas sur disque à part, et leur coût
n'est **pas linéaire** : les 24 premières heures gardent le pas de 15 secondes,
au-delà les mesures sont fondues en points de cinq minutes.

| Âge de la mesure | Pas conservé | Lignes/jour | Poids/jour |
| ---------------- | ------------ | ----------- | ---------- |
| Moins de 24 h    | 15 s         | 5 760       | ~2 Mo      |
| Au-delà de 24 h  | 5 min        | 288         | ~100 Ko    |

Un mois de rétention (`METRICS_RETENTION_DAYS=30`, le défaut) revient donc à
**une dizaine de mégaoctets** et ~14 000 lignes, là où garder tout au pas fin en
aurait fait 172 000. `METRICS_RETENTION_DAYS=0` coupe l'écriture : le panneau
retombe sur une heure de tampon mémoire, perdue à chaque redémarrage, et
l'annonce.

Rien n'est perdu de ce qui se lit à cette échelle : la fusion **additionne** les
compteurs (le total d'appels d'une journée reste exact) et **moyenne** les jauges
au prorata du nombre de mesures fondues. À noter : SQLite ne rend pas au système
les pages libérées par la purge — le fichier ne rétrécit pas, mais l'espace est
réutilisé.

Un réglage d'instance vit **hors de cet onglet** : le **plafond global
d'objets par serveur** (`null` = illimité) se règle depuis la page « Catalogue
d'objets », et en Discord via `/objets-limite`. Même garde propriétaire.
D'autres modules en ajoutent — leur fiche dans
[`docs/modules/`](docs/modules/) les décrit.

```
GET  /api/items/limit         -> { max }
POST /api/items/limit { max } -> fixe le plafond (propriétaire)
```

### Éditeur d'effets d'objets (`effectsUI`)

Même principe que `configUI`, appliqué aux **effets d'objets** (ce que fait un
objet via `/utiliser`) : le site ne connaît aucun type d'effet, il **génère son
éditeur** à partir d'un descripteur servi par le bot. Ajouter un effet ici le
fait donc apparaître sur le dashboard **sans toucher au dépôt du site**.

Le descripteur vit dans `src/modules/items/effects-ui.ts` et part avec le
catalogue :

```
GET /api/guilds/:id/items  ->  { items: [...], max: 25|null, effectsUI: [...] }
```

Une entrée d'`effectsUI` décrit un type d'effet :

```jsonc
{
  "type": "routeDamage", // doit exister dans l'union zod (effects-schema.ts)
  "label": "🎯 Dégâts sur la Route", // entrée du sélecteur de type
  "help": "Inflige des dégâts à un membre ciblé sur son voyage.",
  "target": "required", // none | required | option
  "fields": [
    {
      "key": "health",
      "label": "Dégâts infligés à la cible",
      "type": "number",
      "default": 20,
      "min": 1,
    },
  ],
}
```

- `target` dit si `/utiliser` attend un membre visé : `none` (aucune cible),
  `required` (cible obligatoire — c'est ce que lit `requiresTarget()`), `option`
  (cible facultative, l'effet s'applique sans elle).
- `fields[].type` choisit le contrôle affiché : `number` (entier, bornes `min` /
  `max`), `percent` (entier 0–100 avec suffixe « % »), `text` et `textarea`
  (`maxLength`), `role` (sélecteur de rôle du serveur), `item` (sélecteur
  d'objet du catalogue), `select` (choix fixes via `options`).
- `fields[].default` est la valeur posée à la création de l'effet. Elle doit
  satisfaire le schéma zod **dès lors qu'elle est significative** ; les champs
  sans défaut sensé (rôle, objet, texte obligatoire…) partent d'une valeur vide
  qui, elle, ne le satisfait pas : l'effet n'est valide qu'une fois le champ
  rempli, et un effet incomplet est **écarté silencieusement** à
  l'enregistrement (jamais persisté à moitié).
- `fields[].span` (1–6, défaut 6) règle la largeur du champ sur la grille de la
  ligne — par exemple `4` + `2` pour « objet à donner » + « quantité ».

Ajouter un effet = une entrée dans l'union de `effects-schema.ts`, un `case`
dans `applyItemEffects` (`effects.ts`), les libellés i18n, et une entrée dans
`effects-ui.ts`. Le dashboard suit tout seul.

Le site tolère un bot antérieur à ce descripteur : si `effectsUI` est absent,
l'éditeur d'effets est masqué (les effets déjà enregistrés sont conservés) ; un
effet d'un type qu'il ne connaît pas est affiché comme « inconnu » et gardé tel
quel plutôt que réécrit.

### HTTPS (ne pas exposer le token en clair)

Le token transitant entre Vercel et le VPS, place l'API derrière HTTPS. Deux
options.

#### Option A — Cloudflare Tunnel (recommandé, aucun port à ouvrir)

Le tunnel établit une connexion **sortante** vers Cloudflare : aucun port entrant
à ouvrir, HTTPS géré par Cloudflare. Nécessite un domaine géré par Cloudflare.

1. **Installer `cloudflared`** sur le VPS (Debian/Ubuntu) :

   ```bash
   # Dépôt officiel Cloudflare
   sudo mkdir -p --mode=0755 /usr/share/keyrings
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | \
     sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | \
     sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt update && sudo apt install -y cloudflared
   ```

   _(Alternative sans dépôt : télécharger le binaire `cloudflared-linux-<arch>`
   depuis les releases GitHub de `cloudflare/cloudflared` et le placer dans
   `/usr/local/bin`. En Docker : image `cloudflare/cloudflared`.)_

2. **Créer le tunnel** — le plus simple via le dashboard :
   [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks →
   Tunnels → Create a tunnel** → _Cloudflared_ → nomme-le. Cloudflare affiche une
   commande d'installation avec un **token** ; lance-la sur le VPS, par ex. :

   ```bash
   sudo cloudflared service install <TOKEN>
   # ou en conteneur :
   docker run -d --name cloudflared --restart unless-stopped \
     cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TOKEN>
   ```

3. **Router un sous-domaine vers l'API** : dans le tunnel → **Public Hostname →
   Add a public hostname** :

   - _Subdomain_ : `meowapi` · _Domain_ : ton domaine
   - _Service_ : **HTTP** → `http://172.17.0.1:3210` (passerelle Docker depuis le
     conteneur `cloudflared`) ou `http://localhost:3210` si `cloudflared` tourne
     en réseau `host`. Reprends la même adresse d'hôte que tes autres routes.

   Cloudflare crée le DNS + le certificat automatiquement.

4. **Côté Vercel** : `BOT_API_URL = https://meowapi.<ton-domaine>` puis redéploie.
   Teste : `https://meowapi.<ton-domaine>/api/health` → `{"ok":true}`.

> 🔒 Le **token du tunnel** est un secret : ne le committe pas. En cas de fuite,
> régénère-le (tunnel → _Refresh token_) et relance le connecteur.

#### Option B — Caddy (reverse-proxy auto-TLS)

Renseigne `CADDY_DOMAIN` + `CADDY_EMAIL` dans `.env`, fais pointer un DNS A vers
le VPS, ouvre les ports **80/443**, puis :

```bash
docker compose --profile proxy up -d
```

`BOT_API_URL` devient `https://<CADDY_DOMAIN>`.

Une fois l'API derrière HTTPS (option A ou B), **ferme le port `3210`** sur le
pare-feu : il n'a plus besoin d'être exposé.

### Options avancées (`.env`, tout optionnel)

- **Heartbeat Uptime Kuma** — `UPTIME_PUSH_URL` (URL d'un moniteur « Push », sans
  ses paramètres) + `UPTIME_PUSH_INTERVAL` (30 s par défaut). Le bot ping le
  moniteur, et signale une « maintenance » lors d'un `/maj` plutôt qu'une panne.
- **Intent Presence** — `PRESENCE_INTENT=true` active la détection en **temps
  réel** des changements de profil **global** (nom / photo) dans le journal des profils.
  Nécessite d'activer aussi « Presence Intent » dans le Developer Portal (Bot),
  sinon le bot refuse de démarrer. Sans lui, seuls le pseudo et l'avatar de
  serveur sont détectés en direct.

## Musique (Lavalink)

Le module **Musique** joue de l'audio dans les salons vocaux. La lecture est
déléguée à un serveur **[Lavalink](https://lavalink.dev) v4** (le bot lui-même
ne décode pas l'audio) : il faut donc un serveur Lavalink joignable. Sans lui,
le module reste chargé mais les commandes répondent qu'il n'est pas disponible.

Sources prises en charge d'origine : **YouTube** (via le plugin officiel
`youtube-source`), **SoundCloud**, **Bandcamp**, **Twitch**, **Vimeo** et les
liens HTTP directs. Le plugin **LavaSrc** est également inclus dans la config
Lavalink fournie, ce qui ajoute **Spotify** (`spsearch`) et **Deezer**
(`dzsearch`) — Spotify demande simplement des identifiants (voir
[Spotify / Deezer](#spotify--deezer-lavasrc)). Le sélecteur de plateforme se
choisit dans le dashboard web.

### Option A — Docker Compose (recommandé)

Un service `lavalink` est fourni (profil **`music`**), préconfiguré avec le
plugin YouTube (`deploy/lavalink/application.yml`) :

```bash
# 1) Dans .env :
LAVALINK_HOST=lavalink
LAVALINK_PASSWORD=un-mot-de-passe-solide   # openssl rand -hex 16
COMPOSE_PROFILES=music                      # active le profil en permanence

# 2) Démarre le bot AVEC le serveur Lavalink :
docker compose up -d
```

Le serveur Lavalink n'est **pas exposé** à l'hôte : le bot y accède en interne
(`http://lavalink:2333`). Compte ~**512 Mo de RAM** supplémentaires (réglable
via `_JAVA_OPTIONS` dans le compose).

> 🔄 **Mise à jour `/maj`** : l'updater lance `docker compose up -d` **sans** `--profile`.
> Renseigne donc `COMPOSE_PROFILES=music` dans `.env` (comme
> ci-dessus) pour que Lavalink soit démarré et maintenu automatiquement à chaque
> mise à jour. Sinon, lance-le une fois à la main avec
> `docker compose --profile music up -d` : grâce à `restart: unless-stopped`, il
> survit ensuite aux `/maj` et aux redémarrages, mais un `/maj` ne le relancera
> pas s'il est totalement arrêté. (Combine avec Caddy au besoin :
> `COMPOSE_PROFILES=music,proxy`.)

Sans le profil `music`, le bot tourne normalement et le module musique reste
simplement inactif.

#### Vérifier que Lavalink est prêt

Le conteneur est « running » bien avant d'écouter : il lui faut une bonne minute
pour démarrer la JVM puis télécharger ses plugins. Pendant ce temps, le bot se
prend des `ECONNREFUSED` — c'est normal, il retente tout seul. Une sonde donne
l'état réel :

```bash
docker compose --profile music ps lavalink
```

- `starting` — démarrage en cours, laisse-lui sa minute.
- `healthy` — Lavalink répond, le bot se connectera au prochain essai.
- `unhealthy` — il ne répond plus après trois minutes : regarde pourquoi avec
  `docker compose --profile music logs --tail=50 lavalink`. La cause la plus
  fréquente est une source LavaSrc activée sans ses identifiants (`LAVASRC_DEEZER=true`
  sans `DEEZER_MASTER_KEY`, par exemple), qui empêche Lavalink de démarrer.

> Docker **ne redémarre pas** un conteneur `unhealthy` : la sonde est un voyant,
> pas un filet. Le filet est côté bot, qui retente indéfiniment.

### Option B — Lavalink autonome / externe

Fais tourner Lavalink ailleurs (binaire, autre conteneur, hébergeur) puis
renseigne dans `.env` :

```env
LAVALINK_HOST=127.0.0.1      # ou le domaine du serveur Lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=…          # identique à application.yml côté Lavalink
LAVALINK_SECURE=false        # true si TLS (wss/https) devant Lavalink
```

### Spotify / Deezer (LavaSrc)

Le plugin **LavaSrc** est déjà déclaré dans `deploy/lavalink/application.yml`, mais
Spotify et Deezer sont **désactivés par défaut** — car LavaSrc **refuse de démarrer**
si une source est activée sans ses identifiants (Deezer exige une _master key_).
YouTube / SoundCloud fonctionnent sans rien de tout ça.

Chaque source est **opt-in** via une variable d'env :

- **Spotify** (`spsearch`) — crée une application sur le
  [dashboard développeur Spotify](https://developer.spotify.com/dashboard) puis, dans `.env` :

  ```env
  LAVASRC_SPOTIFY=true
  SPOTIFY_CLIENT_ID=…
  SPOTIFY_CLIENT_SECRET=…
  ```

- **Deezer** (`dzsearch`) — nécessite une _master key_ de déchiffrement
  (**obligatoire**, sinon Lavalink crashe) :

  ```env
  LAVASRC_DEEZER=true
  DEEZER_MASTER_KEY=…
  ```

Ces variables sont transmises au conteneur `lavalink` par le compose ; en
Lavalink autonome, mets-les plutôt dans le `application.yml` de ton serveur. Comme
Spotify/Apple ne diffusent pas l'audio directement, LavaSrc retrouve chaque titre
(par ISRC ou par nom) sur **YouTube/SoundCloud** pour la lecture. Une fois activées,
choisis la plateforme dans le dashboard → Musique.

### YouTube sur un VPS (OAuth)

Sur une **IP de datacenter** (VPS Oracle, AWS…), YouTube exige souvent une
connexion pour lire une vidéo — les logs Lavalink affichent alors
`This video requires login`. La parade est d'authentifier Lavalink avec un
**compte Google** (OAuth) :

1. Dans `.env` : `YOUTUBE_OAUTH=true`, puis recrée Lavalink
   (`docker compose up -d --force-recreate lavalink`).
2. Suis les logs : `docker compose logs -f lavalink`. Le plugin affiche un lien
   `https://www.google.com/device` + un **code** — ouvre-le et autorise avec un
   **compte Google jetable** (⚠️ pas ton compte principal : YouTube peut le limiter).
3. Lavalink logue alors un **refresh token** : copie-le dans
   `YOUTUBE_OAUTH_REFRESH_TOKEN` (`.env`) et recrée Lavalink → l'auth devient
   permanente (plus besoin de refaire le code au redémarrage).

Alternative sans YouTube : **SoundCloud** (et Spotify pour la recherche) ne
souffrent pas de ce blocage — tu peux simplement mettre SoundCloud en plateforme
par défaut.

### Réglages du module (dashboard → Musique)

Rôle **DJ** (réserve les commandes de contrôle ; vide = tout le monde), **volume**
par défaut et maximum, **plateforme de recherche** par défaut, exiger d'être dans
le **même salon** vocal que le bot, et **quitter automatiquement** en fin de file.

> Intent requis : `GuildVoiceStates` (non privilégié, déjà activé). Aucun intent
> privilégié supplémentaire n'est nécessaire pour la musique.

## Commandes slash

| Commande                                                                 | Module                    | Usage                                                                                  |
| ------------------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------- |
| `/ping`                                                                  | Cœur                      | Affiche la latence du bot.                                                             |
| `/maj`                                                                   | Mise à jour               | Met à jour le bot (git pull + rebuild via l'updater hôte). Propriétaire only.          |
| `/rang`                                                                  | Niveaux                   | Affiche le niveau, l'XP et le rang d'un membre.                                        |
| `/classement`                                                            | Niveaux                   | Classement XP du serveur.                                                              |
| `/warn`, `/kick`, `/ban`, `/unban`                                       | Modération                | Sanctions et levée de ban.                                                             |
| `/timeout`, `/untimeout`                                                 | Modération                | Timeout Discord et retrait du timeout.                                                 |
| `/sanctions`                                                             | Modération                | Casier de sanctions d'un membre.                                                       |
| `/purger`                                                                | Logs                      | Supprime des messages récents, avec logs.                                              |
| `/invitations`                                                           | Logs                      | Qui a invité qui : classement ou bilan d'un membre. Permission : gérer le serveur.     |
| `/report`                                                                | Signalements              | Signale un membre au staff, avec raison et lien de message optionnel.                  |
| `/jeux-gratuits`                                                         | Jeux gratuits             | Liste les jeux actuellement gratuits à garder (Steam, Epic, GOG).                      |
| `/dire`                                                                  | Profils de messages       | Fait parler le bot sous un profil (pseudo + avatar) via webhook (staff).               |
| `/solde`, `/daily`, `/payer`, `/riches`, `/boutique-roles`               | Économie                  | Monnaie virtuelle, récompense quotidienne, paiement, classement et boutique.           |
| `/argent-admin donner`, `/argent-admin retirer`, `/argent-admin definir` | Économie                  | Administration des soldes (ajout, retrait, définition). Permission : gérer le serveur. |
| `/anniversaire definir`, `/retirer`, `/voir`, `/prochains`               | Anniversaires             | Gestion des anniversaires.                                                             |
| `/suggestion`                                                            | Suggestions               | Crée une suggestion, avec lien Steam optionnel.                                        |
| `/suggestions classement`, `/suggestions rechercher`                     | Suggestions               | Classement des suggestions et recherche par mot-clé.                                   |
| `/giveaway lancer`, `/terminer`, `/relancer`, `/liste`                   | Giveaways                 | Gestion des tirages au sort.                                                           |
| `/avent ouvrir`, `/avent calendrier`                                     | Calendrier de l'Avent     | Ouvre la porte du jour (décembre) et affiche sa progression.                           |
| `/voc panneau`, `/nom`, `/limite`, `/transferer`, `/revendiquer`         | Salons vocaux temporaires | Pilote son salon vocal temporaire.                                                     |
| `/sauvegarde exporter`, `/importer`                                      | Sauvegarde du serveur     | Sauvegarde complète (config + données) et restauration.                                |
| `/infos-membre`, `/infos-serveur`, `/avatar`, `/infos-role`, `/emoji`    | Commandes d'informations  | Infos membre, serveur, avatar, rôle et emoji.                                          |
| `/boule8`, `/pileouface`, `/choisir`                                     | Jeux                      | Mini-jeux rapides.                                                                     |
| `/d4`, `/d6`, `/d8`, `/d10`, `/d12`, `/d20`, `/d100`                     | Jeux                      | Lance un ou plusieurs dés dédiés.                                                      |
| `/pfc`                                                                   | Jeux                      | Pierre-feuille-ciseaux contre le bot ou un membre.                                     |
| `/morpion`                                                               | Jeux                      | Morpion contre le bot ou un membre.                                                    |
| `/bataille`                                                              | Jeux                      | Bataille navale (image + saisie, flotte privée) contre le bot ou un membre.            |
| `/stats-jeux`                                                            | Jeux                      | Statistiques de jeux d'un membre.                                                      |
| `/route avancer`, `/profil`, `/classement`, `/boutique`                  | Route de l'Infini         | Aventure solo : événements aléatoires, PV/énergie/distance, récompenses.               |
| `/bingo demarrer`, `/rejoindre`, `/carte`, `/tirer`, `/terminer`         | Bingo                     | Bingo de serveur : cartons 5×5, tirages, détection ligne/carton.                       |
| `/inventaire`                                                            | Objets & inventaires      | Affiche l'inventaire d'un membre.                                                      |
| `/boutique-objets`                                                       | Objets & inventaires      | Liste le catalogue d'objets du serveur.                                                |
| `/acheter`, `/vendre`, `/utiliser`, `/donner-objet`                      | Objets & inventaires      | Achat, revente au serveur, utilisation (rôle-récompense), échange entre membres.       |
| `/objets-admin donner`, `/retirer`                                       | Objets & inventaires      | Attribue ou retire des objets. Permission : gérer le serveur.                          |
| `/objets-limite voir`, `/definir`, `/augmenter`, `/reduire`              | Objets & inventaires      | Plafond global d'objets par serveur. Propriétaire du bot uniquement.                   |
| `/hdv parcourir`, `/vendre`, `/mes-annonces`                             | Hôtel des ventes          | Marché entre membres : mise en vente, achat, gestion de ses annonces.                  |
| `/play`                                                                  | Musique                   | Joue une musique / l'ajoute à la file (recherche ou lien).                             |
| `/skip`, `/stop`, `/pause`, `/resume`, `/disconnect`                     | Musique                   | Contrôle la lecture (rôle DJ si configuré). `/disconnect` quitte le vocal.             |
| `/queue`, `/nowplaying`                                                  | Musique                   | Affiche la file d'attente et la piste en cours.                                        |
| `/volume`, `/loop`, `/shuffle`, `/seek`, `/remove`                       | Musique                   | Volume, répétition (off/piste/file), mélange, position, retrait d'une piste.           |

## Modules configurables

Tous ces modules se règlent depuis le
[dashboard web](#dashboard-web-configuration-à-distance) (formulaires par module,
et publication directe des panneaux pour tickets, rôles-réactions, règlement,
vérification et mode streameur).

| Module                    | Ce qu'il fait                                                                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arrivées & départs        | Messages de bienvenue/départ, embed ou texte, carte-image générée avec image de fond personnalisée, variables `{mention}`, `{username}`, `{server}`, `{count}`.                                                                                                                                      |
| Niveaux                   | XP par message et en vocal, cooldown, boosters (multiplicateur), salons/rôles ignorés, niveau max, courbe réglable, annonce, rôles récompense, carte de rang (couleur), classement auto.                                                                                                             |
| Rôles-réactions           | Menu par réactions façon DraftBot : le bot pose une réaction par rôle, réagir attribue/retire le rôle.                                                                                                                                                                                               |
| Messages interactifs      | Embeds réutilisables (titre, description, couleur) publiés dans un salon, avec boutons de rôle (clic = ajout/retrait) et boutons lien.                                                                                                                                                               |
| Interserveurs             | Relie des salons de serveurs différents via un code de réseau ; les messages sont relayés par webhook (pseudo + avatar conservés).                                                                                                                                                                   |
| Messages épinglés         | Message « collant » qui reste toujours en bas d'un salon (texte ou embed) : re-posté automatiquement à chaque nouvelle discussion.                                                                                                                                                                   |
| Rôles automatiques        | Rôles donnés à l'arrivée (humains/bots séparés) et rôle attribué tant qu'un membre est connecté en vocal.                                                                                                                                                                                            |
| Profils de messages       | Identités (pseudo + avatar) sous lesquelles le staff fait parler le bot via `/dire` (webhook du salon).                                                                                                                                                                                              |
| Mode streameur            | Panneau pour se rendre sourd temporairement sans couper son micro.                                                                                                                                                                                                                                   |
| Auto-modération           | Anti-spam, invitations Discord, liens, mots interdits, mentions abusives, majuscules, actions automatiques. Inclut le **honeypot** (fonction du module, pas un module à part) : salon piège avec embed FR et compteur de bans, tout message non-staff entraîne un ban.                               |
| Modération                | Logs de sanctions, DM au membre sanctionné, historique.                                                                                                                                                                                                                                              |
| Économie                  | Monnaie, gains par message et en vocal, salons/rôles ignorés, daily, boutiques multiples (stock limité, bannière), classement auto, administration.                                                                                                                                                  |
| Calendrier de l'Avent     | Du 1er au 24 décembre, une porte par jour et par membre : pièces et/ou objet configurables, annonce quotidienne, mode test.                                                                                                                                                                          |
| Anniversaires             | Annonce quotidienne, rôle du jour optionnel, message personnalisable.                                                                                                                                                                                                                                |
| Rappels                   | Rappels persistants ponctuels ou récurrents, salon ou MP.                                                                                                                                                                                                                                            |
| Règlement                 | Publication d'un règlement avec bouton d'acceptation et rôle d'accès.                                                                                                                                                                                                                                |
| Suggestions               | Votes, statut staff, fils de discussion, enrichissement Steam, limites par membre/rôle, classement & recherche, récompenses à l'approbation, couleur dynamique.                                                                                                                                      |
| Starboard                 | Republie les messages qui atteignent un seuil de réactions.                                                                                                                                                                                                                                          |
| Logs                      | Messages, membres, salons, rôles, modération, clear, boutons rollback selon l'événement, suivi des invitations (qui a invité qui, `/invitations`).                                                                                                                                                   |
| Tickets                   | Plusieurs types de tickets, rôles par type, salon privé **ou fil privé**, format de nom personnalisable (`{type}`/`{number}`/`{user}`), archivage en fil.                                                                                                                                            |
| Giveaways                 | Logs gagnants, messages de victoire/no winner personnalisables, participation par bouton.                                                                                                                                                                                                            |
| Signalements              | Salon staff, rôle staff optionnel, thread ouvert au reporter, actions prendre/résoudre/ignorer.                                                                                                                                                                                                      |
| Salons vocaux temporaires | Hubs join-to-create, héritage des permissions du générateur, salon perso, panel complet, whitelist/blacklist, transfert, sauvegarde préférences.                                                                                                                                                     |
| Alertes stream & flux     | Annonce lives Twitch, vidéos YouTube, posts Reddit, articles RSS/Atom et deals Dealabs (filtre par mot-clé, variables `{prix}`/`{temperature}`), rôle mentionné, message custom.                                                                                                                     |
| Jeux gratuits             | Annonce les jeux gratuits à garder sur Steam, Epic Games et GOG (plateformes sélectionnables, contrôle toutes les 30 min), salon + rôle configurables ; `/jeux-gratuits` liste les offres.                                                                                                           |
| Patch Notes               | Surveille les notes de patch de jeux/logiciels (catalogue de sources) et les publie dans les salons choisis, avec rôle mentionné.                                                                                                                                                                    |
| Compteurs de serveur      | Salons vocaux renommés avec membres, bots, boosts, rôles, salons ou membres d'un rôle.                                                                                                                                                                                                               |
| Vérification              | Bouton ou captcha image pour attribuer le rôle vérifié.                                                                                                                                                                                                                                              |
| Commandes personnalisées  | Auto-réponses texte ou embed, variables, cooldown, suppression optionnelle du message.                                                                                                                                                                                                               |
| Messages récurrents       | Publications automatiques quotidiennes, hebdomadaires ou par intervalle.                                                                                                                                                                                                                             |
| Réactions de mots         | Ajoute des réactions sur mots-clés avec plusieurs modes de correspondance.                                                                                                                                                                                                                           |
| Jeux                      | Active/désactive les mini-jeux et les stats de parties. Les parties (PFC, morpion, bataille navale) peuvent faire tomber des objets (drops) — voir « Objets & inventaires ».                                                                                                                         |
| Objets & inventaires      | Catalogue d'objets par serveur (nom, emoji, rareté, prix, rôle-récompense), achat avec la monnaie, inventaire, utilisation et échange entre membres. **Drops en jeu** : un pourcentage de drop par rareté (défini manuellement) fait tomber des objets à la fin des mini-jeux.                       |
| Route de l'Infini         | Aventure solo à événements aléatoires (trésor, monstre, tempête, oasis, ruines, loups, sanctuaire, bandits, volcan…) : PV, énergie, distance, pièces (économie), objets trouvés (barème de drop propre) et compteur de morts. Cooldown réglable.                                                     |
| Bingo                     | Partie de Bingo par serveur : cartons 5×5 (1-75, centre libre), tirages par le staff, détection automatique de ligne ou de carton plein.                                                                                                                                                             |
| Hôtel des ventes          | Marché entre membres (`/hdv`) : mise en vente d'objets de l'inventaire (séquestrés le temps de l'annonce), achat atomique, taxe serveur, prix plancher (fixe ou % du prix boutique), plafond d'annonces, notification MP au vendeur.                                                                 |
| Commandes d'informations  | Commandes en lecture seule (`/infos-membre`, `/infos-serveur`, `/avatar`, `/infos-role`, `/emoji`) **et** un _journal des profils_ optionnel : note dans un salon les changements de profil des membres (nom, nom affiché, photo de profil avec avant/après, pseudo serveur), avec filtre par rôles. |
| Sauvegarde du serveur     | Sauvegarde complète — configuration, structure et données (argent, objets, Route de l'Infini, niveaux…) — à la demande ou planifiée (cron) depuis le dashboard, avec rétention, dépôt dans un salon, et restauration avec recréation/remappage des salons et rôles manquants.                        |
| Musique                   | Lecture audio dans les salons vocaux via Lavalink (YouTube, SoundCloud, Bandcamp… et Spotify/Deezer avec le plugin LavaSrc) : file d'attente, répétition, mélange, volume, seek, rôle DJ. Nécessite un serveur Lavalink (voir [Musique](#musique-lavalink)).                                         |

## Points importants par module

Certains modules ont une fiche détaillée dans [`docs/modules/`](docs/modules/).

### Logs et rollback

Le module Logs peut journaliser les suppressions/modifications de messages, arrivées/départs, salons, rôles et actions de modération. Les logs utilisent les audit logs Discord quand c'est possible pour afficher l'auteur réel de l'action.

Certains événements créent un bouton **Rollback** :

- message supprimé : restauration via webhook avec auteur/contenu/attachments quand le snapshot existe ;
- salon supprimé : recréation avec nom, type, position et permissions ;
- rôle supprimé : recréation avec couleur, permissions, position et options.

Les snapshots de messages sont purgés automatiquement pour éviter de garder trop longtemps du contenu supprimé.

### Auto-modération

Les règles disponibles couvrent spam, invitations, liens, mots interdits, mentions massives et majuscules. Chaque règle peut avoir son action : suppression, warn, timeout, kick ou ban selon la configuration. Les membres avec permissions de staff sont ignorés.

Le honeypot peut créer/publier un salon piège avec image, texte FR et bouton compteur de bans. Il est fait pour attraper les comptes compromis qui écrivent dans un salon explicitement interdit.

### Signalements

`/report` accepte un membre, une raison et un lien de message optionnel. Le signalement est envoyé dans le salon staff configuré, avec un thread dédié auquel le reporter est ajouté. Le reporter n'a pas besoin d'avoir accès au salon staff lui-même.

### Giveaways

`/giveaway lancer` accepte un lot, une durée (`2m`, `1h`, `2j`), un nombre de gagnants, un salon et un rôle requis optionnel. Le tirage se fait à échéance par tâche planifiée. `/giveaway relancer` peut relancer tout le tirage ou remplacer un gagnant précis.

### Jeux

Les dés dédiés existent pour D4, D6, D8, D10, D12, D20 et D100, avec option `nombre`. Les sorties sont compactes, par exemple `D8 (x2) : 10 (4+6)`. PFC, morpion et bataille navale fonctionnent contre le bot ou en duel contre un membre ; les parties alimentent `/stats-jeux`. La bataille navale se joue sur une grille 8×8 dessinée en image : un bouton **Tirer** ouvre une zone de saisie pour indiquer la case visée (ex. `C7`). Contre le bot, l'image montre ta flotte et ta grille de tir. En duel contre un membre, l'image publique n'affiche que la grille de tir (navires adverses cachés) et chaque joueur consulte sa propre flotte en privé via le bouton **Ma flotte**, sans jamais voir celle de l'autre.

#### Drops d'objets

Si le module **Objets & inventaires** est activé et les drops configurés, les parties de PFC, morpion et bataille navale peuvent faire **tomber des objets** du catalogue. Dans le dashboard → Objets → Drops, on règle :

- **quand** un tirage a lieu (victoire seule, victoire + égalité, ou chaque partie) ;
- un **pourcentage de drop par rareté** (Commun, Rare, Épique, Légendaire), défini manuellement.

À chaque partie éligible, le tirage part de la rareté **la plus rare vers la plus commune** : la première dont le pourcentage réussit fait gagner un objet aléatoire de cette rareté (parmi ceux marqués **« Drop en jeu »**), ajouté à l'inventaire du membre et annoncé dans le salon. Un objet exclu des drops (bouton « Drop en jeu » désactivé) ne tombe jamais — pratique pour les objets à rôle-récompense.

La **Route de l'Infini** possède son **propre barème de drop**, **indépendant** de celui des mini-jeux : ses chances par rareté se règlent dans le dashboard → Route de l'Infini → Chances de drop. Le mécanisme est le même (tirage rareté par rareté, uniquement sur les objets « Drop en jeu »), déclenché par l'événement « marchand » quand « Distribuer les objets trouvés » est activé.

Sur la Route, plusieurs événements **annoncent** un cadeau (corbeau messager, marchand, fée, ermite, ruines…) alors que le tirage peut très bien ne rien donner : barème trop bas, aucun objet « Drop en jeu » au catalogue, ou objets désactivés. Dans ce cas le bot ajoute sous le message une **petite pique** tirée au hasard (« T'auras pas de cadeau. Voilà. C'est dit. »), pour que le voyageur ne croie pas à un bug. L'option et la liste des piques se règlent dans le dashboard → Route de l'Infini → **Cadeau promis mais jamais donné** (une pique par ligne ; liste vide = celles du bot).

### Sauvegarde du serveur

Une sauvegarde contient **tout** ce que le bot détient du serveur :

- la **configuration** de chaque module et son état activé/désactivé ;
- la **structure** (salons, rôles, permissions) que ces configs référencent, pour pouvoir la recréer ailleurs ;
- les **données** : argent et récompenses quotidiennes, catalogue d'objets, inventaires, hôtel des ventes, voyageurs et cannetons de la Route de l'Infini, niveaux et XP, sanctions, tickets, suggestions et leurs votes, concours et participations, bingo, anniversaires, rappels, signalements, statistiques de jeux…

Les tables sont **découvertes dans le schéma** plutôt qu'énumérées : un module ajouté plus tard est sauvegardé sans modification du module de sauvegarde. Restent volontairement dehors le cache de `/rollback` (copie de chaque message vu, énorme et sans objet après restauration), les salons vocaux temporaires et les tirages en cours de certains jeux (un message Discord porteur de boutons, que la restauration ne peut pas ressusciter).

S'y ajoutent les **dépendances partagées**. Un catalogue commun à tous les serveurs n'appartient à aucun d'eux, mais les données d'un serveur le référencent : ses collections, ses réclamations. La sauvegarde embarque donc les seules lignes du catalogue réellement référencées. À la restauration elles ne sont jamais écrasées ; elles sont **réconciliées** par leur clé naturelle : déjà là sous le même identifiant, rien à faire ; déjà là sous un autre (l'instance a fait son propre import), les références sont remappées ; absentes (instance vierge), elles sont réinstallées. Sans cela, restaurer ailleurs échouerait purement et simplement — SQLite applique les clés étrangères et rejetterait le tout.

Trois façons de s'en servir :

| Où                       | Quoi                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `/sauvegarde exporter`   | Télécharge un fichier tout de suite (option `donnees` pour ne prendre que la configuration).             |
| `/sauvegarde importer`   | Restaure depuis un fichier `.json` ou `.json.gz` (options `recreer` et `donnees`).                       |
| Dashboard → **Réglages** | Sauvegarde à la demande, sauvegardes **automatiques** (expression cron), téléchargement et restauration. |

Les sauvegardes automatiques sont écrites sur le disque du bot (`BACKUP_DIR`, `./data/backups` par défaut), compressées, avec une rétention réglable ; une copie peut être déposée dans un salon Discord pour ne pas dépendre du seul VPS.

À la restauration sur un **autre** serveur, les salons et rôles manquants sont recréés (option `recreer`), les identifiants remappés dans les configs, et les clés des données régénérées — le serveur d'origine n'est jamais touché.

`npm run check:backup` rejoue tout le cycle export → purge → restauration sur une base jetable.

## Langues

Le bot parle la langue choisie **par serveur**, depuis le dashboard
(« Langue du bot » sur la page du serveur). Le réglage vaut pour tout ce que les
membres voient : réponses de commandes, panneaux, annonces des tâches
planifiées, et jusqu'aux **slash commands elles-mêmes** — un serveur réglé en
anglais tape `/rank member:@toto` là où son voisin garde `/rang membre:@toto`.
Un serveur qui n'a jamais choisi suit la langue que Discord déclare pour lui, et
retombe sur le français sinon.

C'est bien la langue **du serveur** qui décide, pas celle de chaque membre : un
francophone sur un serveur anglophone voit les commandes en anglais, comme le
reste de la communauté. Le changement prend effet tout de suite — le bot
redéploie les commandes du serveur dès que le dashboard change sa langue. Cela
suppose le déploiement par serveur (`DEPLOY_COMMANDS_ON_START=true`, le réglage
recommandé) : un déploiement **global** ne vise aucun serveur en particulier et
reste donc en français.

Les textes vivent dans `locales/<langue>/<module>.json` — un dossier par langue,
un fichier par module, fusionnés au chargement. Une clé absente d'une langue
retombe sur le français : une traduction partielle reste utilisable.

### Ajouter une langue

Rien à écrire dans le code, ni ici, ni dans le dashboard : ce qui est dans
`locales/` est chargé au démarrage.

1. Créez le dossier de la langue, nommé par son code — `locales/ch/` pour du
   suisse allemand (la casse est sans importance : `CH` et `ch` sont la même).
2. Copiez-y les fichiers de `locales/fr/` que vous voulez traduire. Vous pouvez
   n'en traduire qu'un : le reste restera en français.
3. Dans `commun.json`, déclarez ce que la langue dit d'elle-même — **c'est ce
   bloc qui la fait apparaître dans le sélecteur, avec son drapeau** :

   ```json
   {
     "langue": {
       "nom": "Schwiizerdütsch",
       "drapeau": "🇨🇭",
       "discord": "de-CH|de"
     }
   }
   ```

   Le bloc `noms` d'un fichier de module, lui, porte les noms de commandes :
   `"membre": "member"` fait apparaître l'option sous ce nom sur les serveurs
   réglés dans cette langue. Un nom doit rester un nom de commande Discord —
   minuscules, ni espace ni point, 32 caractères au plus — et
   `npm run commandes:check` le vérifie pour toutes les langues déposées.

   `nom` s'écrit dans la langue elle-même, `drapeau` est un emoji, et `discord`
   liste les codes de langue Discord correspondants (séparés par `|`) : ils
   servent à deviner la langue d'un serveur qui n'a rien réglé.

4. `npm run i18n:check` vérifie le tout, `npm run commandes:check` s'assure que
   les noms de commandes traduits sont déployables, et `npm run reglages:check`
   que les formulaires de réglage se construisent dans la nouvelle langue. Le
   premier n'exige pas qu'une langue ajoutée soit complète — il affiche sa
   couverture — mais il refuse une clé qui n'existe pas en français (faute de
   frappe, renommage oublié) et une langue sans nom ni drapeau.
5. Redémarrez le bot : la langue apparaît dans `GET /api/locales`, donc dans le
   sélecteur du dashboard.

Le site a ses propres textes, dans son propre dépôt : y ajouter la même langue
se fait de la même façon (voir son README).

## Permissions et intents

Permissions souvent nécessaires au bot :

- Gérer les rôles : autoroles, niveaux, réaction-rôles, règlement, vérification, économie boutique.
- Gérer les salons : tickets, tempvoice, serverstats, honeypot, restauration de salons.
- Gérer les messages : clear, auto-modération, suppression de déclencheurs custom commands.
- Voir les logs d'audit : logs plus précis sur l'auteur des actions.
- Gérer les webhooks : rollback de messages supprimés avec auteur/contenu proche de l'original ; relais interserveurs ; profils de messages (`/dire`).
- Bannir / expulser / modérer les membres : sanctions et actions automod.
- Déplacer les membres : salons vocaux temporaires.
- Rendre muet les membres : couper le micro d'un salon vocal temporaire (force le mute serveur).

Intents recommandés côté portail Discord :

- Server Members Intent.
- Message Content Intent.

## Données persistantes

| Donnée         | Local              | Docker                                                    |
| -------------- | ------------------ | --------------------------------------------------------- |
| SQLite         | `dev.db`           | `/app/data/prod.db`, via le bind mount `./data:/app/data` |
| Assets générés | `assets/generated` | `/app/assets/generated`, dans le volume `vakzbot-assets`  |

Les migrations Prisma vivent dans **`prisma/schema/migrations`** — dans le
dossier de schéma, parce que c'est là que Prisma les cherche quand le schéma est
un dossier et non un fichier. Les ranger à côté (`prisma/migrations`) ne fait
échouer personne : `migrate deploy` répond « No migration found », sort en
**succès**, et la base cesse simplement d'évoluer. Ce chemin, comme celui du
schéma, est déclaré explicitement dans **`prisma.config.ts`** : il n'est plus
deviné. Elles sont appliquées au
démarrage Docker, le conteneur lançant `prisma migrate deploy` **avant** le bot,
et refusant de démarrer si elles échouent.

### « the table X does not exist »

Le bot démarre, puis un module tombe sur une table absente — et se referme,
souvent sans que personne le voie. C'est que la base et l'image ont divergé :
image reconstruite sans la migration, base restaurée d'ailleurs, `db push` passé
à la main. Depuis, le bot **le dit au démarrage** : une ligne `fatal` du scope
`db` nomme les tables manquantes.

Le réflexe est de reconstruire (`docker compose up -d --build`), ce qui rejoue
les migrations. `npx prisma migrate status` dit ce qui reste en attente.

⚠️ **Après un `prisma db push` passé à la main**, la table existe mais la
migration n'est pas enregistrée : au prochain démarrage, `migrate deploy`
essaiera de la rejouer, échouera sur « table already exists » — et le conteneur
tournera en boucle de redémarrage. Marque-la comme appliquée, une fois.

`prisma` n'est **pas installé sur l'hôte** : il vit dans le conteneur, et
toutes ces commandes s'y lancent, depuis le dossier du `docker-compose.yml`.

```bash
# Bot en marche — `exec` entre dans le conteneur qui tourne.
docker compose exec bot \
  npx prisma migrate resolve --applied 20260916120000_grades_dashboard

# Conteneur qui ne démarre plus — `run` en crée un jetable.
docker compose run --rm bot \
  npx prisma migrate resolve --applied 20260916120000_grades_dashboard
```

Le nom est celui du **dossier** dans `prisma/schema/migrations`. L'entrypoint relaie
toute commande qu'on lui passe **sans migrer d'abord** : c'est ce qui permet de
réparer une migration cassée sans que la réparation bute sur l'erreur qu'elle
vient corriger.

C'est la raison pour laquelle `db push` n'a pas sa place en production : il
change la base sans rien écrire dans l'historique des migrations.

## Intégrations externes

| Variable                                    | Usage                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Alertes Twitch live.                                                                                  |
| `YOUTUBE_API_KEY`                           | Optionnel pour YouTube ; le RSS fonctionne sans clé, l'API améliore la réactivité.                    |
| `FLARESOLVERR_URL`                          | Optionnel. Résolveur Cloudflare pour les sources protégées (Dealabs). Ex. `http://flaresolverr:8191`. |

### Dealabs (Cloudflare)

Dealabs est protégé par Cloudflare : ses flux ne sont pas accessibles directement
côté serveur (challenge « Just a moment… »). Le module d'alertes route donc les
requêtes Dealabs via [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr),
un résolveur Chrome headless. Le `docker-compose.yml` inclut déjà le service
`flaresolverr` et renseigne `FLARESOLVERR_URL` pour le bot — aucune configuration
supplémentaire n'est nécessaire, il suffit de relancer `docker compose up -d --build`.
Sans FlareSolverr, les autres sources (Twitch, YouTube, Reddit, RSS) fonctionnent
normalement ; seul Dealabs est indisponible.

## Scripts npm

| Script                      | Rôle                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| `npm run dev`               | Lance le bot en développement avec `tsx watch`.                  |
| `npm run build`             | Compile TypeScript vers `dist/`.                                 |
| `npm start`                 | Lance `dist/index.js`.                                           |
| `npm run deploy`            | Déploie les slash commands en local/dev.                         |
| `npm run deploy:prod`       | Déploie les slash commands depuis `dist/`.                       |
| `npm run typecheck`         | Vérifie TypeScript sans émettre.                                 |
| `npm run lint`              | Lance oxlint.                                                    |
| `npm run lint:fix`          | Lance oxlint et corrige ce qui peut l'être.                      |
| `npm run format`            | Formate tout le repo avec Prettier.                              |
| `npm run format:check`      | Vérifie le format sans modifier.                                 |
| `npm run check:backup`      | Rejoue export → purge → restauration sur une base jetable.       |
| `npm run check:acces`       | Vérifie les grades et l'écriture par bloc, base jetable.         |
| `npm run check:invitations` | Éprouve « qui a invité qui » : déduction et comptage.            |
| `npm run check:lint`        | Sème des violations connues et exige que le linter les voie.     |
| `npm run check:updater`     | Éprouve les gardes de l'updater avec un faux Docker.             |
| `npm run check:sync`        | Exige qu'une exclusion de publication retire bien quelque chose. |
| `npm run commandes:check`   | Rejoue le déploiement des commandes dans toutes les langues.     |
| `npm run reglages:check`    | Construit les réglages de chaque module dans toutes les langues. |
| `npm run prisma:migrate`    | Crée/applique une migration en dev.                              |
| `npm run prisma:deploy`     | Applique les migrations en production.                           |
| `npm run prisma:generate`   | Régénère le client Prisma.                                       |
| `npm run prisma:studio`     | Ouvre Prisma Studio sur la base courante.                        |

Les commandes propres à un module (imports de catalogue, simulateurs…) ne
figurent pas ici : elles vivent dans la fiche du module, sous
[`docs/modules/`](docs/modules/), et s'invoquent en `npx tsx src/scripts/<nom>.ts`.

## Checklist de test

Après un pull sur VPS :

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs -f bot
```

À tester rapidement dans Discord :

1. Dashboard : navigation par catégories, activation/désactivation, page de réglages d'un module.
2. Logs : supprimer un message, créer/modifier/supprimer un salon ou rôle, vérifier auteur + rollback.
3. Auto-modération : activer une règle simple, tester action et salon de logs.
4. Honeypot : créer/publier le salon piège et vérifier l'affichage.
5. Reports : `/report` avec lien de message, vérifier thread et accès reporter.
6. Giveaways : lancer un tirage court, participer, attendre le tirage, relancer.
7. Jeux : `/d8 nombre:2`, `/pfc`, `/morpion`, `/bataille`, `/stats-jeux`.
8. Tempvoice : rejoindre un hub, vérifier création/suppression et panneau.

## Sécurité des secrets

Ne commit jamais `.env`. Si un token Discord fuite, régénère-le immédiatement dans le portail développeur Discord. Le dépôt ne doit contenir que `.env.example`.

## Licence

MIT.
