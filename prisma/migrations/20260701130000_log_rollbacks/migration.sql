-- CreateTable
CREATE TABLE "LogRollback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" TEXT NOT NULL,
    "usedBy" TEXT,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LogRollback_guildId_kind_idx" ON "LogRollback"("guildId", "kind");

-- CreateIndex
CREATE INDEX "LogRollback_createdAt_idx" ON "LogRollback"("createdAt");
