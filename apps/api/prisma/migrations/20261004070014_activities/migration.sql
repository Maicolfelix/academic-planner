-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TASK', 'EXAM', 'QUIZ', 'PROJECT', 'PRESENTATION', 'WORKSHOP', 'READING', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ActivityType" NOT NULL DEFAULT 'TASK',
    "priority" "ActivityPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActivityStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "hasTime" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_userId_dueAt_idx" ON "Activity"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "Activity_userId_status_idx" ON "Activity"("userId", "status");

-- CreateIndex
CREATE INDEX "Activity_subjectId_idx" ON "Activity"("subjectId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express this):

-- completedAt is set exactly while the activity is COMPLETED, whoever writes to the table.
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_completed_check" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL));