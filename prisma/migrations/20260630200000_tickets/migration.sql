-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "openerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedBy" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Ticket_guildId_openerId_status_idx" ON "Ticket"("guildId", "openerId", "status");

-- CreateIndex
CREATE INDEX "Ticket_channelId_idx" ON "Ticket"("channelId");
