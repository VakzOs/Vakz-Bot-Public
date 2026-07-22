-- CreateTable
CREATE TABLE "Traveler" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "health" INTEGER NOT NULL DEFAULT 100,
    "maxHealth" INTEGER NOT NULL DEFAULT 100,
    "energy" INTEGER NOT NULL DEFAULT 100,
    "distance" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "lastMoveAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Traveler_guildId_userId_key" ON "Traveler"("guildId", "userId");

-- CreateIndex
CREATE INDEX "Traveler_guildId_distance_idx" ON "Traveler"("guildId", "distance");
