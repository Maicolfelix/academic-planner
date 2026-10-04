-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SHOWN', 'CANCELLED');

-- CreateTable
CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "remindAt" TIMESTAMPTZ(3) NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "offsetMinutes" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reminder_userId_status_remindAt_idx" ON "Reminder"("userId", "status", "remindAt");

-- CreateIndex
CREATE INDEX "Reminder_activityId_idx" ON "Reminder"("activityId");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express these):

-- AUTO reminders carry the (negative) offset they were computed with; MANUAL ones carry none.
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_offset_check" CHECK (("kind" = 'AUTO') = ("offsetMinutes" IS NOT NULL) AND ("offsetMinutes" IS NULL OR "offsetMinutes" < 0));

-- An activity can never hold two AUTO reminders with the same offset (also under concurrent writes).
CREATE UNIQUE INDEX "Reminder_auto_offset_key" ON "Reminder"("activityId", "offsetMinutes") WHERE "kind" = 'AUTO';