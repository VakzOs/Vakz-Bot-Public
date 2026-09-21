-- CreateTable
CREATE TABLE "InterserverLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "InterserverLink_channelId_key" ON "InterserverLink"("channelId");

-- CreateIndex
CREATE INDEX "InterserverLink_network_idx" ON "InterserverLink"("network");

-- CreateIndex
CREATE INDEX "InterserverLink_guildId_idx" ON "InterserverLink"("guildId");
