#!/usr/bin/env bash
#
# Host updater for Vakz-Bot.
#
# Watches the request file written by /maj (or by the nightly FORCE_UPDATE
# task), then runs git fetch/switch/pull followed by one of two rebuilds,
# picked by the request's "mode" field:
#   full  (default, and what an older bot's request means)
#         docker compose up -d --build --force-recreate
#         Every container of the project is recreated; the bot always restarts.
#   cache docker compose up -d --build "$COMPOSE_SERVICE"
#         Docker reuses its layer cache, only the bot service is targeted, and
#         Compose recreates the container only if the image actually changed —
#         so an update that changes nothing does not cut the bot off.
# It writes deploy.status during each phase and deploy.result at the end.
# Requests carrying "skipIfUpToDate" (nightly auto-update) stop right after the
# fetch when the repo is already on origin/<branch>: no rebuild, no restart.
set -euo pipefail

# Jamais de prompt interactif d'identifiants. L'updater tourne sous systemd
# (root, sans TTY) : si le credential git est perime (ex. token regenere) ou
# mal forme, `git fetch` ne DOIT PAS bloquer sur un prompt "Password:" ni
# aboutir a un etat ambigu -> il doit ECHOUER franchement pour que `/maj`
# rapporte un echec au lieu de laisser le depot sur un ancien commit.
export GIT_TERMINAL_PROMPT=0

REPO_DIR="${REPO_DIR:-$(pwd)}"
DATA_DIR="${DATA_DIR:-$REPO_DIR/data}"

REQUEST_FILE="$DATA_DIR/deploy.request"
RESULT_FILE="$DATA_DIR/deploy.result"
STATUS_FILE="$DATA_DIR/deploy.status"
BRANCHES_FILE="$DATA_DIR/deploy.branches"
LOG_TMP="$DATA_DIR/.deploy.log.tmp"
REQUEST_PAYLOAD=""
REQUESTED_BRANCH=""
BEFORE_COMMIT="unknown"
# Service Compose vise par le mode "cache". Surchargeable si le service porte
# un autre nom dans un docker-compose.yml derive.
COMPOSE_SERVICE="${COMPOSE_SERVICE:-bot}"
# Mode de reconstruction de la demande en cours (voir l'en-tete).
DEPLOY_MODE="full"

mkdir -p "$DATA_DIR"

git_repo() {
  git -c safe.directory="$REPO_DIR" -C "$REPO_DIR" "$@"
}

current_commit() {
  git_repo rev-parse HEAD 2>>"$LOG_TMP" || echo unknown
}

current_branch() {
  git_repo rev-parse --abbrev-ref HEAD 2>>"$LOG_TMP" || echo unknown
}

# Par defaut : la branche actuellement extraite dans REPO_DIR (repli sur main).
# Ainsi `/maj` met a jour la branche reellement deployee, pas forcement main.
BRANCH="${BRANCH:-$(current_branch)}"
[ -n "$BRANCH" ] && [ "$BRANCH" != "unknown" ] || BRANCH="main"

# --- Construire, puis SEULEMENT ENSUITE demarrer ------------------------------
#
# `docker compose up -d --build` a ete pris en flagrant delit : un `npm ci` en
# echec, un « failed to solve » dans sa sortie, et un code de sortie 0. Le
# `set -e` du sous-shell n'a rien vu, l'updater a ecrit « success », le
# conteneur a continue de tourner sur l'ancienne image — et TROIS mises a jour
# se sont perdues sans que personne ne le sache (18/09/2026, constructeur
# bake). Un build rate qui se declare reussi est pire qu'un build rate.
#
# D'ou deux gardes plutot qu'une, et dans cet ordre :
#   1. le build est SEPARE du demarrage. `docker compose build` a son propre
#      code de sortie, qu'on interroge AVANT de toucher au conteneur ;
#   2. sa sortie est relue a la recherche des marqueurs d'echec de BuildKit,
#      parce qu'on sait desormais qu'un code de sortie peut mentir.
# Le conteneur n'est demarre que si les deux sont d'accord.
construire() {
  local journal rc=0
  journal="$(mktemp)"
  echo "[vakzbot-updater] docker compose build $*"
  docker compose build "$@" >"$journal" 2>&1 || rc=$?
  cat "$journal"
  if [ "$rc" -ne 0 ]; then
    echo "[vakzbot-updater] BUILD EN ECHEC (code $rc) : le conteneur n'est pas touche."
    rm -f "$journal"
    return 1
  fi
  if grep -qE 'failed to solve|did not complete successfully|^ERROR: ' "$journal"; then
    echo "[vakzbot-updater] BUILD EN ECHEC : code de sortie 0, mais la sortie dit le contraire."
    echo "[vakzbot-updater] Compose n'a pas propage l'echec (voir ci-dessus). Le conteneur n'est pas touche."
    rm -f "$journal"
    return 1
  fi
  rm -f "$journal"
  return 0
}

