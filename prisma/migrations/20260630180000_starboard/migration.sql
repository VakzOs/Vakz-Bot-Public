-- CreateTable
CREATE TABLE "StarboardEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "starboardMessageId" TEXT,
    "authorId" TEXT NOT NULL,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "StarboardEntry_guildId_idx" ON "StarboardEntry"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "StarboardEntry_guildId_sourceMessageId_key" ON "StarboardEntry"("guildId", "sourceMessageId");
