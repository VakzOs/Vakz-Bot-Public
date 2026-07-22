#!/usr/bin/env bash
#
# Host updater for Vakz-Bot.
#
# Watches the request file written by /maj, then runs:
#   git fetch/switch/pull + docker compose up -d --build --force-recreate
# It writes deploy.status during each phase and deploy.result at the end.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(pwd)}"
DATA_DIR="${DATA_DIR:-$REPO_DIR/data}"

REQUEST_FILE="$DATA_DIR/deploy.request"
RESULT_FILE="$DATA_DIR/deploy.result"
STATUS_FILE="$DATA_DIR/deploy.status"
LOG_TMP="$DATA_DIR/.deploy.log.tmp"
REQUEST_PAYLOAD=""
REQUESTED_BRANCH=""
BEFORE_COMMIT="unknown"

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

write_status() {
  local phase="$1" message="${2:-}" state="${3:-running}" commit branch
  commit="$(current_commit)"
  branch="$(current_branch)"
  mkdir -p "$DATA_DIR"
  PHASE="$phase" MESSAGE="$message" STATE="$state" BRANCH="$branch" REQUESTED_BRANCH="${REQUESTED_BRANCH:-$BRANCH}" COMMIT="$commit" OUT="$STATUS_FILE" \
    LOGFILE="$LOG_TMP" REQUEST_PAYLOAD="$REQUEST_PAYLOAD" python3 - <<'PY'
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
  STATUS="$status" COMMIT="$commit" BRANCH="$branch" REQUESTED_BRANCH="${REQUESTED_BRANCH:-$BRANCH}" BEFORE_COMMIT="$BEFORE_COMMIT" REPO_DIR="$REPO_DIR" OUT="$RESULT_FILE" LOGFILE="$LOG_TMP" python3 - <<'PY'
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
            "finishedAt": datetime.datetime.now().astimezone().isoformat(),
            "log": log[-1500:],
        },
        fh,
        ensure_ascii=False,
    )
PY
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
  : >"$LOG_TMP"
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
  echo "[vakzbot-updater] repo=$REPO_DIR requested_branch=$REQUESTED_BRANCH start_branch=$(current_branch) start_commit=$BEFORE_COMMIT data=$DATA_DIR"

  if (
    set -e
    write_status "fetching" "Recuperation de origin/$BRANCH." "running"
    echo "[vakzbot-updater] git -C $REPO_DIR fetch --prune origin $BRANCH"
    git_repo fetch --prune origin "$BRANCH"
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
    write_status "building" "Rebuild et redemarrage Docker Compose en cours." "running"
    echo "[vakzbot-updater] docker compose up -d --build --force-recreate"
    cd "$REPO_DIR"
    docker compose up -d --build --force-recreate
    echo "[vakzbot-updater] docker compose finished"
  ) >>"$LOG_TMP" 2>&1; then
    write_result success
    write_status "success" "Mise a jour terminee, conteneur relance si necessaire." "success"
    echo "[vakzbot-updater] finished: success"
  else
    write_result failure
    write_status "failure" "La mise a jour a echoue. Voir deploy.result/deploy.status." "failure"
    echo "[vakzbot-updater] finished: failure"
  fi
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