# Le service tourne-t-il VRAIMENT apres `up` ? Un `up` peut rendre la main sans
# que le conteneur tienne debout : entrypoint qui sort (migrations en echec),
# image absente. On laisse quelques secondes au demarrage avant de conclure.
verifier_service() {
  local id etat="" i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    id="$(docker compose ps -q "$COMPOSE_SERVICE" 2>/dev/null | head -n1 || true)"
    if [ -n "$id" ]; then
      etat="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo '')"
      [ "$etat" = "running" ] && { echo "[vakzbot-updater] service $COMPOSE_SERVICE en marche"; return 0; }
    fi
    sleep 2
  done
  echo "[vakzbot-updater] le service $COMPOSE_SERVICE n'est PAS en marche (etat=${etat:-inconnu})"
  return 1
}

write_status() {
  local phase="$1" message="${2:-}" state="${3:-running}" commit branch
  commit="$(current_commit)"
  branch="$(current_branch)"
  mkdir -p "$DATA_DIR"
  PHASE="$phase" MESSAGE="$message" STATE="$state" BRANCH="$branch" REQUESTED_BRANCH="${REQUESTED_BRANCH:-$BRANCH}" COMMIT="$commit" OUT="$STATUS_FILE" \
    MODE="$DEPLOY_MODE" LOGFILE="$LOG_TMP" REQUEST_PAYLOAD="$REQUEST_PAYLOAD" python3 - <<'PY'
import json, os, datetime
request = {}
raw_request = os.environ.get("REQUEST_PAYLOAD", "").strip()
if raw_request:
    try:
        request = json.loads(raw_request)
    except json.JSONDecodeError:
        request = {"raw": raw_request}
log = ""
try:
    with open(os.environ["LOGFILE"], encoding="utf-8", errors="replace") as fh:
        log = fh.read()
except FileNotFoundError:
    pass
payload = {
    "phase": os.environ["PHASE"],
    "state": os.environ["STATE"],
    "message": os.environ["MESSAGE"],
    "branch": os.environ["BRANCH"],
    "requestedBranch": os.environ.get("REQUESTED_BRANCH") or os.environ["BRANCH"],
    "commit": os.environ["COMMIT"],
    "mode": os.environ.get("MODE") or "full",
    "updatedAt": datetime.datetime.now().astimezone().isoformat(),
    "log": log[-1500:],
}
if isinstance(request, dict):
    for key in ("requestedBy", "requestedAt"):
        if key in request:
            payload[key] = request[key]
with open(os.environ["OUT"], "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False)
PY
}

write_result() {
  local status="$1" commit branch
  commit="$(current_commit)"
  branch="$(current_branch)"
  mkdir -p "$DATA_DIR"
  STATUS="$status" COMMIT="$commit" BRANCH="$branch" REQUESTED_BRANCH="${REQUESTED_BRANCH:-$BRANCH}" BEFORE_COMMIT="$BEFORE_COMMIT" MODE="$DEPLOY_MODE" REPO_DIR="$REPO_DIR" OUT="$RESULT_FILE" LOGFILE="$LOG_TMP" python3 - <<'PY'
import json, os, datetime
log = ""
try:
    with open(os.environ["LOGFILE"], encoding="utf-8", errors="replace") as fh:
        log = fh.read()
except FileNotFoundError:
    pass
with open(os.environ["OUT"], "w", encoding="utf-8") as fh:
    json.dump(
        {
            "status": os.environ["STATUS"],
            "branch": os.environ.get("BRANCH"),
            "requestedBranch": os.environ.get("REQUESTED_BRANCH"),
            "repoDir": os.environ.get("REPO_DIR"),
            "beforeCommit": os.environ.get("BEFORE_COMMIT"),
            "commit": os.environ["COMMIT"],
            "mode": os.environ.get("MODE") or "full",
            "finishedAt": datetime.datetime.now().astimezone().isoformat(),
            # 1500 caracteres ne montraient que la toute fin d'un build
            # rate : de quoi voir "erreur" sans voir laquelle.
            "log": log[-20000:],
        },
        fh,
        ensure_ascii=False,
    )
PY
}

# Publie la liste des branches du depot distant dans le dossier partage.
#
# Le conteneur du bot n'a ni le depot ni les identifiants git : sans ce fichier,
# le selecteur de /maj et celui du dashboard ne connaitraient que les branches
# saisies a la main. Best-effort : un echec (reseau, credential perime) laisse
# l'ancienne liste en place et ne fait pas echouer la mise a jour.
publish_branches() {
  local refs
  refs="$(git_repo ls-remote --heads origin 2>/dev/null)" || return 0
  [ -n "$refs" ] || return 0
  REFS="$refs" OUT="$BRANCHES_FILE" python3 - <<'PYBLOCK' || true
import json, os

names = []
for line in os.environ["REFS"].splitlines():
    parts = line.split("refs/heads/", 1)
    if len(parts) == 2 and parts[1]:
        names.append(parts[1])

tmp = os.environ["OUT"] + ".tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(sorted(set(names)), handle, ensure_ascii=False)
os.replace(tmp, os.environ["OUT"])
PYBLOCK
}

# --- Securite : deploy.request est une frontiere de confiance ---
# Ce script tourne en root (unit systemd) et rebuild+relance les conteneurs.
# QUICONQUE peut ecrire dans "$DATA_DIR" declenche donc une execution root sur
# l'hote. Traiter l'acces en ecriture a ./data comme EQUIVALENT a un acces root.
# On ne fait jamais confiance au champ "branch" du payload sans le valider :
# une valeur a tiret initial (ex. "--upload-pack=...") serait interpretee par
# git comme une OPTION -> vecteur d'execution de commande connu.
validate_branch() {
  local candidate="$1"

  if [ -z "$candidate" ]; then
    echo "[vakzbot-updater] branche vide refusee" >>"$LOG_TMP"
    return 1
  fi

  # Pas de tiret initial (anti argument-injection git).
  case "$candidate" in
    -*)
      echo "[vakzbot-updater] branche '$candidate' refusee (tiret initial)" >>"$LOG_TMP"
      return 1
      ;;
  esac

  # Jeu de caracteres strict.
  if ! printf '%s' "$candidate" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
    echo "[vakzbot-updater] branche '$candidate' refusee (caracteres invalides)" >>"$LOG_TMP"
    return 1
  fi

  # Nom de ref git syntaxiquement valide (verif pure, sans depot).
  if ! git check-ref-format "refs/heads/$candidate" >/dev/null 2>&1; then
    echo "[vakzbot-updater] branche '$candidate' refusee (ref git invalide)" >>"$LOG_TMP"
    return 1
  fi

  # Allowlist optionnelle : si DEPLOY_BRANCHES est defini (CSV), la branche
  # DOIT en faire partie. Meme liste que le selecteur de /maj cote bot.
  if [ -n "${DEPLOY_BRANCHES:-}" ]; then
    local ok="" allowed
    local IFS=','
    for allowed in $DEPLOY_BRANCHES; do
      allowed="$(printf '%s' "$allowed" | tr -d '[:space:]')"
      [ -n "$allowed" ] || continue
      if [ "$allowed" = "$candidate" ]; then
        ok=1
        break
      fi
    done
    if [ -z "$ok" ]; then
      echo "[vakzbot-updater] branche '$candidate' hors allowlist DEPLOY_BRANCHES" >>"$LOG_TMP"
      return 1
    fi
  fi

  return 0
}

