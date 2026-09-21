#!/usr/bin/env bash
#
# Vérification des gardes de l'updater hôte (`npm run check:updater`).
#
# `vakzbot-updater.sh` ne tourne que sur le VPS, en root, avec Docker : il n'est
# jamais exécuté ici. Ses deux gardes seraient donc invérifiables — or ce sont
# elles qui décident si une mise à jour est déclarée réussie.
#
# Le 18/09/2026, `docker compose up -d --build` a rendu un code de sortie 0 sur
# un build raté. L'updater a écrit « success », le conteneur a continué de
# tourner sur l'ancienne image, et trois mises à jour se sont perdues sans que
# rien ne le signale. Les gardes ajoutées ce jour-là ne valent que si elles
# refusent encore ce cas précis — d'où ce script.
#
# On extrait les deux fonctions du vrai updater (pas une copie : le fichier
# livré) et on leur présente un faux `docker`, scénario par scénario.
set -euo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
updater="$racine/scripts/vakzbot-updater.sh"
gardes="$(mktemp)"
trap 'rm -f "$gardes"' EXIT

awk '/^construire\(\) \{/,/^\}/' "$updater" >"$gardes"
awk '/^verifier_service\(\) \{/,/^\}/' "$updater" >>"$gardes"
for fn in construire verifier_service; do
  grep -q "^$fn() {" "$gardes" || { echo "✘ $fn introuvable dans l'updater"; exit 1; }
done
# shellcheck disable=SC1090
. "$gardes"

COMPOSE_SERVICE=bot
sleep() { :; }   # les gardes patientent ; le test, non

cas=0
echecs=0
verdict() {
  cas=$((cas + 1))
  if [ "$1" = "$2" ]; then
    echo "  ✔ $3"
  else
    echecs=$((echecs + 1))
    echo "  ✘ $3 — attendu $2, obtenu $1"
  fi
}

echo "Gardes de l'updater :"

docker() { echo '#12 ERROR: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1'; return 1; }
construire bot >/dev/null 2>&1 && r=0 || r=$?
verdict "$r" 1 "un build en échec, code non nul → refusé"

docker() { echo 'failed to solve: process "/bin/sh -c npm ci --omit=dev" did not complete successfully: exit code: 1'; return 0; }
construire bot >/dev/null 2>&1 && r=0 || r=$?
verdict "$r" 1 "un build en échec SORTI EN 0 → refusé (le cas du 18/09)"

docker() { echo '#12 DONE 52.4s'; echo ' Image vakz-bot:latest Built'; return 0; }
construire bot >/dev/null 2>&1 && r=0 || r=$?
verdict "$r" 0 "un build réellement réussi → accepté"

docker() { [ "${2:-}" = "ps" ] && echo abc123; [ "${1:-}" = "inspect" ] && echo running; return 0; }
verifier_service >/dev/null 2>&1 && r=0 || r=$?
verdict "$r" 0 "conteneur en marche → accepté"

docker() { [ "${2:-}" = "ps" ] && echo abc123; [ "${1:-}" = "inspect" ] && echo exited; return 0; }
verifier_service >/dev/null 2>&1 && r=0 || r=$?
verdict "$r" 1 "conteneur sorti (entrypoint en échec) → refusé"

docker() { return 0; }
verifier_service >/dev/null 2>&1 && r=0 || r=$?
verdict "$r" 1 "aucun conteneur → refusé"

echo
if [ "$echecs" -gt 0 ]; then
  echo "✘ $echecs scénario(s) sur $cas ne se comportent plus comme prévu."
  exit 1
fi
echo "✅ Les gardes de l'updater refusent bien ce qu'elles doivent refuser ($cas/$cas)."
