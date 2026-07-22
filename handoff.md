# Vakz-Bot — Passation (handoff pour une IA qui reprend)

> Document de passation : donne à une IA fraîche tout le contexte pour continuer
> **sans relire l'historique**. Écris en français avec l'utilisateur (Eric). Le bot
> s'appelle **Vakz-Bot** (thème chat / « MeowBot »).

## 1. But du projet

Bot Discord **FR**, **multi-serveurs**, **modulaire**, **100 % gratuit**, auto-hébergé
(VPS Oracle ARM64, Docker Compose), qui reproduit les modules de **DraftBot**
**sans paywall**. Tout se configure via `/config` (panneaux interactifs). i18n FR+EN.

## 2. Stack & conventions (NON négociables)

- TypeScript strict (`noUncheckedIndexedAccess` → l'indexation array donne `T|undefined`).
- Node 20+, discord.js v14, Prisma + SQLite, node-cron, zod, pino, ESLint+Prettier.
- Docker `node:20-slim` ARM64. `@napi-rs/canvas` pour les images (police DejaVu).
- **node-emoji** (dep) pour résoudre `:red_car:` → 🚗 (voir `src/lib/emoji.ts`).
- **Système de modules** : `src/modules/<nom>/index.ts` → `export default defineModule({...})`.
  - `SlashCommand{ data, guildOnly?, execute(interaction, ctx), autocomplete? }`.
  - `ComponentHandler{ prefix, handle(interaction, ctx) }` — routeur dispatch par
    `customId.split('|')[0]`. UN préfixe par module.
  - `ConfigPanel{ render(ctx,guildId)→{embed,components}, handle(args) }` ;
    `panelCustomId(module, action, ...params)` = `cfg|<module>|<action>|<params>`.
    `PanelPage = { embeds: EmbedBuilder[]; components: PanelRow[] }`.
  - `ScheduledTask{ name, cron, execute(ctx) }`. `defineEvent({ name, once?, execute(ctx, ...args) })`.
  - `BotContext`: `{ client, db (PrismaClient), logger (pino), t, config, scheduler }`.
    `ctx.config.getModuleState<T>(guildId, MODULE_NAME, zodSchema)`, `ctx.config.setConfig`,
    `ctx.config.isEnabled(guildId, MODULE_NAME)`.
- **Catégories `/config`** : `src/core/config-panel.ts` → `MODULE_VISUALS` mappe CHAQUE
  module non-interne → `{ category, emoji }`. Catégories : security | community |
  engagement | operations | fun. **Un module oublié tombe dans « operations » par
  défaut** → toujours l'ajouter à `MODULE_VISUALS` (piège déjà rencontré avec bingo).
- Limites Discord : 25 options select, 5 rows/message, label bouton ≤80, description
  slash ≤100, label/titre modal ≤45. Les panneaux « home » ont 1 row de chrome
  prependue (donc 4 rows utiles) ; les sous-vues via `interaction.update(...)` ont 5 rows.
- i18n : `t(key, vars?)`, interpolation `{var}`, **pas de tableaux** (utiliser des
  chaînes `|`-jointes + `.split('|')`). Édition JSON via Python round-trip
  (`json.load` OrderedDict → modifier → `json.dumps(ensure_ascii=False, indent=2)+'\n'`).
- **Migrations Prisma APPEND-ONLY** (ne JAMAIS éditer une migration publiée). Format :
  `prisma/migrations/AAAAMMJJHHMMSS_nom/migration.sql`. Après édition du schéma :
  `npx prisma generate` puis écrire la migration SQL à la main (cf. migrations existantes).

## 3. Contraintes de travail (RÈGLES)

- **Aucun secret** (token, `.env`, `*.db`) dans Git. Vérifier `git diff --cached` avant
  chaque commit (scan `DISCORD_TOKEN=`, `.env`, `.db`).
- Développer/pusher **UNIQUEMENT** sur la branche `claude/optimistic-goodall-wcxypa`.
- **Codex bosse en parallèle sur la MÊME branche** → avant de pousser, `git fetch` +
  `git rebase origin/claude/optimistic-goodall-wcxypa` (conflits rares, modules séparés).
  Après rebase touchant le schéma Prisma : `npx prisma generate`.
- Workflow : push branche → PR vers main → **STOP**, laisser l'utilisateur tester/merger.
  Après merge : `git fetch origin main && git checkout -B claude/optimistic-goodall-wcxypa
  origin/main` (repartir propre = nouvelle PR).
- Identité modèle `claude-opus-4-8` **jamais** dans commits/PR/code (chat seulement).
- Trailers de commit obligatoires :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01S9MomHYSkb6SxmEpiVt9Cr
  ```
- Push avec retry réseau ; **jamais** de `--force` sans accord explicite (l'auto-mode
  bloque le force-push). Si push rejeté (non-fast-forward) → c'est Codex, rebaser.

## 4. ÉTAT ACTUEL (au moment de la passation)

- Branche : `claude/optimistic-goodall-wcxypa`. **main** = `a691727` (après merge PR #30).
- **PR #31 OUVERTE** (non mergée) = tout le travail depuis a691727. HEAD ≈ `083fb07`
  (merge Codex). Contenu de #31 : `/maj` (module deploy, moi + Codex), Route de l'Infini,
  Bingo (+ image), Jeux gratuits Steam, fix presence/config/rôles-réactions/tempvoice.
- **Tout compile** : `npx tsc --noEmit` OK, `npx eslint src/` OK, `prettier --check` OK.
  Migrations récentes : traveler, bingo, tempvoice_state, free_games.

### Modules livrés dans PR #31 (nouveaux depuis main)

- **deploy** (`/maj`, `src/modules/deploy/`) : commande owner-only (`BOT_OWNER_ID`) qui
  écrit `DEPLOY_DIR/deploy.request` ; l'updater hôte `scripts/vakzbot-updater.sh` (+
  units systemd `scripts/systemd/vakzbot-update.{path,service}`) fait fetch/switch/pull +
  `docker compose up -d --build`. **Sélecteur de branche** dans `/maj` (env
  `DEPLOY_BRANCHES`, virgules) ; progression (`deploy.status`), notif post-reboot,
  presence (Codex). Par défaut déploie la branche extraite dans REPO_DIR.
- **route** (Route de l'Infini) : `/route avancer|profil|classement`, events aléatoires
  pondérés (PV/énergie/distance/pièces), récompenses éco+objets, cooldown réglable.
  Modèle `Traveler`.
- **bingo** : `/bingo demarrer|rejoindre|carte|tirer|terminer`, carton 5×5 rendu en
  **image** (`render.ts`, numéros tirés en rouge), affichage auto du carton à chaque
  tirage + bouton « Mon carton ». Modèles `BingoGame`/`BingoCard`.
- **freegames** (Jeux gratuits Steam) : tâche 30 min → API Steam `featuredcategories`,
  filtre 100 % offerts, annonce dans un salon (rôle optionnel), dédup via
  `FreeGameAnnouncement`. `/jeuxgratuits` liste le moment. ⚠️ Le proxy de l'env de DEV
  bloque store.steampowered.com → testé par mock, marchera en prod (internet direct).

## 5. RESTE À FAIRE (Phase 4 — Jeux & Fun / avancé)

Déjà faits : vocaux temporaires, commandes perso, messages récurrents, salons stats,
réactions de mots, infos+jeux+stats jeux, objets & inventaires, Route de l'Infini &
Bingo, notifications sociales (Twitch/YouTube + Steam gratuits). **Restants :**

- **Interserveurs** (relais de messages/chat entre serveurs) — le plus complexe.
- **Calendrier de l'Avent** (récompenses jour par jour, éco/objets — saisonnier).
- **Messages interactifs** (embeds/menus réutilisables : boutons rôles/liens).

Puis **Phase 5 = Dashboard web** (Next.js, OAuth2 Discord) tout à la fin.
Recommandation : quand #31 est mergée, repartir de main propre → nouvelle PR pour le
prochain module (« Messages interactifs » = le plus rapide).

## 6. Vérification avant CHAQUE commit

```bash
npx prisma generate                 # si le schéma a changé (le client n'est PAS committé)
npx tsc --noEmit                    # doit être clean
npx eslint src/                     # doit être clean
npx prettier --write <fichiers>     # puis --check
```

- Test logique : écrire un `.mts` **DANS le repo** (pas un dossier externe, sinon
  node_modules introuvable), lancer via
  `DISCORD_TOKEN=x DISCORD_CLIENT_ID=1 DATABASE_URL="file:./dev.db" npx tsx ./x.mts`, puis `rm`.
  Sans ces env vars, `env.ts` fait `process.exit(1)`.
- Test DB : `DATABASE_URL="file:/tmp/t.db" npx prisma migrate deploy` puis PrismaClient.
- Valider les slash builders via `.data.toJSON()` (desc > 100 chars = throw runtime !).
- Ne PAS lancer le bot en vrai (pas de token). Le proxy de dev bloque certaines API externes.

## 7. Notes /maj (test sur branche dev côté utilisateur)

Sur le VPS : `.env` avec `BOT_OWNER_ID=<son id>`, `DEPLOY_DIR=/app/data`,
`DEPLOY_BRANCHES=main,claude/optimistic-goodall-wcxypa`. Un `docker compose up -d --build`
« à l'ancienne » une fois, puis `/maj` → sélecteur → branche dev → Mettre à jour.
`docker-compose.yml` monte `./data:/app/data` (bind mount).

## 8. Goûts/retours de l'utilisateur (à respecter)

- Dés : format texte brut `D8 (x2) : 10 (4+6)`, pas d'embed.
- Rôles-réactions : **réactions natives** (pas boutons), façon DraftBot (embed
  « emoji | libellé » + le bot pose les réactions). NE PAS revenir aux boutons.
- Bingo classé en « Fun » ; carton en image, chiffres tirés en rouge.
- Statuts du bot = actions de chat (pas de « sieste compilée »). Voir `src/core/presence.ts`.
- Objets `/acheter` : lister tous les objets `buyable` (prix 0 = gratuit).
- Éviter l'écriture inclusive (ex. « vérifié » pas « vérifié.e »).
- Salons vocaux temporaires : héritent des permissions du salon générateur.
- Toujours répondre en français, concis. Ouvrir les PR quand demandé.
