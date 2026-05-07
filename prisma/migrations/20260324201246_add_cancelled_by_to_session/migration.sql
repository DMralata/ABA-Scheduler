-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('CLIENT', 'PROVIDER');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "cancelledBy" "CancelledBy";
