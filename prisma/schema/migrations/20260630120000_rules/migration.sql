-- CreateTable
CREATE TABLE "RuleAcceptance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "RuleAcceptance_guildId_version_idx" ON "RuleAcceptance"("guildId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RuleAcceptance_guildId_userId_key" ON "RuleAcceptance"("guildId", "userId");
