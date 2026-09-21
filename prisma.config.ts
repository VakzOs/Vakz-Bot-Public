import { defineConfig } from 'prisma/config';

/**
 * Configuration de la CLI Prisma.
 *
 * Depuis Prisma 7, le bloc `prisma` de `package.json` n'est plus lu : ce fichier
 * le remplace. Ce n'est pas qu'un déménagement — les deux chemins ci-dessous
 * étaient jusqu'ici DÉDUITS, et c'est cette déduction qui a coûté cher.
 *
 * Le schéma est un DOSSIER (un fichier `.prisma` par domaine, fusionnés par
 * Prisma). Dès lors, Prisma cherche les migrations DANS ce dossier, et pas dans
 * `prisma/migrations` — une différence qui ne s'annonce jamais : `migrate
 * deploy` répond « No migration found », sort en SUCCÈS, le conteneur démarre,
 * et la base cesse simplement d'évoluer. C'est arrivé en production. Les deux
 * chemins sont donc écrits ici noir sur blanc.
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/schema/migrations',
  },
  // Prisma 7 sort l'URL du schéma : le fichier `.prisma` décrit la forme des
  // données, la connexion se déclare ici (pour `migrate`, `studio`…) et via
  // l'adaptateur passé au client (`src/core/db.ts`) pour le bot lui-même.
  //
  // Lu par `process.env` et NON par le `env()` de Prisma : ce dernier lève au
  // CHARGEMENT du fichier, donc pour toute commande, y compris `generate` —
  // qui tourne dans l'étage builder de l'image, sans base ni variable. Les
  // commandes qui ont réellement besoin de l'URL la réclament elles-mêmes, et
  // clairement.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