run_update() {
  [ -f "$REQUEST_FILE" ] || return 0
  REQUEST_PAYLOAD="$(cat "$REQUEST_FILE" 2>/dev/null || true)"
  # Le mode `loop` reutilise le meme process : on repart du defaut a chaque
  # demande, sinon un `cache` s'appliquerait a la demande suivante.
  DEPLOY_MODE="full"
  : >"$LOG_TMP"

  # Demande de LISTE : le bot veut juste connaitre les branches du depot.
  #
  # Elle passe par le meme fichier que /maj pour reutiliser l'unite systemd
  # `.path` deja installee (elle surveille deploy.request) : rien a
  # reconfigurer sur l'hote. On sort AVANT d'ecrire le moindre statut, sinon
  # une simple demande de liste effacerait le resultat du dernier /maj affiche
  # par le dashboard. Ni git fetch, ni rebuild, ni redemarrage.
  ACTION="$(
    printf '%s' "$REQUEST_PAYLOAD" | python3 -c 'import sys, json
try:
    print((json.load(sys.stdin) or {}).get("action", "") or "")
except Exception:
    print("")' 2>/dev/null || true
  )"
  if [ "$ACTION" = "branches" ]; then
    rm -f "$REQUEST_FILE"
    publish_branches
    echo "[vakzbot-updater] liste des branches publiee dans $BRANCHES_FILE"
    rm -f "$LOG_TMP"
    return 0
  fi

  write_status "picked_up" "Demande prise en charge par l'updater hote." "running"
  rm -f "$REQUEST_FILE"

  # Branche demandee par /maj (champ "branch" du payload) : elle prime.
  REQ_BRANCH="$(
    printf '%s' "$REQUEST_PAYLOAD" | python3 -c 'import sys, json
