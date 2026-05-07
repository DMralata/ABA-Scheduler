// School-location helpers for the drive-time matrix.
// SCHOOL is treated as a fixed location per center, with a single shared address.
// In the drive-time matrices the school is keyed by `${centerId}:school` so it
// coexists with provider-id and client-id entries without collision.

export const SCHOOL_ORIGIN_SUFFIX = ":school";

export function schoolOriginIdFor(centerId: string | null): string | null {
  return centerId ? `${centerId}${SCHOOL_ORIGIN_SUFFIX}` : null;
}

// Great-circle distance in meters between two lat/lng points.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Approximate drive minutes from straight-line meters using a 35 mph urban average
// (≈ 56 km/h). Returns minutes rounded to one decimal. Used as a fallback when
// the Maps API isn't queried for a fixed pair (e.g. school↔center).
export function approxDriveMinutes(meters: number): number {
  const metersPerMinute = 56_000 / 60; // ~933 m/min
  return Math.round((meters / metersPerMinute) * 10) / 10;
}

export function schoolToCenterDistance(
  schoolLat: number | null,
  schoolLng: number | null,
  centerLat: number | null,
  centerLng: number | null
): { meters: number; minutes: number } | null {
  if (schoolLat == null || schoolLng == null || centerLat == null || centerLng == null) return null;
  const meters = haversineMeters(schoolLat, schoolLng, centerLat, centerLng);
  return { meters, minutes: approxDriveMinutes(meters) };
}
