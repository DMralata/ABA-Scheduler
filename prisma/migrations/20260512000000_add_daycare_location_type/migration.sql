-- Add DAYCARE as a new LocationType value. Daycare is a setting/alternative
-- location where direct therapy is conducted (parallel to SCHOOL), not a
-- separate session type.

ALTER TYPE "LocationType" ADD VALUE 'DAYCARE';
