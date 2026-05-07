-- CreateTable
CREATE TABLE "ClientPreferredSlot" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPreferredSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPreferredSlot_clientId_idx" ON "ClientPreferredSlot"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPreferredSlot_clientId_dayOfWeek_startTime_key" ON "ClientPreferredSlot"("clientId", "dayOfWeek", "startTime");

-- AddForeignKey
ALTER TABLE "ClientPreferredSlot" ADD CONSTRAINT "ClientPreferredSlot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
