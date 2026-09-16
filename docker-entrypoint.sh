#!/bin/sh
set -e

echo "[entrypoint] Application des migrations Prisma (migrate deploy)…"
npx prisma migrate deploy

echo "[entrypoint] Démarrage de Vakz-Bot…"
exec node dist/index.js
