-- CreateEnum
CREATE TYPE "ScheduleBlockType" AS ENUM ('CLASS', 'STUDY', 'ACADEMIC_PERSONAL');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('NONE', 'WEEKLY');

-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "subjectId" UUID,
    "title" TEXT NOT NULL,
    "type" "ScheduleBlockType" NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "recurrenceType" "RecurrenceType" NOT NULL DEFAULT 'NONE',
    "recurrenceUntil" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleBlock_userId_startAt_idx" ON "ScheduleBlock"("userId", "startAt");

-- CreateIndex
CREATE INDEX "ScheduleBlock_periodId_idx" ON "ScheduleBlock"("periodId");

-- CreateIndex
CREATE INDEX "ScheduleBlock_subjectId_idx" ON "ScheduleBlock"("subjectId");

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express these):

-- A block ends after it starts and lasts at most 24 hours, whoever writes to the table.
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_time_check" CHECK ("endAt" > "startAt" AND "endAt" - "startAt" <= interval '24 hours');

-- A weekly series always has an end date, and a single block never does.
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_recurrence_check" CHECK (("recurrenceType" = 'WEEKLY') = ("recurrenceUntil" IS NOT NULL));