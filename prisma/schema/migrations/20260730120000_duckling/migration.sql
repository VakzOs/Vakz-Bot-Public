-- CreateTable
CREATE TABLE "Duckling" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT,
    "turnsLeft" INTEGER NOT NULL,
    "stealPercent" INTEGER NOT NULL DEFAULT 10,
    "distancePercent" INTEGER NOT NULL DEFAULT 10,
    "damagePercent" INTEGER NOT NULL DEFAULT 10,
    "stolenCoins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Duckling_guildId_userId_key" ON "Duckling"("guildId", "userId");

-- CreateIndex
CREATE INDEX "Duckling_guildId_idx" ON "Duckling"("guildId");
