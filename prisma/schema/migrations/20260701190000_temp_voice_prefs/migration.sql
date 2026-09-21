-- CreateTable
CREATE TABLE "TempVoicePreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TempVoicePreference_guildId_userId_key" ON "TempVoicePreference"("guildId", "userId");

-- CreateIndex
CREATE INDEX "TempVoicePreference_guildId_idx" ON "TempVoicePreference"("guildId");
