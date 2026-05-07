// Google Maps Distance Matrix helper.
// Returns drive time in minutes between a set of origins and destinations.
// Uses the Distance Matrix API (REST) — no extra package required.

interface LatLng {
  lat: number;
  lng: number;
}

// Accepts either a lat/lng pair or a plain address string.
// Address strings are geocoded by Google on the fly — more accurate than
// manually seeded coordinates when addresses are known.
type Location = LatLng | string;

interface DistanceMatrixResult {
  // driveMinutes[originIndex][destinationIndex]
  driveMinutes: number[][];
  // distanceMeters[originIndex][destinationIndex]
  distanceMeters: number[][];
}

function formatLocation(loc: Location): string {
  if (typeof loc === "string") return loc;
  return `${loc.lat},${loc.lng}`;
}

const MAPS_API_BASE = "https://maps.googleapis.com/maps/api/distancematrix/json";

/**
 * Fetches drive times for all origin→destination pairs, batching as needed.
 * Returns a 2D matrix where result[i][j] = minutes from origins[i] to destinations[j].
 *
 * Falls back to 0 for any element that fails (e.g. no route found).
 *
 * Google Distance Matrix limits per call:
 *   - Max 25 origins
 *   - Max 25 destinations
 *   - Max 100 elements (origins × destinations)
 * All three are enforced — the element limit is the binding constraint for
 * typical runs where destinations ~= 17 clients → max 5 origins per call.
 */
