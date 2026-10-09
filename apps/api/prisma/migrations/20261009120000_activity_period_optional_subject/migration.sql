-- An activity now stores its period (NOT NULL) and its subject becomes optional.
-- The whole file runs as ONE implicit transaction (a multi-statement script): it either applies completely or not at all.
-- No row is deleted or rewritten except the new column being filled, and no foreign key cascades.

-- 1. The new column, nullable for now (existing rows cannot have a value yet).
ALTER TABLE "Activity" ADD COLUMN "periodId" UUID;

-- 2. Backfill: every existing activity had a subject (NOT NULL + foreign key), and the subject carries the period.
UPDATE "Activity" a SET "periodId" = s."periodId" FROM "Subject" s WHERE s."id" = a."subjectId";

-- 3. Prove it: stop (and roll everything back) with a clear message if any row was left without a period.
DO $$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing FROM "Activity" WHERE "periodId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'Activity backfill incomplete: % row(s) without a period', missing;
  END IF;
END $$;

-- 4. Now the column can be mandatory.
ALTER TABLE "Activity" ALTER COLUMN "periodId" SET NOT NULL;

-- 5. The target of the composite foreign key. (id) is already unique; PostgreSQL still needs a unique key on exactly
--    the referenced columns.
CREATE UNIQUE INDEX "Subject_id_periodId_key" ON "Subject"("id", "periodId");

-- 6. Replace the simple subject foreign key by the composite one, and let the subject be absent.
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_subjectId_fkey";
ALTER TABLE "Activity" ALTER COLUMN "subjectId" DROP NOT NULL;

-- 7. Every activity belongs to a period (NO ACTION: a period with activities cannot be deleted silently).
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 8. A subject, when present, must belong to the SAME period as the activity. PostgreSQL's default MATCH SIMPLE skips
--    the check while "subjectId" IS NULL, which is exactly the "general activity" case.
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_subjectId_periodId_fkey" FOREIGN KEY ("subjectId", "periodId") REFERENCES "Subject"("id", "periodId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 9. Reads by user, period and deadline (Dashboard, Radar, Progress, Workload, Reminders) no longer join the subject.
CREATE INDEX "Activity_userId_periodId_dueAt_idx" ON "Activity"("userId", "periodId", "dueAt");
