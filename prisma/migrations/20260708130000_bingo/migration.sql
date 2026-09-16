-- CreateTable
CREATE TABLE "BingoGame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mode" TEXT NOT NULL DEFAULT 'line',
    "drawn" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BingoCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "numbers" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BingoCard_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "BingoGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BingoGame_guildId_key" ON "BingoGame"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "BingoCard_gameId_userId_key" ON "BingoCard"("gameId", "userId");

-- CreateIndex
CREATE INDEX "BingoCard_gameId_idx" ON "BingoCard"("gameId");
