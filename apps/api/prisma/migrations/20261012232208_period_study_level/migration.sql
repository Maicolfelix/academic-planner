-- AlterTable
ALTER TABLE "AcademicPeriod" ADD COLUMN     "studyLevel" INTEGER,
ADD COLUMN     "studyLevelNote" TEXT;

-- Invariants Prisma cannot express. Existing periods keep both columns NULL (nothing is inferred, no other table is touched).
-- The level is a number between 1 and 99 OR a short free-text note (1..40 characters), never both. The bounds only keep
-- garbage out: the domain does not know what kind of student the number belongs to.
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_studyLevel_range_check"
  CHECK ("studyLevel" IS NULL OR "studyLevel" BETWEEN 1 AND 99);
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_studyLevelNote_length_check"
  CHECK ("studyLevelNote" IS NULL OR char_length("studyLevelNote") BETWEEN 1 AND 40);
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_studyLevel_exclusive_check"
  CHECK ("studyLevel" IS NULL OR "studyLevelNote" IS NULL);
