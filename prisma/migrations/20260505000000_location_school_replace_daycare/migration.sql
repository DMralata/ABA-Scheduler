-- Replace DAYCARE with SCHOOL in LocationType enum.
-- No rows currently use DAYCARE (verified before migration).

ALTER TYPE "LocationType" RENAME TO "LocationType_old";

CREATE TYPE "LocationType" AS ENUM ('HOME', 'CENTER', 'HYBRID', 'SCHOOL');

ALTER TABLE "Client" ALTER COLUMN "preferredLocation" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "preferredLocation" TYPE "LocationType" USING ("preferredLocation"::text::"LocationType");
ALTER TABLE "Client" ALTER COLUMN "preferredLocation" SET DEFAULT 'CENTER';

ALTER TABLE "Session" ALTER COLUMN "locationType" DROP DEFAULT;
ALTER TABLE "Session" ALTER COLUMN "locationType" TYPE "LocationType" USING ("locationType"::text::"LocationType");
ALTER TABLE "Session" ALTER COLUMN "locationType" SET DEFAULT 'CENTER';

ALTER TABLE "ProposedSession" ALTER COLUMN "locationType" DROP DEFAULT;
ALTER TABLE "ProposedSession" ALTER COLUMN "locationType" TYPE "LocationType" USING ("locationType"::text::"LocationType");
ALTER TABLE "ProposedSession" ALTER COLUMN "locationType" SET DEFAULT 'CENTER';

DROP TYPE "LocationType_old";
