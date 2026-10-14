-- AlterTable
ALTER TABLE "AcademicPeriod" ADD COLUMN     "studyTrackId" UUID;

-- CreateIndex
CREATE INDEX "AcademicPeriod_studyTrackId_idx" ON "AcademicPeriod"("studyTrackId");

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_studyTrackId_userId_fkey" FOREIGN KEY ("studyTrackId", "userId") REFERENCES "StudyTrack"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Invariants Prisma cannot express: the rule "one current period" changes from "per user" to "per scope". A scope is "no
-- study" (once per user) or one study. A general period and the periods of several studies can all be current at the same time;
-- two in the SAME scope never can. The new indexes are created BEFORE the old one is dropped, and in this one transaction.
CREATE UNIQUE INDEX "AcademicPeriod_userId_current_untracked_key" ON "AcademicPeriod"("userId") WHERE "isCurrent" = true AND "studyTrackId" IS NULL;
CREATE UNIQUE INDEX "AcademicPeriod_studyTrackId_current_key" ON "AcademicPeriod"("studyTrackId") WHERE "isCurrent" = true AND "studyTrackId" IS NOT NULL;
DROP INDEX "AcademicPeriod_userId_current_key";

-- Nothing is inferred and nothing is created: every existing period keeps studyTrackId NULL (no study is derived from the
-- profile, the subjects, their education context or the name), so the new "untracked" index is exactly the old per-user rule
-- for all the data that exists, and every account's current period stays current.
