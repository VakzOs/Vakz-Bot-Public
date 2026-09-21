-- Réglages globaux de l'instance (clé/valeur), modifiables par le propriétaire
-- du bot (droit /maj). Sert notamment au plafond d'objets par serveur.
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
