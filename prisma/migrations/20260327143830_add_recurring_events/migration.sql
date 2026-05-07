-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "recurringEventId" TEXT;

-- CreateTable
CREATE TABLE "RecurringEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionTypeId" TEXT NOT NULL,
    "centerId" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "daysOfWeek" "DayOfWeek"[],
    "dayOfMonth" INTEGER,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringEventProvider" (
    "recurringEventId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,

    CONSTRAINT "RecurringEventProvider_pkey" PRIMARY KEY ("recurringEventId","providerId")
);

-- CreateIndex
CREATE INDEX "RecurringEvent_centerId_idx" ON "RecurringEvent"("centerId");

-- CreateIndex
CREATE INDEX "Session_recurringEventId_idx" ON "Session"("recurringEventId");

-- AddForeignKey
ALTER TABLE "RecurringEvent" ADD CONSTRAINT "RecurringEvent_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEvent" ADD CONSTRAINT "RecurringEvent_sessionTypeId_fkey" FOREIGN KEY ("sessionTypeId") REFERENCES "SessionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEventProvider" ADD CONSTRAINT "RecurringEventProvider_recurringEventId_fkey" FOREIGN KEY ("recurringEventId") REFERENCES "RecurringEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEventProvider" ADD CONSTRAINT "RecurringEventProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_recurringEventId_fkey" FOREIGN KEY ("recurringEventId") REFERENCES "RecurringEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
