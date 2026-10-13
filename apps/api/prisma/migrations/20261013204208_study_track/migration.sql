-- CreateEnum
CREATE TYPE "StudyTrackStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "StudyTrack" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EducationContext" NOT NULL,
    "programKey" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "StudyTrackStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudyTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyTrack_userId_status_idx" ON "StudyTrack"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTrack_id_userId_key" ON "StudyTrack"("id", "userId");

-- AddForeignKey
ALTER TABLE "StudyTrack" ADD CONSTRAINT "StudyTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants Prisma cannot express.
-- At most ONE primary track per user (zero is valid: personal-only, teacher-only, older accounts). The database, not the
-- application, decides the race between two simultaneous "first" tracks.
CREATE UNIQUE INDEX "StudyTrack_userId_primary_key" ON "StudyTrack"("userId") WHERE "isPrimary" = true;

-- The visible name is trimmed and 1..80 characters (the text type cannot hold a NUL, so none can be stored); a catalog key is a
-- short slug.
ALTER TABLE "StudyTrack" ADD CONSTRAINT "StudyTrack_name_check"
  CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name"));
ALTER TABLE "StudyTrack" ADD CONSTRAINT "StudyTrack_programKey_length_check"
  CHECK ("programKey" IS NULL OR char_length("programKey") BETWEEN 1 AND 60);

-- An archived track is never the primary one.
ALTER TABLE "StudyTrack" ADD CONSTRAINT "StudyTrack_primary_active_check"
  CHECK ("isPrimary" = false OR "status" = 'ACTIVE');

-- No row is inserted: every user that already exists has ZERO tracks. Nothing is inferred from the profile, the periods or the
-- subjects, and no existing table is touched.