try:
    print((json.load(sys.stdin) or {}).get("branch", "") or "")
except Exception:
    print("")' 2>/dev/null || true
  )"
  [ -n "$REQ_BRANCH" ] && BRANCH="$REQ_BRANCH"
  REQUESTED_BRANCH="$BRANCH"

  # Mise a jour AUTOMATIQUE (FORCE_UPDATE cote bot) : le payload porte
  # "skipIfUpToDate". Le depot deja aligne sur origin/$BRANCH => on ne
  # reconstruit RIEN. Sans ca, chaque nuit rebuild l image et redemarre le bot
  # pour zero changement. Un /maj manuel, lui, force toujours le rebuild.
  SKIP_IF_UP_TO_DATE="$(
    printf '%s' "$REQUEST_PAYLOAD" | python3 -c 'import sys, json
try:
    print("1" if (json.load(sys.stdin) or {}).get("skipIfUpToDate") else "")
except Exception:
    print("")' 2>/dev/null || true
  )"

  # Mode de reconstruction. Frontiere de confiance, comme la branche : on
  # n'accepte QUE la valeur connue "cache" et on retombe sur "full" pour tout
  # le reste — champ absent (bot plus ancien que cet updater), valeur inconnue
  # ou fantaisiste. Le mode n'est jamais interpole dans une commande : il ne
  # fait que choisir entre deux invocations ecrites en dur ci-dessous.
  REQ_MODE="$(
    printf '%s' "$REQUEST_PAYLOAD" | python3 -c 'import sys, json
try:
    print((json.load(sys.stdin) or {}).get("mode", "") or "")
