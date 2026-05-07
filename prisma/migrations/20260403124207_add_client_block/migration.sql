-- CreateTable
CREATE TABLE "ClientBlock" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientBlock_clientId_date_idx" ON "ClientBlock"("clientId", "date");

-- AddForeignKey
ALTER TABLE "ClientBlock" ADD CONSTRAINT "ClientBlock_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
