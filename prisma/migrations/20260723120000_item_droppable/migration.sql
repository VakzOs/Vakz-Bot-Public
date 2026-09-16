-- Ajoute la colonne `droppable` aux objets (butin des mini-jeux).
ALTER TABLE "Item" ADD COLUMN "droppable" BOOLEAN NOT NULL DEFAULT true;
