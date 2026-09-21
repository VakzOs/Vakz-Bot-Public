# syntax=docker/dockerfile:1

# =============================================================================
# Image de base — Debian "bookworm" slim (glibc, OpenSSL 3.0).
# Pas d'Alpine : Prisma + musl + ARM64 est une combinaison source de bugs.
# Sur le VPS Ampere (aarch64), le build se fait nativement en arm64.
# L'étiquette nomme bookworm EXPLICITEMENT : `node:24-slim` suit la Debian que
# l'amont juge courante et basculera sur trixie (OpenSSL 3.5) sans prévenir,
# alors que `binaryTargets` (prisma/schema/schema.prisma) réclame
# linux-arm64-openssl-3.0.x. Le moteur Prisma serait alors absent de l'image, et
# ça ne se verrait qu'au démarrage du conteneur, en production.
# =============================================================================
FROM node:24-bookworm-slim AS base
WORKDIR /app
# npm annonce sa propre mise à jour à chaque `npx` : quatre lignes de bruit en
# tête de chaque démarrage de conteneur, au-dessus des messages qu'on veut lire.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Prisma en fait autant, en pire : son encadré a proposé « 8.0.0-rc.15 » au
# démarrage — une RELEASE CANDIDATE, sur une base de production. Un conteneur
# n'est de toute façon pas l'endroit où l'on met à jour quoi que ce soit : la
# version est épinglée dans `package.json`, et l'image se reconstruit. La
# première variable coupe l'appel de vérification, la seconde le message.
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
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
# `prisma.config.ts` accompagne OBLIGATOIREMENT le schéma : depuis Prisma 7 il
# remplace le bloc `prisma` de `package.json`, et c'est lui qui dit où sont le
# schéma et les migrations. Sans lui dans l'image, `generate` et `migrate
# deploy` ne trouvent plus rien. Prisma sait le lire sans `typescript` ni
# `tsx` — il embarque son chargeur, ce qui le rend sûr en `--omit=dev`.
COPY prisma.config.ts ./
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

# Schéma + client Prisma régénérés nativement pour la plateforme runtime (arm64).
# `prisma.config.ts` sert aussi ici au `migrate deploy` de l'entrypoint.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

# Locales + artworks de la Route + code compilé + entrypoint.
COPY locales ./locales
COPY assets/route ./assets/route
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
