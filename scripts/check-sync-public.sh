#!/usr/bin/env bash
#
# Vérification du garde-fou des exclusions (`npm run check:sync`).
#
# `sync-public.sh` ne tourne qu'au moment de publier le miroir : ses gardes ne
# s'exercent jamais ici. Or c'est la liste d'exclusions qui décide de ce qui
# reste privé, et une entrée qui ne correspond à aucun fichier ne fait RIEN
# dire à rsync — elle passe, et ce qu'on croyait retiré part au public.
#
# C'est arrivé le 21/09/2026 : les migrations ayant déménagé de
# `prisma/migrations` vers `prisma/schema/migrations`, quatre entrées ont
# continué de pointer dans le vide, et les migrations des modules privés sont
# redevenues publiables sans que rien ne le signale. `verifier_excludes` refuse
# désormais ce cas — ce script exige qu'elle le refuse encore.
#
# On extrait les fonctions du vrai script (pas une copie : le fichier livré) et
# on leur présente une arborescence factice, scénario par scénario.
set -euo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sync="$racine/scripts/sync-public.sh"

command -v rsync >/dev/null || {
  echo "✘ rsync introuvable : le garde-fou s'appuie sur lui, il ne peut pas être vérifié."
  exit 1
}

gardes="$(mktemp)"
atelier="$(mktemp -d)"
trap 'rm -rf "$gardes" "$atelier"' EXIT

awk '/^escape_pattern\(\) \{/,/^\}/' "$sync" >"$gardes"
awk '/^verifier_excludes\(\) \{/,/^\}/' "$sync" >>"$gardes"
for fn in escape_pattern verifier_excludes; do
  grep -q "^$fn() {" "$gardes" || { echo "✘ $fn introuvable dans sync-public.sh"; exit 1; }
done
c_err=''; c_ok=''; c_off=''
ok() { :; }   # le script journalise ; le test, non
# shellcheck disable=SC1090
. "$gardes"

# Une arborescence qui rejoue les deux pièges : le schéma est un DOSSIER (donc
# les migrations vivent dedans), et une route à crochets comme en compte le
# dashboard — rsync les lit comme une classe de caractères si on ne les échappe
# pas, et le motif ne correspondrait alors à rien de réel.
WORKDIR="$atelier"
mkdir -p "$WORKDIR/src/prisma/schema/migrations/20260830120000_gacha" \
  "$WORKDIR/src/src/modules/gacha" \
  "$WORKDIR/src/app/dashboard/[guildId]/catalogue" \
  "$WORKDIR/src/locales/fr"
touch "$WORKDIR/src/prisma/schema/migrations/20260830120000_gacha/migration.sql" \
  "$WORKDIR/src/prisma/schema/gacha.prisma" \
  "$WORKDIR/src/src/modules/gacha/index.ts" \
  "$WORKDIR/src/app/dashboard/[guildId]/catalogue/emoji-data.ts" \
  "$WORKDIR/src/locales/fr/gacha.json" \
  "$WORKDIR/src/README.md"

cas=0
echecs=0

# Rejoue la garde et dit ce qu'elle a répondu : « accepte » ou « refuse ».
juger() {
  local attendu="$1" titre="$2" motifs="$3" socle="${4:-handoff.md}"
  local sortie obtenu
  cas=$((cas + 1))
  if sortie="$(EXCLUDES="$motifs" ALWAYS_EXCLUDES="$socle" verifier_excludes 2>&1)"; then
    obtenu=accepte
  else
    obtenu=refuse
  fi
  if [ "$obtenu" = "$attendu" ]; then
    # Un refus doit NOMMER ce qui cloche : une garde muette est inexploitable.
    if [ "$attendu" = refuse ] && ! printf '%s' "$sortie" | grep -q "$motifs"; then
      echecs=$((echecs + 1))
      echo "  ✘ $titre — refus correct, mais l'entrée fautive n'est pas nommée"
      return
    fi
    echo "  ✔ $titre"
  else
    echecs=$((echecs + 1))
    echo "  ✘ $titre — attendu $attendu, obtenu $obtenu"
  fi
}

echo "Garde-fou des exclusions (sync-public.sh) :"

juger accepte "une liste dont chaque entrée retire quelque chose" \
  "prisma/schema/migrations/20260830120000_gacha src/modules/gacha locales/fr/gacha.json"

# Le cas du 21/09/2026, à l'identique : l'ancien chemin des migrations.
juger refuse "un chemin obsolète (migrations déplacées) est refusé" \
  "prisma/migrations/20260830120000_gacha"

juger refuse "une faute de frappe est refusée" \
  "src/modules/gacah"

# Sans échappement, rsync lirait `[guildId]` comme une classe de caractères :
# le motif ne correspondrait à aucun dossier réel et serait pris pour mort.
# Ce cas prouve que le contrôle applique le MÊME escape_pattern que la copie.
juger accepte "un motif à crochets reste valide (escape_pattern appliqué)" \
  "app/dashboard/[guildId]/catalogue"

# Le site n'exclut rien au-delà du socle : la garde doit le laisser passer.
juger accepte "une liste vide n'est pas une erreur" ""

# ALWAYS_EXCLUDES vaut pour TOUS les dépôts : `handoff.md` ne vit que dans
# celui du bot, donc une entrée sans effet y est normale et ne doit rien casser.
juger accepte "le socle sans effet ne fait pas échouer la publication" \
  "src/modules/gacha" "fichier-qui-nexiste-nulle-part.md"

echo
if [ "$echecs" -gt 0 ]; then
  echo "✘ $echecs cas en échec sur $cas."
  exit 1
fi
echo "✔ $cas cas vérifiés : la garde refuse encore ce qu'elle doit refuser."