export async function getDriveTimeMatrix(
  origins: Location[],
  destinations: Location[]
): Promise<DistanceMatrixResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set");
  }

  if (origins.length === 0 || destinations.length === 0) {
    return { driveMinutes: [], distanceMeters: [] };
  }

  // Google Distance Matrix API hard limits per request.
  const MAX_ORIGINS = 25;
  const MAX_DESTS = 25;
  const MAX_ELEMENTS = 100;

  // Compute effective chunk sizes so that origChunk × destChunk ≤ MAX_ELEMENTS.
  // We fix the destination chunk size first (capped at MAX_DESTS), then derive
  // the maximum origin chunk size from the element budget.
  const destChunkSize = Math.min(MAX_DESTS, destinations.length);
  const origChunkSize = Math.min(MAX_ORIGINS, Math.floor(MAX_ELEMENTS / destChunkSize));

  const driveMinutes: number[][] = Array.from({ length: origins.length }, () =>
    new Array(destinations.length).fill(0)
  );
  const distanceMeters: number[][] = Array.from({ length: origins.length }, () =>
    new Array(destinations.length).fill(0)
  );

  type MatrixResponse = {
    status: string;
    error_message?: string;
    rows: Array<{
      elements: Array<{
        status: string;
        duration: { value: number }; // seconds
        distance: { value: number }; // meters
      }>;
    }>;
  };

  for (let originStart = 0; originStart < origins.length; originStart += origChunkSize) {
    const originChunk = origins.slice(originStart, originStart + origChunkSize);

    for (let destStart = 0; destStart < destinations.length; destStart += destChunkSize) {
      const destChunk = destinations.slice(destStart, destStart + destChunkSize);

      // Build the URL manually so the | separator between addresses is NOT percent-encoded.
      // Google's Distance Matrix API expects literal | as the separator — if it arrives
      // as %7C (what URLSearchParams produces), Google treats the whole string as a single
      // address and returns NOT_FOUND for every element.
      // Each individual address is percent-encoded to handle spaces, commas, etc.
      const encodedOrig = originChunk.map(loc => encodeURIComponent(formatLocation(loc))).join("|");
      const encodedDest = destChunk.map(loc => encodeURIComponent(formatLocation(loc))).join("|");
      const rawUrl = `${MAPS_API_BASE}?origins=${encodedOrig}&destinations=${encodedDest}&mode=driving&key=${apiKey}`;
      const maskedUrl = `${MAPS_API_BASE}?origins=${encodedOrig}&destinations=${encodedDest}&mode=driving&key=***`;

      console.log(`[maps] GET ${maskedUrl}`);
      const res = await fetch(rawUrl);
      if (!res.ok) {
        throw new Error(`Google Maps API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as MatrixResponse;
      console.log(`[maps] status=${data.status}, rows=${data.rows?.length}${data.error_message ? `, error=${data.error_message}` : ""}`);

      if (data.status !== "OK") {
        throw new Error(`Google Maps Distance Matrix status: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`);
      }

      data.rows.forEach((row, rowIdx) => {
        row.elements.forEach((el, colIdx) => {
          const ri = originStart + rowIdx;
          const ci = destStart + colIdx;
          console.log(`[maps]   [${ri}][${ci}] status=${el.status} duration=${el.status === "OK" ? Math.round(el.duration.value / 60) + "min" : "n/a"} distance=${el.status === "OK" ? el.distance?.value + "m" : "n/a"}`);
          if (el.status === "OK") {
            driveMinutes[ri][ci] = Math.round(el.duration.value / 60);
            distanceMeters[ri][ci] = el.distance?.value ?? 0;
          }
          // else leave as 0 — unknown drive time, scheduler will treat as co-located
        });
      });
    }
  }

  return { driveMinutes, distanceMeters };
}

/**
 * Builds the full drive time lookup map for the scheduler in a SINGLE API call.
 *
 * Origins  = all providers + all clients (combined)
 * Destinations = all clients
 *
 * Returns driveMinutes[id][clientId] where id is either a providerId or a clientId:
 *   driveMinutes[providerId][clientId] — provider home → client home (assignment ranking)
 *   driveMinutes[clientId][clientId]  — client home → client home (consecutive-session gap)
 *
 * Using a single API call avoids rate-limit failures that occurred when two parallel
 * calls were made (provider→client and client→client separately).
 *
 * All arrays must be parallel: providerIds[i] corresponds to providerLocations[i], etc.
 */
export async function buildAllDriveTimeMaps(
  providerIds: string[],
  providerLocations: (Location | null)[],
  clientIds: string[],
  clientLocations: (Location | null)[]
): Promise<{ driveMinutes: Record<string, Record<string, number>>; distanceMeters: Record<string, Record<string, number>> }> {
  const validProviders = providerIds
    .map((id, i) => ({ id, loc: providerLocations[i] }))
    .filter((p): p is { id: string; loc: Location } => p.loc !== null);

  const validClients = clientIds
    .map((id, i) => ({ id, loc: clientLocations[i] }))
    .filter((c): c is { id: string; loc: Location } => c.loc !== null);

  // Initialize all pairs to 0
  const driveResult: Record<string, Record<string, number>> = {};
  const distResult: Record<string, Record<string, number>> = {};
  for (const pid of providerIds) {
    driveResult[pid] = {}; distResult[pid] = {};
    for (const cid of clientIds) { driveResult[pid][cid] = 0; distResult[pid][cid] = 0; }
  }
  for (const fromCid of clientIds) {
    if (!driveResult[fromCid]) { driveResult[fromCid] = {}; distResult[fromCid] = {}; }
    for (const toCid of clientIds) { driveResult[fromCid][toCid] = 0; distResult[fromCid][toCid] = 0; }
  }

  if (validClients.length === 0) return { driveMinutes: driveResult, distanceMeters: distResult };

  // Origins = valid providers then valid clients; destinations = valid clients only
  const origins = [...validProviders, ...validClients];

  const { driveMinutes, distanceMeters } = await getDriveTimeMatrix(
    origins.map((o) => o.loc),
    validClients.map((c) => c.loc)
  );

  origins.forEach((origin, i) => {
    validClients.forEach((dest, j) => {
      driveResult[origin.id][dest.id] = driveMinutes[i]?.[j] ?? 0;
      distResult[origin.id][dest.id] = distanceMeters[i]?.[j] ?? 0;
    });
  });

  return { driveMinutes: driveResult, distanceMeters: distResult };
}

/**
 * Legacy helper — kept for scripts that only need provider→client data.
 * New code should use buildAllDriveTimeMaps.
 */
export async function buildDriveTimeMap(
  providerIds: string[],
  providerLocations: (Location | null)[],
  clientIds: string[],
  clientLocations: (Location | null)[]
): Promise<Record<string, Record<string, number>>> {
  const validProviders = providerIds
    .map((id, i) => ({ id, loc: providerLocations[i] }))
    .filter((p): p is { id: string; loc: Location } => p.loc !== null);

  const validClients = clientIds
    .map((id, i) => ({ id, loc: clientLocations[i] }))
    .filter((c): c is { id: string; loc: Location } => c.loc !== null);

  const result: Record<string, Record<string, number>> = {};
  for (const pid of providerIds) {
    result[pid] = {};
    for (const cid of clientIds) result[pid][cid] = 0;
  }

  if (validProviders.length === 0 || validClients.length === 0) return result;

  const { driveMinutes } = await getDriveTimeMatrix(
    validProviders.map((p) => p.loc),
    validClients.map((c) => c.loc)
  );

  validProviders.forEach((provider, i) => {
    validClients.forEach((client, j) => {
      result[provider.id][client.id] = driveMinutes[i]?.[j] ?? 0;
    });
  });

  return result;
}
