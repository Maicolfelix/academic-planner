-- CreateTable
CREATE TABLE "AppMetadata" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppMetadata_pkey" PRIMARY KEY ("key")
);
