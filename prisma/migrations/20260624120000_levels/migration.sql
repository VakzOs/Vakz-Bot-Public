-- CreateTable
CREATE TABLE "MemberLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "lastXpAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MemberLevel_guildId_xp_idx" ON "MemberLevel"("guildId", "xp");

-- CreateIndex
CREATE UNIQUE INDEX "MemberLevel_guildId_userId_key" ON "MemberLevel"("guildId", "userId");