except Exception:
    print("")' 2>/dev/null || true
  )"
  if [ "$REQ_MODE" = "cache" ]; then
    DEPLOY_MODE="cache"
  else
    DEPLOY_MODE="full"
    if [ -n "$REQ_MODE" ] && [ "$REQ_MODE" != "full" ]; then
      echo "[vakzbot-updater] mode '$REQ_MODE' inconnu, repli sur 'full'" >>"$LOG_TMP"
    fi
  fi

  # Frontiere de confiance : on valide la branche AVANT toute commande git.
  if ! validate_branch "$BRANCH"; then
    write_result failure
    write_status "failure" "Branche demandee refusee (invalide ou hors allowlist)." "failure"
    echo "[vakzbot-updater] finished: rejected branch '$BRANCH'"
    rm -f "$LOG_TMP"
    return 0
  fi

  BEFORE_COMMIT="$(current_commit)"

  echo "[vakzbot-updater] update requested $(date -Is)"
  echo "[vakzbot-updater] repo=$REPO_DIR requested_branch=$REQUESTED_BRANCH start_branch=$(current_branch) start_commit=$BEFORE_COMMIT data=$DATA_DIR mode=$DEPLOY_MODE"

  local update_rc=0
  (
    set -e
    write_status "fetching" "Recuperation de origin/$BRANCH." "running"
    # Refspec EXPLICITE (source:destination) : indispensable. Un simple
    # `git fetch origin $BRANCH` ne met a jour QUE FETCH_HEAD tant que la
    # branche n'est pas couverte par un refspec configure (clone
    # `--single-branch`/`--depth`, ou `remote.origin.fetch` restreint). Dans ce
    # cas `refs/remotes/origin/$BRANCH` reste PERIME, et le `reset --hard
    # origin/$BRANCH` ci-dessous se recale sur l'ANCIEN commit tout en
    # rapportant un succes (symptome : "commit avant == commit apres" alors que
    # le distant a avance). Le `+` force la mise a jour non fast-forward.
    echo "[vakzbot-updater] git -C $REPO_DIR fetch --prune origin +refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
    git_repo fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
    # AVANT la sortie "deja a jour" : un /maj sans changement est justement
    # l'occasion de rafraichir la liste des branches, et c'est souvent ce qu'on
    # vient de faire apres avoir pousse une branche.
    publish_branches
    # Sortie 3 = "rien a faire" (voir le case plus bas). On exige aussi que la
    # branche extraite SOIT la branche demandee : sinon il faut basculer dessus.
    if [ -n "$SKIP_IF_UP_TO_DATE" ] \
      && [ "$(current_branch)" = "$BRANCH" ] \
      && [ "$(current_commit)" = "$(git_repo rev-parse "origin/$BRANCH" 2>/dev/null || echo none)" ]; then
      echo "[vakzbot-updater] deja a jour sur origin/$BRANCH ($(current_commit)) : rebuild ignore"
      exit 3
    fi
    write_status "switching" "Positionnement sur la branche $BRANCH." "running"
    # `checkout -B` (re)cree la branche locale directement sur origin/$BRANCH :
    # gere la premiere extraction ET une branche locale perimee (evite de revenir
    # sur un ancien commit deja extrait par un /maj precedent).
    echo "[vakzbot-updater] git -C $REPO_DIR checkout -B $BRANCH origin/$BRANCH"
    git_repo checkout -B "$BRANCH" "origin/$BRANCH"
    write_status "pulling" "Alignement exact sur origin/$BRANCH." "running"
    # reset --hard : on s'aligne exactement sur le distant, y compris apres un
    # historique reecrit cote remote (force-push) ou `git pull --ff-only` echouerait.
    echo "[vakzbot-updater] git -C $REPO_DIR reset --hard origin/$BRANCH"
    git_repo reset --hard "origin/$BRANCH"
    echo "[vakzbot-updater] after sync branch=$(current_branch) commit=$(current_commit)"
    if [ "$DEPLOY_MODE" = "cache" ]; then
      # Mode rapide : Docker reutilise ses couches (il le fait deja par
      # defaut), mais surtout on ne passe PAS --force-recreate et on ne vise
      # que le service du bot. Compose ne recree alors le conteneur que si
      # l'image (ou la config du service) a reellement change ; flaresolverr et
      # les autres ne sont pas balayes au passage. Ses dependances sont quand
      # meme demarrees si elles sont a l'arret : `up` s'en charge.
      write_status "building" "Rebuild rapide (cache Docker, service $COMPOSE_SERVICE)." "running"
      cd "$REPO_DIR"
      construire "$COMPOSE_SERVICE"
      echo "[vakzbot-updater] docker compose up -d $COMPOSE_SERVICE"
      docker compose up -d "$COMPOSE_SERVICE"
      verifier_service
    else
      write_status "building" "Rebuild et redemarrage Docker Compose en cours." "running"
      cd "$REPO_DIR"
      construire
      echo "[vakzbot-updater] docker compose up -d --force-recreate"
      docker compose up -d --force-recreate
      verifier_service
    fi
    echo "[vakzbot-updater] docker compose finished"
  ) >>"$LOG_TMP" 2>&1 || update_rc=$?

  case "$update_rc" in
    0)
      write_result success
      write_status "success" "Mise a jour terminee, conteneur relance si necessaire." "success"
      echo "[vakzbot-updater] finished: success"
      ;;
    3)
      write_result success
      write_status "up_to_date" "Deja a jour : aucune reconstruction necessaire." "success"
      echo "[vakzbot-updater] finished: already up to date (no rebuild)"
      ;;
    *)
      write_result failure
      write_status "failure" "La mise a jour a echoue. Voir deploy.result/deploy.status." "failure"
      echo "[vakzbot-updater] finished: failure"
      ;;
  esac
  rm -f "$LOG_TMP"
}

case "${1:-once}" in
  once) run_update ;;
  loop)
    while true; do
      run_update || echo "[vakzbot-updater] error, continuing"
      sleep 10
    done
    ;;
  *)
    echo "usage: $0 [once|loop]" >&2
    exit 2
    ;;
esac
