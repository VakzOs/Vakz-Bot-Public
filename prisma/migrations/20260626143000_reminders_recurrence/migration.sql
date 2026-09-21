-- Add recurrence metadata for weekly reminders.
ALTER TABLE "Reminder" ADD COLUMN "repeatKind" TEXT NOT NULL DEFAULT 'once';
ALTER TABLE "Reminder" ADD COLUMN "repeatDay" INTEGER;
ALTER TABLE "Reminder" ADD COLUMN "repeatHour" INTEGER;
ALTER TABLE "Reminder" ADD COLUMN "repeatMinute" INTEGER;
