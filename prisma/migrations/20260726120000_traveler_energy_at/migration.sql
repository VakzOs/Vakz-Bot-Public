-- Route de l'Infini : régénération passive d'énergie (horodatage de référence).
-- NB : SQLite interdit les défauts NON CONSTANTS (CURRENT_TIMESTAMP) dans un
-- ALTER TABLE … ADD COLUMN. On utilise donc une date constante ; l'effet est
-- neutre : les voyageurs ≥ plafond de regen sont inchangés, et la première
-- action (déplacement/achat) réinitialise energyAt à l'heure courante.
ALTER TABLE "Traveler" ADD COLUMN "energyAt" DATETIME NOT NULL DEFAULT '2026-07-26 00:00:00';
