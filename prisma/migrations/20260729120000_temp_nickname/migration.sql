-- CreateTable
CREATE TABLE "TempNickname" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousNick" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TempNickname_guildId_userId_key" ON "TempNickname"("guildId", "userId");

-- CreateIndex
CREATE INDEX "TempNickname_expiresAt_idx" ON "TempNickname"("expiresAt");
