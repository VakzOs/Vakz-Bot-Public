-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceChannelId" TEXT,
    "sourceMessageId" TEXT,
    "reportChannelId" TEXT,
    "reportMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigneeId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Report_guildId_status_idx" ON "Report"("guildId", "status");

-- CreateIndex
CREATE INDEX "Report_guildId_targetId_idx" ON "Report"("guildId", "targetId");

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");