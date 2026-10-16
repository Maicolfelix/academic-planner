-- D36 revised after real QA: the CUTS (GradingPeriod) belong to a SUBJECT, not to the period. Two subjects of the same period can have
-- 30/30/40, 25/35/40, 50/50 or a single grade. Only the SCALE (GradingProfile) stays shared by the period.
--
-- HOW EXISTING ROWS MOVE (the feature was never released, so this only touches development / QA data). Every existing cut was
-- period-wide. Nothing is reinterpreted silently:
--   * every existing cut is COPIED to each subject of its period that has at least one Evaluation in that period (so a subject that
--     already had grades keeps exactly the structure it was showing);
--   * each Evaluation is re-pointed to the copy that belongs to its own subject;
--   * a period-wide cut for subjects WITHOUT evaluations is not copied (those subjects start unconfigured and the student is asked
--     "¿Cómo se divide esta materia?"), and the original period-wide rows are then deleted;
--   * GradingProfile rows (the scale) are untouched.

-- 1. Structural pieces that depend on the old shape.
ALTER TABLE "Evaluation" DROP CONSTRAINT "Evaluation_gradingPeriodId_periodId_fkey";
DROP INDEX "GradingPeriod_periodId_position_key";

-- 2. The new column, nullable while the data moves.
ALTER TABLE "GradingPeriod" ADD COLUMN "subjectId" UUID;

-- 3. The data.
CREATE TEMP TABLE "_cut_map" AS
  SELECT g."id" AS old_id, s."subjectId" AS subject_id, gen_random_uuid() AS new_id
  FROM "GradingPeriod" g
  JOIN (SELECT DISTINCT "subjectId", "periodId" FROM "Evaluation") s ON s."periodId" = g."periodId";

INSERT INTO "GradingPeriod" ("id", "userId", "periodId", "subjectId", "name", "position", "finalShareBp", "createdAt", "updatedAt")
  SELECT m.new_id, g."userId", g."periodId", m.subject_id, g."name", g."position", g."finalShareBp", g."createdAt", g."updatedAt"
  FROM "_cut_map" m JOIN "GradingPeriod" g ON g."id" = m.old_id;

UPDATE "Evaluation" e SET "gradingPeriodId" = m.new_id
  FROM "_cut_map" m WHERE m.old_id = e."gradingPeriodId" AND m.subject_id = e."subjectId";

DELETE FROM "GradingPeriod" WHERE "subjectId" IS NULL;
DROP TABLE "_cut_map";

ALTER TABLE "GradingPeriod" ALTER COLUMN "subjectId" SET NOT NULL;

-- 4. The new keys: a cut is unique by (subject, position); an evaluation can only use a cut OF ITS OWN SUBJECT; a cut's subject and
--    period must correspond.
DROP INDEX "GradingPeriod_id_periodId_key";
CREATE UNIQUE INDEX "GradingPeriod_id_subjectId_key" ON "GradingPeriod"("id", "subjectId");
CREATE UNIQUE INDEX "GradingPeriod_subjectId_position_key" ON "GradingPeriod"("subjectId", "position");

ALTER TABLE "GradingPeriod" ADD CONSTRAINT "GradingPeriod_subjectId_periodId_fkey" FOREIGN KEY ("subjectId", "periodId") REFERENCES "Subject"("id", "periodId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_gradingPeriodId_subjectId_fkey" FOREIGN KEY ("gradingPeriodId", "subjectId") REFERENCES "GradingPeriod"("id", "subjectId") ON DELETE NO ACTION ON UPDATE CASCADE;
