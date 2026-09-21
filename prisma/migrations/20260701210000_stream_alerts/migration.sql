-- CreateTable
CREATE TABLE "StreamAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "lastVideoId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamAlert_guildId_platform_identifier_key" ON "StreamAlert"("guildId", "platform", "identifier");

-- CreateIndex
CREATE INDEX "StreamAlert_guildId_idx" ON "StreamAlert"("guildId");
