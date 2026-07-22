-- CreateTable
CREATE TABLE "FreeGameAnnouncement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'steam',
    "gameId" TEXT NOT NULL,
    "announcedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "FreeGameAnnouncement_guildId_source_gameId_key" ON "FreeGameAnnouncement"("guildId", "source", "gameId");

-- CreateIndex
CREATE INDEX "FreeGameAnnouncement_guildId_idx" ON "FreeGameAnnouncement"("guildId");
