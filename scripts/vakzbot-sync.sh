#!/usr/bin/env bash
#
# Host runner de la publication vers le miroir public.
#
# Pendant exact de `vakzbot-updater.sh`, pour la meme raison : le bot tourne
# dans un conteneur et ne peut pas pousser sur GitHub. Il ecrit donc une
# demande dans `$DATA_DIR/sync.request`, et ce script -- surveille par une unit
# systemd `.path` -- la ramasse et execute `sync-public.sh`.
#
# Il ecrit `sync.status` pendant, `sync.result` a la fin, et `.sync.log.tmp`
# tout du long (le dashboard le lit pour montrer l'avancement).
set -euo pipefail

export GIT_TERMINAL_PROMPT=0

REPO_DIR="${REPO_DIR:-$(pwd)}"
DATA_DIR="${DATA_DIR:-$REPO_DIR/data}"

REQUEST_FILE="$DATA_DIR/sync.request"
RESULT_FILE="$DATA_DIR/sync.result"
STATUS_FILE="$DATA_DIR/sync.status"
LOG_TMP="$DATA_DIR/.sync.log.tmp"
# Socle d'exclusions rapporte par sync-public.sh, lu par le bot pour l'afficher.
BASELINE_FILE="$DATA_DIR/sync.baseline"

mkdir -p "$DATA_DIR"

