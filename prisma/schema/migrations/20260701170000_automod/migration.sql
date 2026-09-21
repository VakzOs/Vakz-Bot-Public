-- CreateTable
CREATE TABLE "AutomodIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "rule" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AutomodIncident_guildId_userId_idx" ON "AutomodIncident"("guildId", "userId");

-- CreateIndex
CREATE INDEX "AutomodIncident_guildId_rule_idx" ON "AutomodIncident"("guildId", "rule");

-- CreateIndex
CREATE INDEX "AutomodIncident_createdAt_idx" ON "AutomodIncident"("createdAt");