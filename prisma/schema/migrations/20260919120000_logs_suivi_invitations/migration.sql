-- Suivi des invitations du module « logs » : qui a fait entrer qui.
--
-- L'appariement entre une arrivée et une invitation ne se rejoue pas après
-- coup (l'invitation peut disparaître, son auteur aussi) : il s'écrit au
-- moment de l'arrivée. `leftAt` est posé au départ du membre, pour distinguer
-- les membres amenés de ceux qui sont restés.
--
-- Une ligne par arrivée, pas par membre : un membre qui revient a pu être
-- invité par quelqu'un d'autre.

-- CreateTable
CREATE TABLE "LogInviteJoin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inviterId" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME
);

-- CreateIndex
CREATE INDEX "LogInviteJoin_guildId_inviterId_idx" ON "LogInviteJoin"("guildId", "inviterId");

-- CreateIndex
CREATE INDEX "LogInviteJoin_guildId_userId_idx" ON "LogInviteJoin"("guildId", "userId");
