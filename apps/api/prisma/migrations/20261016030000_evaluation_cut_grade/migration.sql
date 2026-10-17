-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "isCutGrade" BOOLEAN NOT NULL DEFAULT false;

-- Invariants Prisma cannot express (B2, direct cut grade).
-- A DIRECT CUT GRADE is the student's grade of a whole cut for one subject (no breakdown): it is the 100 % of that cut, always has
-- a score and has no activity. Existing evaluations are all detailed (false).
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_cut_grade_check" CHECK (
  NOT "isCutGrade" OR ("periodShareBp" = 10000 AND "activityId" IS NULL AND "scoreMilli" IS NOT NULL)
);
-- At most one per (subject, cut). That a cut with a direct grade has no other evaluation of the subject (and the other way round) spans
-- rows, so the service checks it under the per-user lock.
CREATE UNIQUE INDEX "Evaluation_subject_cut_grade_key" ON "Evaluation"("subjectId", "gradingPeriodId") WHERE "isCutGrade";
