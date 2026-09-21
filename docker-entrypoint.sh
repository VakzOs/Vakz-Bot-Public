#!/bin/sh
set -e

# Une commande passée en argument = une intervention ponctuelle, pas le bot :
#
#   docker compose run --rm bot npx prisma migrate status
#
# On la lance TELLE QUELLE, sans migrer d'abord. C'est volontaire : on vient
# souvent réparer précisément une migration, et migrer avant ferait échouer la
# réparation avec l'erreur qu'on cherche à corriger. Sans ce relais, l'argument
# serait ignoré en silence et le conteneur redémarrerait le bot à la place.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# Une image sans migration ne peut RIEN appliquer : `migrate deploy` répond
# « No migration found », sort en succès, et le bot démarre sur une base qui
# dérivera en silence — jusqu'à ce qu'un module tombe des heures plus tard sur
# une table absente. Vu en production. Le dépôt en compte des dizaines : une
# image qui n'en a aucune vient d'un contexte de build amputé (image périmée,
# `.dockerignore` trop large, clone incomplet).
if [ -z "$(find prisma/schema/migrations -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1)" ]; then
  echo "[entrypoint] AVERTISSEMENT : aucune migration dans l'image."
  echo "[entrypoint] La base ne sera PAS mise à jour et finira par diverger."
  echo "[entrypoint] Compare l'hôte et le conteneur :"
  echo "[entrypoint]   ls prisma/schema/migrations | wc -l"
  echo "[entrypoint]   docker compose exec bot ls /app/prisma/schema/migrations | wc -l"
  echo "[entrypoint] Puis reconstruis : docker compose up -d --build --force-recreate"
fi

echo "[entrypoint] Application des migrations Prisma (migrate deploy)…"
if ! npx prisma migrate deploy; then
  echo "[entrypoint] ÉCHEC des migrations : le bot ne démarre pas."
  echo "[entrypoint]"
  echo "[entrypoint] Si l'erreur dit qu'une table existe déjà, c'est qu'elle a"
  echo "[entrypoint] été créée à la main (\`prisma db push\`) sans que la migration"
  echo "[entrypoint] correspondante soit enregistrée. Marque-la comme appliquée,"
  echo "[entrypoint] une fois. \`prisma\` n'est PAS installé sur l'hôte : la"
  echo "[entrypoint] commande se lance dans le conteneur."
  echo "[entrypoint]"
  echo "[entrypoint]   # bot en marche :"
  echo "[entrypoint]   docker compose exec bot \\"
  echo "[entrypoint]     npx prisma migrate resolve --applied <nom_du_dossier>"
  echo "[entrypoint]"
  echo "[entrypoint]   # conteneur qui ne démarre plus :"
  echo "[entrypoint]   docker compose run --rm bot \\"
  echo "[entrypoint]     npx prisma migrate resolve --applied <nom_du_dossier>"
  echo "[entrypoint]"
  echo "[entrypoint] Les noms sont ceux des dossiers de prisma/schema/migrations."
  echo "[entrypoint] \`npx prisma migrate status\` liste ce qui reste en attente."
  exit 1
fi

echo "[entrypoint] Démarrage de Vakz-Bot…"
exec node dist/index.js
