-- CreateTable
CREATE TABLE "GradingProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "minMilli" INTEGER NOT NULL,
    "maxMilli" INTEGER NOT NULL,
    "passMilli" INTEGER NOT NULL,
    "decimals" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GradingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingPeriod" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "finalShareBp" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GradingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "gradingPeriodId" UUID NOT NULL,
    "activityId" UUID,
    "name" TEXT NOT NULL,
    "periodShareBp" INTEGER NOT NULL,
    "scoreMilli" INTEGER,
    "rawEarnedMilli" INTEGER,
    "rawMaxMilli" INTEGER,
    "scoredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingProfile_periodId_key" ON "GradingProfile"("periodId");

-- CreateIndex
CREATE INDEX "GradingProfile_userId_idx" ON "GradingProfile"("userId");

-- CreateIndex
CREATE INDEX "GradingPeriod_userId_periodId_idx" ON "GradingPeriod"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingPeriod_id_periodId_key" ON "GradingPeriod"("id", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingPeriod_periodId_position_key" ON "GradingPeriod"("periodId", "position");

-- CreateIndex
CREATE INDEX "Evaluation_userId_periodId_idx" ON "Evaluation"("userId", "periodId");

-- CreateIndex
CREATE INDEX "Evaluation_subjectId_idx" ON "Evaluation"("subjectId");

-- CreateIndex
CREATE INDEX "Evaluation_gradingPeriodId_idx" ON "Evaluation"("gradingPeriodId");

-- CreateIndex
CREATE INDEX "Evaluation_activityId_idx" ON "Evaluation"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_id_subjectId_key" ON "Activity"("id", "subjectId");

-- AddForeignKey
ALTER TABLE "GradingProfile" ADD CONSTRAINT "GradingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingProfile" ADD CONSTRAINT "GradingProfile_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingPeriod" ADD CONSTRAINT "GradingPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingPeriod" ADD CONSTRAINT "GradingPeriod_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_subjectId_periodId_fkey" FOREIGN KEY ("subjectId", "periodId") REFERENCES "Subject"("id", "periodId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_gradingPeriodId_periodId_fkey" FOREIGN KEY ("gradingPeriodId", "periodId") REFERENCES "GradingPeriod"("id", "periodId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Invariants Prisma cannot express (D36).

-- An evaluation may link an activity of ITS OWN subject only: the composite key (activityId, subjectId) must exist in Activity.
-- Deleting the activity only unlinks the evaluation (ON DELETE SET NULL on the activityId column alone, PostgreSQL 15+: the
-- subjectId column is NOT NULL and must stay). Changing the subject of a linked activity is refused (NO ACTION on update).
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_activityId_subjectId_fkey" FOREIGN KEY ("activityId", "subjectId") REFERENCES "Activity"("id", "subjectId") ON DELETE SET NULL ("activityId") ON UPDATE NO ACTION;

ALTER TABLE "GradingProfile" ADD CONSTRAINT "GradingProfile_scale_check" CHECK (
  "minMilli" >= 0 AND "maxMilli" <= 100000 AND "minMilli" < "maxMilli"
  AND "passMilli" BETWEEN "minMilli" AND "maxMilli" AND "decimals" BETWEEN 0 AND 3
);

ALTER TABLE "GradingPeriod" ADD CONSTRAINT "GradingPeriod_values_check" CHECK (
  "finalShareBp" BETWEEN 1 AND 10000 AND "position" >= 1
  AND char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name")
);

ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_values_check" CHECK (
  "periodShareBp" BETWEEN 1 AND 10000 AND char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name")
);
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_score_check" CHECK (
  ("scoreMilli" IS NULL OR "scoreMilli" BETWEEN 0 AND 100000)
  AND (("scoreMilli" IS NULL) = ("scoredAt" IS NULL))
);
-- The raw pair is both-or-none, needs a score, and is a real fraction (0 <= earned <= max, max > 0).
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_raw_check" CHECK (
  (("rawEarnedMilli" IS NULL) = ("rawMaxMilli" IS NULL))
  AND ("rawMaxMilli" IS NULL OR ("scoreMilli" IS NOT NULL AND "rawMaxMilli" > 0 AND "rawEarnedMilli" BETWEEN 0 AND "rawMaxMilli"))
);
