-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📦',
    "description" TEXT NOT NULL DEFAULT '',
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "price" INTEGER NOT NULL DEFAULT 0,
    "buyable" BOOLEAN NOT NULL DEFAULT true,
    "tradable" BOOLEAN NOT NULL DEFAULT true,
    "usable" BOOLEAN NOT NULL DEFAULT false,
    "roleReward" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Item_guildId_idx" ON "Item"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_guildId_userId_itemId_key" ON "InventoryItem"("guildId", "userId", "itemId");

-- CreateIndex
CREATE INDEX "InventoryItem_guildId_userId_idx" ON "InventoryItem"("guildId", "userId");

-- CreateIndex
CREATE INDEX "InventoryItem_itemId_idx" ON "InventoryItem"("itemId");
