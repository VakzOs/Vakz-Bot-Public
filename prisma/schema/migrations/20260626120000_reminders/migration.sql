-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "targetKind" TEXT NOT NULL DEFAULT 'user',
    "targetId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "deliverInDm" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Reminder_guildId_targetKind_targetId_dueAt_idx" ON "Reminder"("guildId", "targetKind", "targetId", "dueAt");

-- CreateIndex
CREATE INDEX "Reminder_dueAt_deliveredAt_idx" ON "Reminder"("dueAt", "deliveredAt");