write_status() {
  PHASE="$1" MESSAGE="$2" STATE="${3:-running}" DRY="${DRY_RUN:-1}" TGT="${TARGET:-bot}" OUT="$STATUS_FILE" python3 - <<'PY'
import json, os, datetime
out = os.environ["OUT"]
tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump({
        "phase": os.environ["PHASE"],
        "state": os.environ["STATE"],
        "message": os.environ["MESSAGE"],
        "dryRun": os.environ["DRY"] == "1",
        "target": os.environ.get("TGT") or "bot",
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, fh)
    fh.write("\n")
os.replace(tmp, out)
PY
}

write_result() {
  STATUS="$1" DRY="${DRY_RUN:-1}" TGT="${TARGET:-bot}" LOGFILE="$LOG_TMP" OUT="$RESULT_FILE" python3 - <<'PY'
import json, os, datetime
log = ""
try:
    with open(os.environ["LOGFILE"], encoding="utf-8", errors="replace") as fh:
        log = fh.read()[-8000:]
except OSError:
    pass
# Le `git show --stat` que sync-public.sh affiche avant de pousser : c'est la
# reponse a « qu'est-ce que je viens de publier ? », et elle se perdrait dans
# le reste du journal.
stat = ""
marker = "Changements a publier :"
if marker in log:
    stat = log.split(marker, 1)[1].strip()[:4000]
out = os.environ["OUT"]
tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump({
        "status": os.environ["STATUS"],
        "dryRun": os.environ["DRY"] == "1",
        "target": os.environ.get("TGT") or "bot",
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "stat": stat,
        "log": log,
    }, fh)
    fh.write("\n")
os.replace(tmp, out)
PY
}

# --- Securite : sync.request est une frontiere de confiance -------------------
# Comme deploy.request (voir vakzbot-updater.sh) : qui peut ecrire dans
# "$DATA_DIR" declenche une execution privilegiee sur l'hote. Chaque motif
# d'exclusion finit en `rsync --exclude=<motif>` -- un tiret initial en ferait
# une OPTION, un `..` ou un chemin absolu ferait sortir de l'arborescence.
# Le bot valide deja tout cela ; on ne s'en remet pas a lui pour autant.
valid_exclude() {
  local candidate="$1"
  [ -n "$candidate" ] || return 1
  [ "${#candidate}" -le 200 ] || return 1
  case "$candidate" in
    -*|/*) return 1 ;;
    ..|../*|*/..|*/../*) return 1 ;;
    .git|.git/*) return 1 ;;
  esac
  # Crochets admis : les routes Next.js du dashboard en sont pleines. C'est
  # sync-public.sh qui les echappe avant de les passer a rsync.
  printf '%s' "$candidate" | grep -Eq '^[A-Za-z0-9._*?][]A-Za-z0-9._*?/[-]*$'
}

run_sync() {
  [ -f "$REQUEST_FILE" ] || return 0

  local payload
  payload="$(cat "$REQUEST_FILE" 2>/dev/null || true)"
  # Consommee d'abord : une demande qui echoue ne doit pas etre rejouee en
  # boucle par l'unit `.path`, qui se redeclenche tant que le fichier existe.
  rm -f "$REQUEST_FILE"

  : >"$LOG_TMP"

  # `dryRun` absent ou vrai => repetition generale. Publier est irreversible :
  # c'est au champ de dire "pousse", pas a son absence.
  DRY_RUN="$(
    REQUEST_PAYLOAD="$payload" python3 - <<'PY'
import json, os
try:
    data = json.loads(os.environ.get("REQUEST_PAYLOAD") or "{}")
except json.JSONDecodeError:
    data = {}
print("0" if data.get("dryRun") is False else "1")
PY
  )"
  export DRY_RUN

  local requested
  requested="$(
    REQUEST_PAYLOAD="$payload" python3 - <<'PY'
import json, os
try:
    data = json.loads(os.environ.get("REQUEST_PAYLOAD") or "{}")
except json.JSONDecodeError:
    data = {}
values = data.get("excludes")
if isinstance(values, list):
    # Un espace separe les motifs cote sync-public.sh : un motif qui en
    # contient serait coupe en deux, autant l'ecarter ici.
    print("\n".join(v for v in values if isinstance(v, str) and " " not in v))
PY
  )"

  # Sujet de commit saisi au dashboard. Vide = le message automatique du
  # script. Transmis par variable d'environnement, donc cite : rien a injecter.
  COMMIT_MESSAGE="$(
    REQUEST_PAYLOAD="$payload" python3 - <<'PY'
import json, os, re
try:
    data = json.loads(os.environ.get("REQUEST_PAYLOAD") or "{}")
except json.JSONDecodeError:
    data = {}
message = data.get("message")
if isinstance(message, str):
    # Une ligne, sans caracteres de controle : le bot nettoie deja, on ne s'en
    # remet pas a lui pour autant (meme doctrine que les motifs d'exclusion).
    print(re.sub(r"[\x00-\x1f\x7f]+", " ", message).strip()[:200])
PY
  )"
  export COMMIT_MESSAGE

  # Depot vise : "bot" (defaut) ou "site". Le dashboard est un AUTRE depot,
  # avec son propre miroir : une fonctionnalite retiree du bot dont la page
  # reste sur le site public donne un ecran qui ne peut pas fonctionner.
  TARGET="$(
    REQUEST_PAYLOAD="$payload" python3 - <<'PY'
import json, os
try:
    data = json.loads(os.environ.get("REQUEST_PAYLOAD") or "{}")
except json.JSONDecodeError:
    data = {}
print("site" if data.get("target") == "site" else "bot")
PY
  )"
  export TARGET

  if [ "$TARGET" = "site" ]; then
    # Sans ces deux variables, on publierait le BOT en croyant publier le site.
    # Mieux vaut refuser franchement que se tromper de depot.
    if [ -z "${SITE_SOURCE_REPO:-}" ] || [ -z "${SITE_PUBLIC_REPO:-}" ]; then
      echo "[vakzbot-sync] SITE_SOURCE_REPO / SITE_PUBLIC_REPO absents de l unit" >>"$LOG_TMP"
      write_status "refused" "Depots du site non configures sur l hote." "failure"
      write_result failure
      echo "[vakzbot-sync] finished: failure (depots du site absents)"
      rm -f "$LOG_TMP"
      return 0
    fi
    TARGET_SOURCE_REPO="$SITE_SOURCE_REPO"
    TARGET_PUBLIC_REPO="$SITE_PUBLIC_REPO"
  else
    # Vide = les valeurs par defaut codees dans sync-public.sh (le bot).
    TARGET_SOURCE_REPO="${SOURCE_REPO:-}"
    TARGET_PUBLIC_REPO="${PUBLIC_REPO:-}"
  fi

  local excludes=""
  local refused=0
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    if valid_exclude "$pattern"; then
      excludes="${excludes:+$excludes }$pattern"
    else
      refused=$((refused + 1))
      echo "[vakzbot-sync] motif '$pattern' refuse" >>"$LOG_TMP"
    fi
  done <<<"$requested"

  if [ "$refused" -gt 0 ]; then
    # Publier une liste amputee, ce serait publier ce que l'on croyait exclu.
    write_status "refused" "$refused motif(s) d exclusion invalide(s) : publication annulee." "failure"
    write_result failure
    echo "[vakzbot-sync] finished: failure (motifs invalides)"
    rm -f "$LOG_TMP"
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    write_status "running" "Repetition generale : clone, copie et construction du snapshot."
  else
    write_status "running" "Publication : clone, copie, construction puis push."
  fi

  echo "[vakzbot-sync] repo=$REPO_DIR cible=$TARGET dry_run=$DRY_RUN exclusions='${excludes:-aucune}'" >>"$LOG_TMP"

  local rc=0
  EXCLUDES="$excludes" DRY_RUN="$DRY_RUN" COMMIT_MESSAGE="$COMMIT_MESSAGE" \
    BASELINE_FILE="$BASELINE_FILE" \
    SOURCE_REPO="$TARGET_SOURCE_REPO" PUBLIC_REPO="$TARGET_PUBLIC_REPO" \
    "$REPO_DIR/scripts/sync-public.sh" >>"$LOG_TMP" 2>&1 || rc=$?

  if [ "$rc" -eq 0 ]; then
    if [ "$DRY_RUN" = "1" ]; then
      write_status "done" "Repetition generale terminee : rien n a ete pousse." "success"
    else
      write_status "done" "Publication terminee." "success"
    fi
    write_result success
    echo "[vakzbot-sync] finished: success"
  else
    write_status "failure" "La publication a echoue. Voir le journal." "failure"
    write_result failure
    echo "[vakzbot-sync] finished: failure (rc=$rc)"
  fi

  rm -f "$LOG_TMP"
}

case "${1:-once}" in
  once) run_sync ;;
  loop)
    while true; do
      run_sync || echo "[vakzbot-sync] error, continuing"
      sleep 10
    done
    ;;
  *)
    echo "usage: $0 [once|loop]" >&2
    exit 2
    ;;
esac
