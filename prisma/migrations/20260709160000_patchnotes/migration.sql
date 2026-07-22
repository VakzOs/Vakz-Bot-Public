CREATE TABLE "PatchNoteAnnouncement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "announcedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PatchNoteAnnouncement_guildId_sourceId_noteId_key" ON "PatchNoteAnnouncement"("guildId", "sourceId", "noteId");
CREATE INDEX "PatchNoteAnnouncement_guildId_sourceId_idx" ON "PatchNoteAnnouncement"("guildId", "sourceId");
