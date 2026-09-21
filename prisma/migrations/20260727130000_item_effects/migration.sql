-- Effets configurables des objets utilisables + mode de consommation.
-- `effects` : JSON (liste d'effets typés, validée par zod côté code).
-- `consumable` : l'objet est-il détruit à l'usage (sinon réutilisable).
-- `cooldownSeconds` : délai entre deux usages d'un objet réutilisable.
ALTER TABLE "Item" ADD COLUMN "effects" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Item" ADD COLUMN "consumable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Item" ADD COLUMN "cooldownSeconds" INTEGER NOT NULL DEFAULT 0;

-- Horodatage du dernier usage, par exemplaire possédé (base du cooldown).
ALTER TABLE "InventoryItem" ADD COLUMN "usedAt" DATETIME;
