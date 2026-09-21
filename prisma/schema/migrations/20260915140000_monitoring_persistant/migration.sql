-- Historique du monitoring, persistant.
--
-- Jusqu'ici les courbes vivaient dans un tampon mémoire : elles répondaient à
-- « qu'est-ce qui se passe ? » et repartaient de zéro à chaque redémarrage —
-- c'est-à-dire précisément au moment où l'on aurait voulu regarder derrière soi
-- (« est-ce que la mémoire montait déjà avant le plantage d'hier soir ? »).
-- Une ligne toutes les quinze secondes, purgée au-delà de
-- METRICS_RETENTION_DAYS. Au-delà de 24 heures, les lignes sont fondues par
-- tranches de cinq minutes (colonne "span" = nombre de mesures fusionnées) :
-- un mois d'historique tient ainsi en une dizaine de mégaoctets, et surtout se
-- relit sans charger 170 000 lignes pour tracer mille pixels.
--
-- Deux familles de colonnes, à ne pas confondre quand on regroupe plusieurs
-- lignes : les JAUGES (rss, heap, cpu, lag, ping, guilds, members) valent à
-- l'instant de la mesure et se moyennent ; les COMPTEURS (commands,
-- interactions, logWarn…) comptent ce qui s'est produit PENDANT l'intervalle et
-- s'additionnent.
CREATE TABLE "MetricSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at" DATETIME NOT NULL,
    "span" INTEGER NOT NULL DEFAULT 1,
    "rss" INTEGER NOT NULL,
    "heap" INTEGER NOT NULL,
    "cpu" INTEGER NOT NULL,
    "lag" REAL NOT NULL,
    "ping" INTEGER,
    "guilds" INTEGER NOT NULL,
    "members" INTEGER NOT NULL,
    "commands" INTEGER NOT NULL,
    "commandFails" INTEGER NOT NULL DEFAULT 0,
    "interactions" INTEGER NOT NULL,
    "components" INTEGER NOT NULL DEFAULT 0,
    "modals" INTEGER NOT NULL DEFAULT 0,
    "autocomplete" INTEGER NOT NULL DEFAULT 0,
    "rest" INTEGER NOT NULL,
    "rateLimits" INTEGER NOT NULL,
    "logTrace" INTEGER NOT NULL DEFAULT 0,
    "logDebug" INTEGER NOT NULL DEFAULT 0,
    "logInfo" INTEGER NOT NULL DEFAULT 0,
    "logWarn" INTEGER NOT NULL DEFAULT 0,
    "logError" INTEGER NOT NULL DEFAULT 0,
    "logFatal" INTEGER NOT NULL DEFAULT 0
);

-- La purge et toutes les lectures du panneau filtrent sur une fenêtre de temps :
-- sans cet index, chaque rafraîchissement balaierait la table entière.
CREATE INDEX "MetricSample_at_idx" ON "MetricSample"("at");

-- Statistiques cumulées par commande. Jamais purgée, contrairement aux
-- échantillons : « quelles commandes servent vraiment ? » est une question qui
-- n'a de sens que sur la durée.
CREATE TABLE "MetricCommand" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "module" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "totalMs" REAL NOT NULL DEFAULT 0,
    "lastAt" DATETIME
);
