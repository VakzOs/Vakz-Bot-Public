-- Ajoute un compteur de morts au voyageur (Route de l'Infini).
ALTER TABLE "Traveler" ADD COLUMN "deaths" INTEGER NOT NULL DEFAULT 0;
