-- Add SCHOOL location fields to Center.
-- Single shared school address per center; per-client school addresses can be added later.

ALTER TABLE "Center"
  ADD COLUMN "schoolStreet"    TEXT,
  ADD COLUMN "schoolCity"      TEXT,
  ADD COLUMN "schoolState"     TEXT,
  ADD COLUMN "schoolZip"       TEXT,
  ADD COLUMN "schoolLatitude"  DOUBLE PRECISION,
  ADD COLUMN "schoolLongitude" DOUBLE PRECISION;

-- Backfill a placeholder Cary, NC address for existing centers.
-- Coordinates are downtown Cary (35.7915, -78.7811) — replace with the real school address when known.
UPDATE "Center"
SET
  "schoolStreet"    = '316 N Academy St',
  "schoolCity"      = 'Cary',
  "schoolState"     = 'NC',
  "schoolZip"       = '27513',
  "schoolLatitude"  = 35.7915,
  "schoolLongitude" = -78.7811
WHERE "schoolStreet" IS NULL;
