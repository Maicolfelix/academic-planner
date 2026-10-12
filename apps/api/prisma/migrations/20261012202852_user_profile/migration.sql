-- CreateEnum
CREATE TYPE "PrimaryUse" AS ENUM ('UNIVERSITY_STUDENT', 'SCHOOL_STUDENT', 'OTHER_STUDENT', 'TEACHER', 'PERSONAL');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" UUID NOT NULL,
    "primaryUse" "PrimaryUse",
    "programName" TEXT,
    "programKey" TEXT,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants Prisma cannot express.
-- The program, when there is one, is 1..80 characters (the authority), and a catalog key never exists without its name.
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_programName_length_check"
  CHECK ("programName" IS NULL OR char_length("programName") BETWEEN 1 AND 80);
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_programKey_needs_name_check"
  CHECK ("programKey" IS NULL OR "programName" IS NOT NULL);

-- Every user that already exists gets EXACTLY one profile, empty and NOT_STARTED. Nothing is inferred, no other table is
-- touched, and nobody is sent to an onboarding because of it (the status is only data).
INSERT INTO "UserProfile" ("userId", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP FROM "User";
