# Vakz-Bot

Vakz-Bot est un bot Discord **multi-serveurs**, **modulaire**, **auto-hébergé** et pensé comme une alternative libre aux gros bots généralistes. Tout se configure serveur par serveur via `/config` (panneaux Discord interactifs : menus, boutons, modals, sélecteurs) ou depuis un **dashboard web** (voir [Dashboard web](#dashboard-web-configuration-à-distance)).

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
- [Permissions et intents](#permissions-et-intents)
- [Données persistantes](#données-persistantes)
- [Scripts npm](#scripts-npm)
- [Checklist de test](#checklist-de-test)

## État actuel

Le bot n'est plus au stade fondations : il contient déjà une base fonctionnelle large.

- Configuration centralisée avec `/config`, organisée par catégories.
- **Dashboard web** (site Vercel séparé) : config par formulaires, publication de
  panneaux, `/maj` à distance et purge RGPD des données d'un serveur.
- Modules activables/désactivables par serveur.
- i18n FR/EN, français par défaut.
- SQLite + Prisma avec migrations Docker.
- Déploiement automatique des slash commands au démarrage si `DEPLOY_COMMANDS_ON_START=true`.
- Logs serveur avec boutons de rollback pour certains événements.
- Auto-modération avancée avec actions configurables et honeypot.
- Jeux récents : dés dédiés, boule 8, pile ou face, tirage, PFC, morpion et bataille navale avec stats.

## Stack technique

| Domaine          | Choix                                |
| ---------------- | ------------------------------------ |
| Langage          | TypeScript strict                    |
| Runtime          | Node.js 20+                          |
| Discord          | discord.js v14                       |
| Base de données  | SQLite via Prisma                    |
| Scheduler        | node-cron                            |
| Validation env   | dotenv + zod                         |
| Logs applicatifs | pino                                 |
| Qualité          | ESLint + Prettier                    |
| Déploiement      | Docker Compose, compatible VPS ARM64 |

## Architecture

```text
src/
  core/       client, env, i18n, loader, config serveur, scheduler
  modules/    un dossier autonome par module
  lib/        helpers partagés
  index.ts    bootstrap du bot
prisma/       schema + migrations
locales/      fr.json, en.json
```

Chaque module exporte ses commandes, listeners, tâches planifiées, handlers de composants et panneau `/config`. Le loader découvre les modules au démarrage.

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

Au démarrage du conteneur, l'entrypoint applique les migrations Prisma avant de lancer le bot. Les données persistent dans les volumes Docker.

> 🖥️ **Architectures** : fonctionne sur **x86_64** et **ARM64** (aarch64). Le
> `docker compose up --build` construit l'image **nativement** pour ta machine —
> l'image de base `node:20-slim`, `@napi-rs/canvas` et Prisma fournissent les
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
   `main` en prod, ou une branche de test) — il fait `git pull origin <branche
courante>`. Pour forcer une branche précise, définis `BRANCH=<nom>` (variable
   d'env ou ligne `Environment=BRANCH=` du service systemd).

3. Dans Discord : `/maj` → choisis la **branche** dans le sélecteur (les
   branches proposées viennent de `DEPLOY_BRANCHES`, ex. `main` et une branche
   de test) → **Mettre à jour** → le bot enregistre la demande, se reconstruit
   puis redémarre. La branche choisie prime sur le défaut de l'updater. Quand il
   revient, il envoie une confirmation éphémère dans le salon où la demande a
   été confirmée ; le dernier résultat reste aussi visible au prochain `/maj`.

> ⚠️ L'updater agit sur l'hôte (Docker) : garde `BOT_OWNER_ID` correct et le
> dossier data accessible uniquement à l'hôte.

## Dashboard web (configuration à distance)

En plus de `/config` sur Discord, un **dashboard web** (site Next.js séparé,
déployé sur Vercel — voir le dépôt `VakzBot-Web`) permet de configurer le bot
depuis un navigateur : activer/désactiver les modules, éditer leur configuration
via des formulaires, **publier/mettre à jour les panneaux** (tickets,
rôles-réactions, règlement, vérification, mode streameur) sans repasser par
Discord, déclencher `/maj` à distance (choix de branche + statut, réservé au
propriétaire), et **supprimer toutes les données d'un serveur** en un clic
(purge RGPD : données en base, messages/salons/webhooks créés par le bot, puis
le bot quitte le serveur).

L'API vérifie deux niveaux : le **token** partagé (« le site parle ») **et**
l'identité de l'utilisateur (en-tête `x-actor-id`) que le bot recoupe avec ses
propres droits (propriétaire du serveur / « Gérer le serveur » / propriétaire du
bot). On ne délègue donc pas l'autorisation au seul site.

Le dashboard dialogue avec une petite **API HTTP** exposée par le bot :

1. Dans le `.env` du bot :

   ```
   WEB_API_TOKEN=<secret partagé>   # openssl rand -hex 32 ; vide = API désactivée
   WEB_API_PORT=3210
   ```

   Le `docker-compose.yml` publie ce port. L'API exige ce token (`Authorization:
   Bearer …`) sur toutes les routes sauf `/api/health`. Côté site (Vercel), on
   renseigne `BOT_API_URL`, `BOT_API_TOKEN` (le même secret) et `BOT_OWNER_ID`.

2. Chaque module déclare les champs éditables depuis le web via `configUI`
   (sélecteurs de salon/rôle, textes, booléens, listes…). Toute config reçue est
   **revalidée par zod** avant d'être persistée.

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

   *(Alternative sans dépôt : télécharger le binaire `cloudflared-linux-<arch>`
   depuis les releases GitHub de `cloudflare/cloudflared` et le placer dans
   `/usr/local/bin`. En Docker : image `cloudflare/cloudflared`.)*

2. **Créer le tunnel** — le plus simple via le dashboard :
   [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks →
   Tunnels → Create a tunnel** → *Cloudflared* → nomme-le. Cloudflare affiche une
   commande d'installation avec un **token** ; lance-la sur le VPS, par ex. :

   ```bash
   sudo cloudflared service install <TOKEN>
   # ou en conteneur :
   docker run -d --name cloudflared --restart unless-stopped \
     cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TOKEN>
   ```

3. **Router un sous-domaine vers l'API** : dans le tunnel → **Public Hostname →
   Add a public hostname** :
   - *Subdomain* : `meowapi` · *Domain* : ton domaine
   - *Service* : **HTTP** → `http://172.17.0.1:3210` (passerelle Docker depuis le
     conteneur `cloudflared`) ou `http://localhost:3210` si `cloudflared` tourne
     en réseau `host`. Reprends la même adresse d'hôte que tes autres routes.

   Cloudflare crée le DNS + le certificat automatiquement.

4. **Côté Vercel** : `BOT_API_URL = https://meowapi.<ton-domaine>` puis redéploie.
   Teste : `https://meowapi.<ton-domaine>/api/health` → `{"ok":true}`.

> 🔒 Le **token du tunnel** est un secret : ne le committe pas. En cas de fuite,
> régénère-le (tunnel → *Refresh token*) et relance le connecteur.

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
choisit dans `/config` (ou le dashboard web).

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

> 🔄 **Mise à jour `/maj`** : l'updater lance `docker compose up -d` **sans**
> `--profile`. Renseigne donc `COMPOSE_PROFILES=music` dans `.env` (comme
> ci-dessus) pour que Lavalink soit démarré et maintenu automatiquement à chaque
> mise à jour. Sinon, lance-le une fois à la main avec `docker compose --profile
> music up -d` : grâce à `restart: unless-stopped`, il survit ensuite aux `/maj`
> et aux redémarrages, mais un `/maj` ne le relancera pas s'il est totalement
> arrêté. (Combine avec Caddy au besoin : `COMPOSE_PROFILES=music,proxy`.)

Sans le profil `music`, le bot tourne normalement et le module musique reste
simplement inactif.

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
si une source est activée sans ses identifiants (Deezer exige une *master key*).
YouTube / SoundCloud fonctionnent sans rien de tout ça.

Chaque source est **opt-in** via une variable d'env :

- **Spotify** (`spsearch`) — crée une application sur le
  [dashboard développeur Spotify](https://developer.spotify.com/dashboard) puis, dans `.env` :

  ```env
  LAVASRC_SPOTIFY=true
  SPOTIFY_CLIENT_ID=…
  SPOTIFY_CLIENT_SECRET=…
  ```

- **Deezer** (`dzsearch`) — nécessite une *master key* de déchiffrement
  (**obligatoire**, sinon Lavalink crashe) :

  ```env
  LAVASRC_DEEZER=true
  DEEZER_MASTER_KEY=…
  ```

Ces variables sont transmises au conteneur `lavalink` par le compose ; en
Lavalink autonome, mets-les plutôt dans le `application.yml` de ton serveur. Comme
Spotify/Apple ne diffusent pas l'audio directement, LavaSrc retrouve chaque titre
(par ISRC ou par nom) sur **YouTube/SoundCloud** pour la lecture. Une fois activées,
choisis la plateforme dans le sélecteur `/config` → Musique.

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

### Réglages du module (`/config` → Musique, ou dashboard web)

Rôle **DJ** (réserve les commandes de contrôle ; vide = tout le monde), **volume**
par défaut et maximum, **plateforme de recherche** par défaut, exiger d'être dans
le **même salon** vocal que le bot, et **quitter automatiquement** en fin de file.

> Intent requis : `GuildVoiceStates` (non privilégié, déjà activé). Aucun intent
> privilégié supplémentaire n'est nécessaire pour la musique.

## Commandes slash

| Commande                                                         | Module                    | Usage                                                                         |
| ---------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `/ping`                                                          | Cœur                      | Affiche la latence du bot.                                                    |
| `/config`                                                        | Cœur                      | Configure les modules par catégories. Permission : gérer le serveur.          |
| `/maj`                                                           | Mise à jour               | Met à jour le bot (git pull + rebuild via l'updater hôte). Propriétaire only. |
| `/rang`                                                          | Niveaux                   | Affiche le niveau, l'XP et le rang d'un membre.                               |
| `/classement`                                                    | Niveaux                   | Classement XP du serveur.                                                     |
| `/warn`, `/kick`, `/ban`, `/unban`                               | Modération                | Sanctions et levée de ban.                                                    |
| `/timeout`, `/untimeout`                                         | Modération                | Timeout Discord et retrait du timeout.                                        |
| `/historique`                                                    | Modération                | Casier de sanctions d'un membre.                                              |
| `/clear`                                                         | Logs                      | Supprime des messages récents, avec logs.                                     |
| `/report`                                                        | Signalements              | Signale un membre au staff, avec raison et lien de message optionnel.         |
| `/jeuxgratuits`                                                  | Jeux gratuits             | Liste les jeux Steam actuellement gratuits (à garder).                        |
| `/dire`                                                          | Profils de messages       | Fait parler le bot sous un profil (pseudo + avatar) via webhook (staff).       |
| `/solde`, `/daily`, `/payer`, `/riches`, `/boutique`             | Économie                  | Monnaie virtuelle, récompense quotidienne, paiement, classement et boutique.  |
| `/argent-admin donner`, `/argent-admin retirer`, `/argent-admin definir` | Économie          | Administration des soldes (ajout, retrait, définition). Permission : gérer le serveur. |
| `/anniversaire definir`, `/retirer`, `/voir`, `/prochains`       | Anniversaires             | Gestion des anniversaires.                                                    |
| `/suggestion`                                                    | Suggestions               | Crée une suggestion, avec lien Steam optionnel.                               |
| `/suggestions classement`, `/suggestions rechercher`            | Suggestions               | Classement des suggestions et recherche par mot-clé.                         |
| `/giveaway lancer`, `/terminer`, `/relancer`, `/liste`           | Giveaways                 | Gestion des tirages au sort.                                                  |
| `/avent ouvrir`, `/avent calendrier`                             | Calendrier de l'Avent     | Ouvre la porte du jour (décembre) et affiche sa progression.                 |
| `/voc panneau`, `/nom`, `/limite`, `/transferer`, `/revendiquer` | Salons vocaux temporaires | Pilote son salon vocal temporaire.                                            |
| `/sauvegarde exporter`, `/importer`                              | Sauvegarde config         | Export/import JSON de la configuration serveur.                               |
| `/userinfo`, `/serverinfo`, `/avatar`, `/roleinfo`, `/emoji`     | Informations              | Infos membre, serveur, avatar, rôle et emoji.                                 |
| `/boule8`, `/pileouface`, `/choisir`                             | Jeux                      | Mini-jeux rapides.                                                            |
| `/d4`, `/d6`, `/d8`, `/d10`, `/d12`, `/d20`, `/d100`             | Jeux                      | Lance un ou plusieurs dés dédiés.                                             |
| `/pfc`                                                           | Jeux                      | Pierre-feuille-ciseaux contre le bot ou un membre.                            |
| `/morpion`                                                       | Jeux                      | Morpion contre le bot ou un membre.                                           |
| `/bataille`                                                      | Jeux                      | Bataille navale (image + saisie, flotte privée) contre le bot ou un membre.   |
| `/statsjeux`                                                     | Jeux                      | Statistiques de jeux d'un membre.                                             |
| `/route avancer`, `/profil`, `/classement`                       | Route de l'Infini         | Aventure solo : événements aléatoires, PV/énergie/distance, récompenses.      |
| `/bingo demarrer`, `/rejoindre`, `/carte`, `/tirer`, `/terminer` | Bingo                     | Bingo de serveur : cartons 5×5, tirages, détection ligne/carton.              |
| `/inventaire`                                                    | Objets & inventaires      | Affiche l'inventaire d'un membre.                                             |
| `/objets`                                                        | Objets & inventaires      | Liste le catalogue d'objets du serveur.                                       |
| `/acheter`, `/utiliser`, `/donner-objet`                         | Objets & inventaires      | Achat avec la monnaie, utilisation (rôle-récompense), échange entre membres.  |
| `/objets-admin donner`, `/retirer`                               | Objets & inventaires      | Attribue ou retire des objets. Permission : gérer le serveur.                 |
| `/play`                                                          | Musique                   | Joue une musique / l'ajoute à la file (recherche ou lien).                    |
| `/skip`, `/stop`, `/pause`, `/resume`, `/disconnect`             | Musique                   | Contrôle la lecture (rôle DJ si configuré). `/disconnect` quitte le vocal.    |
| `/queue`, `/nowplaying`                                          | Musique                   | Affiche la file d'attente et la piste en cours.                              |
| `/volume`, `/loop`, `/shuffle`, `/seek`, `/remove`               | Musique                   | Volume, répétition (off/piste/file), mélange, position, retrait d'une piste. |

## Modules configurables

Tous ces modules se règlent dans `/config` après activation — ou depuis le
[dashboard web](#dashboard-web-configuration-à-distance) (formulaires par module,
et publication directe des panneaux pour tickets, rôles-réactions, règlement,
vérification et mode streameur).

| Module                    | Ce qu'il fait                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arrivées & départs        | Messages de bienvenue/départ, embed ou texte, carte-image générée avec image de fond personnalisée, variables `{mention}`, `{username}`, `{server}`, `{count}`. |
| Niveaux                   | XP par message et en vocal, cooldown, boosters (multiplicateur), salons/rôles ignorés, niveau max, courbe réglable, annonce, rôles récompense, carte de rang (couleur), classement auto. |
| Rôles-réactions           | Menu par réactions façon DraftBot : le bot pose une réaction par rôle, réagir attribue/retire le rôle.                                               |
| Messages interactifs      | Embeds réutilisables (titre, description, couleur) publiés dans un salon, avec boutons de rôle (clic = ajout/retrait) et boutons lien.               |
| Interserveurs             | Relie des salons de serveurs différents via un code de réseau ; les messages sont relayés par webhook (pseudo + avatar conservés).                   |
| Messages épinglés         | Message « collant » qui reste toujours en bas d'un salon (texte ou embed) : re-posté automatiquement à chaque nouvelle discussion.                   |
| Rôles automatiques        | Rôles donnés à l'arrivée (humains/bots séparés) et rôle attribué tant qu'un membre est connecté en vocal.                                            |
| Profils de messages       | Identités (pseudo + avatar) sous lesquelles le staff fait parler le bot via `/dire` (webhook du salon).                                              |
| Mode streameur            | Panneau pour se rendre sourd temporairement sans couper son micro.                                                                                   |
| Auto-modération           | Anti-spam, invitations Discord, liens, mots interdits, mentions abusives, majuscules, actions automatiques.                                          |
| Honeypot                  | Salon piège avec embed FR et compteur de bans ; tout message non-staff entraîne un ban.                                                              |
| Modération                | Logs de sanctions, DM au membre sanctionné, historique.                                                                                              |
| Économie                  | Monnaie, gains par message et en vocal, salons/rôles ignorés, daily, boutiques multiples (stock limité, bannière), classement auto, administration.  |
| Calendrier de l'Avent     | Du 1er au 24 décembre, une porte par jour et par membre : pièces et/ou objet configurables, annonce quotidienne, mode test.                          |
| Anniversaires             | Annonce quotidienne, rôle du jour optionnel, message personnalisable.                                                                                |
| Rappels                   | Rappels persistants ponctuels ou récurrents, salon ou MP.                                                                                            |
| Règlement                 | Publication d'un règlement avec bouton d'acceptation et rôle d'accès.                                                                                |
| Suggestions               | Votes, statut staff, fils de discussion, enrichissement Steam, limites par membre/rôle, classement & recherche, récompenses à l'approbation, couleur dynamique. |
| Starboard                 | Republie les messages qui atteignent un seuil de réactions.                                                                                          |
| Logs                      | Messages, membres, salons, rôles, modération, clear, boutons rollback selon l'événement.                                                             |
| Tickets                   | Plusieurs types de tickets, rôles par type, salon privé **ou fil privé**, format de nom personnalisable (`{type}`/`{number}`/`{user}`), archivage en fil. |
| Giveaways                 | Logs gagnants, messages de victoire/no winner personnalisables, participation par bouton.                                                            |
| Signalements              | Salon staff, rôle staff optionnel, thread ouvert au reporter, actions prendre/résoudre/ignorer.                                                      |
| Salons vocaux temporaires | Hubs join-to-create, héritage des permissions du générateur, salon perso, panel complet, whitelist/blacklist, transfert, sauvegarde préférences.     |
| Alertes stream & flux     | Annonce lives Twitch, vidéos YouTube, posts Reddit, articles RSS/Atom et deals Dealabs (filtre par mot-clé, variables `{prix}`/`{temperature}`), rôle mentionné, message custom. |
| Jeux gratuits             | Annonce les jeux gratuits à garder sur Steam, Epic Games et GOG (plateformes sélectionnables, contrôle toutes les 30 min), salon + rôle configurables ; `/jeuxgratuits` liste les offres. |
| Notes de patch            | Surveille les notes de patch de jeux/logiciels (catalogue de sources) et les publie dans les salons choisis, avec rôle mentionné.                    |
| Compteurs de serveur      | Salons vocaux renommés avec membres, bots, boosts, rôles, salons ou membres d'un rôle.                                                               |
| Vérification              | Bouton ou captcha image pour attribuer le rôle vérifié.                                                                                              |
| Commandes personnalisées  | Auto-réponses texte ou embed, variables, cooldown, suppression optionnelle du message.                                                               |
| Messages récurrents       | Publications automatiques quotidiennes, hebdomadaires ou par intervalle.                                                                             |
| Réactions de mots         | Ajoute des réactions sur mots-clés avec plusieurs modes de correspondance.                                                                           |
| Jeux                      | Active/désactive les mini-jeux et les stats de parties. Les parties (PFC, morpion, bataille navale) peuvent faire tomber des objets (drops) — voir « Objets & inventaires ». |
| Objets & inventaires      | Catalogue d'objets par serveur (nom, emoji, rareté, prix, rôle-récompense), achat avec la monnaie, inventaire, utilisation et échange entre membres. **Drops en jeu** : un pourcentage de drop par rareté (défini manuellement) fait tomber des objets à la fin des mini-jeux. |
| Route de l'Infini         | Aventure solo à événements aléatoires (trésor, monstre, tempête, oasis, ruines, loups, sanctuaire, bandits, volcan…) : PV, énergie, distance, pièces (économie), objets trouvés (barème de drop propre) et compteur de morts. Cooldown réglable.   |
| Bingo                     | Partie de Bingo par serveur : cartons 5×5 (1-75, centre libre), tirages par le staff, détection automatique de ligne ou de carton plein.             |
| Commandes d'informations  | Commandes en lecture seule (`/userinfo`, `/serverinfo`, `/avatar`, `/roleinfo`, `/emoji`) **et** un *journal des profils* optionnel : note dans un salon les changements de profil des membres (nom, nom affiché, photo de profil avec avant/après, pseudo serveur), avec filtre par rôles. |
| Sauvegarde de configuration | Export/import JSON de toute la configuration serveur (`/sauvegarde`), avec recréation/remappage optionnel des salons et rôles manquants à l'import. |
| Musique                   | Lecture audio dans les salons vocaux via Lavalink (YouTube, SoundCloud, Bandcamp… et Spotify/Deezer avec le plugin LavaSrc) : file d'attente, répétition, mélange, volume, seek, rôle DJ. Nécessite un serveur Lavalink (voir [Musique](#musique-lavalink)). |

## Points importants par module

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

Les dés dédiés existent pour D4, D6, D8, D10, D12, D20 et D100, avec option `nombre`. Les sorties sont compactes, par exemple `D8 (x2) : 10 (4+6)`. PFC, morpion et bataille navale fonctionnent contre le bot ou en duel contre un membre ; les parties alimentent `/statsjeux`. La bataille navale se joue sur une grille 8×8 dessinée en image : un bouton **Tirer** ouvre une zone de saisie pour indiquer la case visée (ex. `C7`). Contre le bot, l'image montre ta flotte et ta grille de tir. En duel contre un membre, l'image publique n'affiche que la grille de tir (navires adverses cachés) et chaque joueur consulte sa propre flotte en privé via le bouton **Ma flotte**, sans jamais voir celle de l'autre.

#### Drops d'objets

Si le module **Objets & inventaires** est activé et les drops configurés, les parties de PFC, morpion et bataille navale peuvent faire **tomber des objets** du catalogue. Dans `/config → Objets → 🎁 Drops` (ou le dashboard), on règle :

- **quand** un tirage a lieu (victoire seule, victoire + égalité, ou chaque partie) ;
- un **pourcentage de drop par rareté** (Commun, Rare, Épique, Légendaire), défini manuellement.

À chaque partie éligible, le tirage part de la rareté **la plus rare vers la plus commune** : la première dont le pourcentage réussit fait gagner un objet aléatoire de cette rareté (parmi ceux marqués **« Drop en jeu »**), ajouté à l'inventaire du membre et annoncé dans le salon. Un objet exclu des drops (bouton « Drop en jeu » désactivé) ne tombe jamais — pratique pour les objets à rôle-récompense.

La **Route de l'Infini** possède son **propre barème de drop**, **indépendant** de celui des mini-jeux : ses chances par rareté se règlent dans `/config → Route de l'Infini → 🎲 Chances de drop` (ou le dashboard). Le mécanisme est le même (tirage rareté par rareté, uniquement sur les objets « Drop en jeu »), déclenché par l'événement « marchand » quand « Distribuer les objets trouvés » est activé.

### Sauvegarde de configuration

`/sauvegarde exporter` produit un JSON de la configuration serveur. `importer` restaure les modules et peut recréer/remapper les salons et rôles manquants selon l'option `recreer`.

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

| Donnée         | Local              | Docker                                        |
| -------------- | ------------------ | --------------------------------------------- |
| SQLite         | `dev.db`           | `/app/data/prod.db` dans `vakzbot-data`       |
| Assets générés | `assets/generated` | `/app/assets/generated` dans `vakzbot-assets` |

Les migrations Prisma vivent dans `prisma/migrations` et sont appliquées au démarrage Docker.

## Intégrations externes

| Variable                                    | Usage                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Alertes Twitch live.                                                               |
| `YOUTUBE_API_KEY`                           | Optionnel pour YouTube ; le RSS fonctionne sans clé, l'API améliore la réactivité. |
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

| Script                    | Rôle                                            |
| ------------------------- | ----------------------------------------------- |
| `npm run dev`             | Lance le bot en développement avec `tsx watch`. |
| `npm run build`           | Compile TypeScript vers `dist/`.                |
| `npm start`               | Lance `dist/index.js`.                          |
| `npm run deploy`          | Déploie les slash commands en local/dev.        |
| `npm run deploy:prod`     | Déploie les slash commands depuis `dist/`.      |
| `npm run typecheck`       | Vérifie TypeScript sans émettre.                |
| `npm run lint`            | Lance ESLint.                                   |
| `npm run format`          | Formate tout le repo avec Prettier.             |
| `npm run format:check`    | Vérifie le format sans modifier.                |
| `npm run prisma:migrate`  | Crée/applique une migration en dev.             |
| `npm run prisma:deploy`   | Applique les migrations en production.          |
| `npm run prisma:generate` | Régénère le client Prisma.                      |

## Checklist de test

Après un pull sur VPS :

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs -f bot
```

À tester rapidement dans Discord :

1. `/config` : navigation par catégories, activation/désactivation, panneau d'un module.
2. Logs : supprimer un message, créer/modifier/supprimer un salon ou rôle, vérifier auteur + rollback.
3. Auto-modération : activer une règle simple, tester action et salon de logs.
4. Honeypot : créer/publier le salon piège et vérifier l'affichage.
5. Reports : `/report` avec lien de message, vérifier thread et accès reporter.
6. Giveaways : lancer un tirage court, participer, attendre le tirage, relancer.
7. Jeux : `/d8 nombre:2`, `/pfc`, `/morpion`, `/bataille`, `/statsjeux`.
8. Tempvoice : rejoindre un hub, vérifier création/suppression et panneau.

## Sécurité des secrets

Ne commit jamais `.env`. Si un token Discord fuite, régénère-le immédiatement dans le portail développeur Discord. Le dépôt ne doit contenir que `.env.example`.

## Licence

MIT.
