-- Ajoute des métadonnées optionnelles (ex. jeu Steam) à une suggestion.
ALTER TABLE "Suggestion" ADD COLUMN "metadata" TEXT;
