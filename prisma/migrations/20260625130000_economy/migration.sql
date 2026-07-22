-- CreateTable
CREATE TABLE "MemberEconomy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lastDailyAt" DATETIME,
    "lastEarnAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MemberEconomy_guildId_balance_idx" ON "MemberEconomy"("guildId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "MemberEconomy_guildId_userId_key" ON "MemberEconomy"("guildId", "userId");
