-- CreateEnum
CREATE TYPE "InboundMessageType" AS ENUM ('SMS', 'VOICEMAIL');

-- CreateEnum
CREATE TYPE "InboundMessageStatus" AS ENUM ('UNREAD', 'READ', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OutboundMessageStatus" AS ENUM ('DRAFT', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "phoneLabel" TEXT,
ADD COLUMN     "phoneNumber" TEXT;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "phoneNumber" TEXT;

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "zoomMessageId" TEXT,
    "messageType" "InboundMessageType" NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT,
    "rawBody" TEXT NOT NULL,
    "isCancellation" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "aiClassification" TEXT,
    "classificationConf" DOUBLE PRECISION,
    "resolvedClientId" TEXT,
    "resolvedProviderId" TEXT,
    "status" "InboundMessageStatus" NOT NULL DEFAULT 'UNREAD',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "inboundMessageId" TEXT,
    "recipientType" TEXT NOT NULL,
    "recipientClientId" TEXT,
    "recipientProviderId" TEXT,
    "toNumber" TEXT NOT NULL,
    "draftBody" TEXT NOT NULL,
    "editedBody" TEXT,
    "sentBody" TEXT,
    "status" "OutboundMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "outreachReason" TEXT,
    "relatedSessionId" TEXT,
    "zoomMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessage_zoomMessageId_key" ON "InboundMessage"("zoomMessageId");

-- CreateIndex
CREATE INDEX "InboundMessage_status_createdAt_idx" ON "InboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_fromNumber_idx" ON "InboundMessage"("fromNumber");

-- CreateIndex
CREATE INDEX "InboundMessage_resolvedClientId_idx" ON "InboundMessage"("resolvedClientId");

-- CreateIndex
CREATE INDEX "InboundMessage_resolvedProviderId_idx" ON "InboundMessage"("resolvedProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_zoomMessageId_key" ON "OutboundMessage"("zoomMessageId");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_createdAt_idx" ON "OutboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_inboundMessageId_idx" ON "OutboundMessage"("inboundMessageId");

-- CreateIndex
CREATE INDEX "OutboundMessage_recipientClientId_idx" ON "OutboundMessage"("recipientClientId");

-- CreateIndex
CREATE INDEX "OutboundMessage_recipientProviderId_idx" ON "OutboundMessage"("recipientProviderId");

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_resolvedClientId_fkey" FOREIGN KEY ("resolvedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_resolvedProviderId_fkey" FOREIGN KEY ("resolvedProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_recipientClientId_fkey" FOREIGN KEY ("recipientClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_recipientProviderId_fkey" FOREIGN KEY ("recipientProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
