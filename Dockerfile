# syntax=docker/dockerfile:1

# =============================================================================
# Image de base — Debian "bookworm" slim (glibc, OpenSSL 3.0).
# Pas d'Alpine : Prisma + musl + ARM64 est une combinaison source de bugs.
# Sur le VPS Ampere (aarch64), le build se fait nativement en arm64.
# =============================================================================
FROM node:20-slim AS base
WORKDIR /app
# openssl/ca-certificates : Prisma. fonts-dejavu-core/fontconfig : rendu texte
# des cartes de niveau (module Niveaux, via @napi-rs/canvas).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       openssl ca-certificates fonts-dejavu-core fontconfig \
  && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Stage builder : installe toutes les deps, génère le client Prisma, compile TS.
# -----------------------------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
COPY locales ./locales
RUN npm run build

# -----------------------------------------------------------------------------
# Stage runtime : dépendances de production uniquement + artefacts compilés.
# -----------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV TZ=Europe/Paris

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Schéma + client Prisma régénéré nativement pour la plateforme runtime (arm64).
COPY prisma ./prisma
RUN npx prisma generate

# Locales + code compilé + entrypoint.
COPY locales ./locales
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Horodatage du build (affiché par /ping) : permet de vérifier en un coup d'œil
# que le conteneur tourne bien la dernière image construite. La couche est
# invalidée dès que `dist` change : la date reflète le dernier vrai build.
RUN date -u '+%Y-%m-%d %H:%M UTC' > build-info

# Dossiers persistants (montés en volume) + droits pour l'utilisateur non-root.
RUN chmod +x docker-entrypoint.sh \
  && mkdir -p /app/data /app/assets/generated \
  && chown -R node:node /app

USER node
ENTRYPOINT ["./docker-entrypoint.sh"]
