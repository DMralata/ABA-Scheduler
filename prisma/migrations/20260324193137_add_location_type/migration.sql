-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('HOME', 'CENTER');

-- AlterTable
ALTER TABLE "ProposedSession" ADD COLUMN     "locationType" "LocationType" DEFAULT 'CENTER';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "locationType" "LocationType" DEFAULT 'CENTER';
