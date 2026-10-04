-- CreateTable
CREATE TABLE "AcademicPeriod" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AcademicPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "professor" TEXT,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademicPeriod_userId_idx" ON "AcademicPeriod"("userId");

-- CreateIndex
CREATE INDEX "Subject_userId_periodId_idx" ON "Subject"("userId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_periodId_nameKey_key" ON "Subject"("periodId", "nameKey");

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express these):

-- At most one current period per user, enforced by the database itself.
CREATE UNIQUE INDEX "AcademicPeriod_userId_current_key" ON "AcademicPeriod"("userId") WHERE "isCurrent" = true;

-- A period must end after it starts.
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_dates_check" CHECK ("endDate" > "startDate");