-- CreateTable
CREATE TABLE "AdventClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AdventClaim_guildId_userId_day_key" ON "AdventClaim"("guildId", "userId", "day");

-- CreateIndex
CREATE INDEX "AdventClaim_guildId_userId_idx" ON "AdventClaim"("guildId", "userId");
