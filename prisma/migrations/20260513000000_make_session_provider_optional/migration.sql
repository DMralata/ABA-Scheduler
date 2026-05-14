-- Make Session.providerId nullable so non-billable client blocks (e.g., Nap)
-- can be saved without an assigned provider. Mirrors the existing optional
-- clientId, which already lets provider-only blocks (e.g., Lunch) exist
-- without a client.

-- Drop the existing foreign key so we can recreate it as nullable.
ALTER TABLE "Session" DROP CONSTRAINT "Session_providerId_fkey";

ALTER TABLE "Session" ALTER COLUMN "providerId" DROP NOT NULL;

ALTER TABLE "Session" ADD CONSTRAINT "Session_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
