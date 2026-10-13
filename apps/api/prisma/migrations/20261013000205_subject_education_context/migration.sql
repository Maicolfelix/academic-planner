-- CreateEnum
CREATE TYPE "EducationContext" AS ENUM ('UNIVERSITY', 'SCHOOL', 'OTHER_ACADEMIC');

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "educationContext" "EducationContext";

-- Every subject that already exists keeps NULL: "not specified". Nothing is inferred (not from the user's profile, not from the
-- name) and no other column or table is touched. NULL is never read as one of the three values.
