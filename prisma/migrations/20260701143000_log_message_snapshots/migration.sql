-- CreateTable
CREATE TABLE "LogMessageSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorTag" TEXT,
    "authorAvatarUrl" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "embeds" TEXT NOT NULL DEFAULT '[]',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "LogMessageSnapshot_guildId_channelId_idx" ON "LogMessageSnapshot"("guildId", "channelId");

-- CreateIndex
CREATE INDEX "LogMessageSnapshot_updatedAt_idx" ON "LogMessageSnapshot"("updatedAt");