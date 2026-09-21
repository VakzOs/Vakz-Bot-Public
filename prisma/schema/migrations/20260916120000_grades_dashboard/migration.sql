-- Grades : déléguer une part du dashboard, par fonction.
--
-- Jusqu'ici l'entrée du dashboard était binaire : le propriétaire du serveur et
-- les membres qui ont « Gérer le serveur » pouvaient TOUT régler, les autres
-- rien. Un serveur qui voulait laisser ses modérateurs toucher à
-- l'auto-modération devait leur donner « Gérer le serveur » — c'est-à-dire
-- aussi la sauvegarde, la purge et les réglages du serveur Discord lui-même.
--
-- Un grade porte un nom choisi par le serveur et la liste de ce qu'il ouvre :
-- un module entier, ou seulement un bloc de ses réglages (« Anti-spam » sans le
-- reste de l'automod). Ce qui le confère est au choix du serveur : des rôles
-- Discord, des membres nommés, ou les deux — créer un grade ne crée aucun rôle.
--
-- Aucun grade = comportement d'avant, à l'identique.
CREATE TABLE "GuildGrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleIds" TEXT NOT NULL DEFAULT '',
    "memberIds" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    CONSTRAINT "GuildGrade_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GuildGrade_guildId_idx" ON "GuildGrade"("guildId");
