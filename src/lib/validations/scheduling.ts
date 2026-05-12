import type {
  Client,
  Provider,
  ProviderAvailability,
  ClientAvailability,
  ProviderBlock,
  ApprovedHome,
  Authorization,
  RbtLevel,
  DayOfWeek,
} from "@prisma/client";
import {
  getProviderSessionOverlap,
  getClientSessionOverlap,
  getClientBillableHoursForWeek,
  getProviderSameDaySessions,
} from "@/lib/queries/sessions";
import { getDriveTimeMatrix } from "@/lib/scheduler/maps";
import { getWeekBoundaries } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

// Hard failures block scheduling. Warnings are surfaced to the scheduler
// but do not prevent a session from being created (e.g. center mismatch).
export type ValidationWarning = { warning: true; reason: string };

// ─── RBT Level Hierarchy ─────────────────────────────────────────────────────

const RBT_LEVEL_RANK: Record<RbtLevel, number> = {
  I:   1,
  II:  2,
  III: 3,
};

// ─── Rule 1: RBT Level ────────────────────────────────────────────────────────
// Client may require a minimum RBT level. Provider must meet or exceed it.

export function validateRbtLevel(
  client: Pick<Client, "minimumRbtLevel">,
  provider: Pick<Provider, "position" | "rbtLevel">
): ValidationResult {
  if (!client.minimumRbtLevel) return { valid: true };
  if (provider.position !== "RBT") return { valid: true }; // BCBAs/BCaBAs exempt

  if (!provider.rbtLevel) {
    return { valid: false, reason: "Provider has no RBT level assigned." };
  }

  if (RBT_LEVEL_RANK[provider.rbtLevel] < RBT_LEVEL_RANK[client.minimumRbtLevel]) {
    return {
      valid: false,
      reason: `Client requires a minimum RBT Level ${client.minimumRbtLevel}. Provider is Level ${provider.rbtLevel}.`,
    };
  }

  return { valid: true };
}

// ─── Rule 2: Provider Availability ───────────────────────────────────────────
// Session must fall within the provider's contracted availability window for that day.
//
// IMPORTANT — timezone parameter:
// Availability times ("HH:MM") are in the practice's local timezone, but session
// DateTimes arrive as UTC. Pass the practice timezone (IANA string, e.g.
// "America/New_York") so comparisons are made against wall-clock time, not UTC.

export function validateProviderAvailability(
  sessionStart: Date,
  sessionEnd: Date,
  availability: ProviderAvailability[],
  timezone: string
): ValidationResult {
  const dayOfWeek = toDayOfWeek(sessionStart, timezone);
  const windowsForDay = availability.filter((a) => a.dayOfWeek === dayOfWeek);

  if (windowsForDay.length === 0) {
    return { valid: false, reason: `Provider is not available on ${formatDay(dayOfWeek)}.` };
  }

  const sessionStartMins = toLocalMinutes(sessionStart, timezone);
  const sessionEndMins   = toLocalMinutes(sessionEnd, timezone);

  const fits = windowsForDay.some((w) => {
    return sessionStartMins >= parseTime(w.startTime) && sessionEndMins <= parseTime(w.endTime);
  });

  if (!fits) {
    const windows = windowsForDay.map((w) => `${w.startTime}–${w.endTime}`).join(", ");
    return {
      valid: false,
      reason: `Session does not fit within the provider's availability on ${formatDay(dayOfWeek)}. Available: ${windows}.`,
    };
  }

  return { valid: true };
}

// ─── Rule 3: Provider Blocked Times ──────────────────────────────────────────
// Session must not overlap a one-off provider block for that specific date.

export function validateProviderNotBlocked(
  sessionStart: Date,
  sessionEnd: Date,
  blocks: ProviderBlock[],
  timezone: string
): ValidationResult {
  const sessionDate     = toLocalDateString(sessionStart, timezone);
  const sessionStartMin = toLocalMinutes(sessionStart, timezone);
  const sessionEndMin   = toLocalMinutes(sessionEnd, timezone);

  const conflict = blocks.find((block) => {
    if (toLocalDateString(block.date, timezone) !== sessionDate) return false;
    return sessionStartMin < parseTime(block.endTime) && sessionEndMin > parseTime(block.startTime);
  });

  if (conflict) {
    return {
      valid: false,
      reason: `Provider is blocked from ${conflict.startTime} to ${conflict.endTime} on this date${conflict.reason ? `: ${conflict.reason}` : "."}`,
    };
  }

  return { valid: true };
}

// ─── Rule 4: Client Availability ─────────────────────────────────────────────
// Session must fall within the client's availability window for that day.

export function validateClientAvailability(
  sessionStart: Date,
  sessionEnd: Date,
  availability: ClientAvailability[],
  timezone: string
): ValidationResult {
  const dayOfWeek = toDayOfWeek(sessionStart, timezone);
  const windowsForDay = availability.filter((a) => a.dayOfWeek === dayOfWeek);

  if (windowsForDay.length === 0) {
    return { valid: false, reason: `Client is not available on ${formatDay(dayOfWeek)}.` };
  }

  const sessionStartMins = toLocalMinutes(sessionStart, timezone);
  const sessionEndMins   = toLocalMinutes(sessionEnd, timezone);

  const fits = windowsForDay.some((w) => {
    return sessionStartMins >= parseTime(w.startTime) && sessionEndMins <= parseTime(w.endTime);
  });

  if (!fits) {
    const windows = windowsForDay.map((w) => `${w.startTime}–${w.endTime}`).join(", ");
    return {
      valid: false,
      reason: `Session does not fit within the client's availability on ${formatDay(dayOfWeek)}. Available: ${windows}.`,
    };
  }

  return { valid: true };
}

// ─── Rule 5: Spanish Speaking ─────────────────────────────────────────────────
// If a client requires Spanish, the provider must also speak Spanish.

export function validateSpanishRequirement(
  client: Pick<Client, "spanish">,
  provider: Pick<Provider, "spanish">
): ValidationResult {
  if (client.spanish && !provider.spanish) {
    return { valid: false, reason: "Client requires a Spanish-speaking provider." };
  }
  return { valid: true };
}

// ─── Rule 6: Female Provider Only ────────────────────────────────────────────
// If the client requires a female provider, enforce it.
// Gender comparison is case-insensitive.

export function validateFemaleProviderOnly(
  client: Pick<Client, "femaleProviderOnly">,
  provider: Pick<Provider, "gender">
): ValidationResult {
  if (!client.femaleProviderOnly) return { valid: true };

  if (!provider.gender || provider.gender.toLowerCase() !== "female") {
    return { valid: false, reason: "Client requires a female provider." };
  }

  return { valid: true };
}

// ─── Rule 7: Approved Provider ───────────────────────────────────────────────
// Provider must be explicitly approved for the client before a session can be scheduled.
// Only active approvals (endDate: null) should be passed here.

export function validateApprovedProvider(
  client: Pick<Client, "id">,
  provider: Pick<Provider, "id">,
  approvedHomeRelationships: Pick<ApprovedHome, "clientId" | "providerId">[]
): ValidationResult {
  const isApproved = approvedHomeRelationships.some(
    (a) => a.clientId === client.id && a.providerId === provider.id
  );

  if (!isApproved) {
    return { valid: false, reason: "Provider is not approved for this client." };
  }

  return { valid: true };
}

// ─── Rule 8: Center Assignment (Soft Warning) ────────────────────────────────
// If client and provider are both assigned to centers and they don't match,
// this is a warning — not a hard block — to allow providers who float between centers.

export function validateCenterAssignment(
  client: Pick<Client, "centerId">,
  provider: Pick<Provider, "centerId">
): ValidationWarning | null {
  if (!client.centerId) return null;
  if (!provider.centerId) return null; // Provider has no center lock — can float
  if (client.centerId === provider.centerId) return null;

  return {
    warning: true,
    reason: "Provider's center assignment does not match the client's center. Verify before scheduling.",
  };
}

// ─── Rule 9: No Double Booking ────────────────────────────────────────────────
// Provider and client must not have overlapping scheduled sessions.

export async function validateNoOverlap(
  providerId: string,
  clientId: string | null,
  startTime: Date,
  endTime: Date,
  excludeSessionId?: string
): Promise<ValidationResult> {
  const providerConflict = await getProviderSessionOverlap(providerId, startTime, endTime, excludeSessionId);
  if (providerConflict) {
    return {
      valid: false,
      reason: `Provider already has a session from ${formatDateTime(providerConflict.startTime)} to ${formatDateTime(providerConflict.endTime)}.`,
    };
  }

  if (clientId) {
    const clientConflict = await getClientSessionOverlap(clientId, startTime, endTime, excludeSessionId);
    if (clientConflict) {
      return {
        valid: false,
        reason: `Client already has a session from ${formatDateTime(clientConflict.startTime)} to ${formatDateTime(clientConflict.endTime)}.`,
      };
    }
  }

  return { valid: true };
}

// ─── Rule 10: Client Not Terminated ──────────────────────────────────────────
// Prevents scheduling sessions for clients past their termination date.

export function validateClientNotTerminated(
  client: Pick<Client, "terminationDate">,
  sessionStart: Date,
  timezone: string
): ValidationResult {
  if (
    client.terminationDate &&
    toLocalDateString(sessionStart, timezone) >= toLocalDateString(client.terminationDate, timezone)
  ) {
    return { valid: false, reason: "Client has been terminated and cannot be scheduled." };
  }
  return { valid: true };
}

// ─── Rule 11: Authorization ───────────────────────────────────────────────────
// Billable sessions must have an active authorization covering the session date
// and service code, and must not exceed the authorization's weekly hour limit.
//
// Finds the best-matching authorization: prefers a service-code-specific auth over
// a catch-all (null serviceCode) auth. Returns the matched authorization ID so
// the caller can link the session to it.

export type AuthorizationValidationResult =
  | { valid: true; authorizationId: string }
  | { valid: false; reason: string };

// Only direct therapy sessions are gated by authorizations.
// BCBA supervision, assessment, indirect, and other non-direct-therapy sessions
// can be booked without an active authorization on file.
export function isDirectTherapyType(sessionTypeName: string | null | undefined): boolean {
  if (!sessionTypeName) return false;
  return sessionTypeName === "Direct Therapy" || sessionTypeName === "Direct Therapy Home";
}

export async function validateAuthorization(
  clientId: string,
  sessionStart: Date,
  sessionEnd: Date,
  billable: boolean,
  serviceCode: string | null | undefined,
  authorizations: Authorization[],
  timezone: string,
  excludeSessionId?: string,
  requiresAuthorization: boolean = true
): Promise<AuthorizationValidationResult> {
  if (!billable || !requiresAuthorization) {
    // Non-billable sessions and non-direct-therapy sessions don't need an
    // authorization — return a sentinel value
    return { valid: true, authorizationId: "" };
  }

  const sessionDay = toLocalDateString(sessionStart, timezone);

  // Find authorizations that cover the session date.
  // Auth dates are calendar dates (date-only values) stored as UTC midnight.
  // Extract the UTC date string directly to avoid off-by-one errors in
  // timezones behind UTC, where UTC midnight converts to the previous local day.
  const covering = authorizations.filter((auth) => {
    const authStart = auth.startDate.toISOString().split("T")[0];
    const authEnd   = auth.endDate.toISOString().split("T")[0];
    return sessionDay >= authStart && sessionDay <= authEnd;
  });

  if (covering.length === 0) {
    return { valid: false, reason: "Client has no active authorization covering this session date." };
  }

  // Prefer an authorization matching the specific service code;
  // fall back to a catch-all (null serviceCode) authorization.
  const exact    = covering.find((a) => a.serviceCode && a.serviceCode === serviceCode);
  const catchAll = covering.find((a) => !a.serviceCode);
  const matched  = exact ?? catchAll;

  if (!matched) {
    return {
      valid: false,
      reason: `Client has no active authorization for service code ${serviceCode ?? "(unspecified)"}.`,
    };
  }

  // Check that this session won't exceed the authorization's weekly hour limit
  const { weekStart, weekEnd } = getWeekBoundaries(sessionStart, timezone);

  const existingHours = await getClientBillableHoursForWeek(
    clientId,
    matched.id,
    weekStart,
    weekEnd,
    excludeSessionId
  );

  const newSessionHours = (sessionEnd.getTime() - sessionStart.getTime()) / (1000 * 60 * 60);
  const totalHours = existingHours + newSessionHours;

  if (totalHours > matched.approvedHoursPerWeek) {
    return {
      valid: false,
      reason: `This session would bring the client's weekly hours to ${totalHours.toFixed(1)}, exceeding their authorized ${matched.approvedHoursPerWeek} hours/week.`,
    };
  }

  return { valid: true, authorizationId: matched.id };
}

// ─── Rule 12: Valid Session Time ──────────────────────────────────────────────
// End time must be after start time. Minimum session duration is 15 minutes.

export function validateSessionTime(startTime: Date, endTime: Date): ValidationResult {
  if (endTime <= startTime) {
    return { valid: false, reason: "Session end time must be after start time." };
  }

  const durationMins = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  if (durationMins < 15) {
    return { valid: false, reason: "Session must be at least 15 minutes long." };
  }

  return { valid: true };
}

// ─── Run All Rules ────────────────────────────────────────────────────────────
// Returns all hard failures, any soft warnings, and the matched authorizationId
// (to be stored on the session).
//
// IMPORTANT: client must be loaded via getClientForValidation() and provider via
// getProviderForValidation() to guarantee all required relations are present.
//
// timezone: IANA timezone string for the practice/center (e.g. "America/New_York").
// Used for all day-of-week and time comparisons. Pass the center's timezone.

export type ValidationFailure = { valid: false; reason: string };

export async function validateSession(params: {
  client: Client & {
    availability: ClientAvailability[];
    approvedHomeProviders: ApprovedHome[];
    authorizations: Authorization[];
  };
  provider: Provider & {
    availability: ProviderAvailability[];
    blocks: ProviderBlock[];
  };
  startTime: Date;
  endTime: Date;
  billable: boolean;
  serviceCode?: string | null;
  // Used to gate the active-authorization check: only Direct Therapy / Direct
  // Therapy Home sessions are checked against client authorizations. BCBA
  // supervision, assessment, etc. can be booked without an authorization.
  sessionTypeName?: string | null;
  timezone: string;
  excludeSessionId?: string;
  // Only enforce the approved-provider list for HOME sessions.
  // CENTER sessions allow any qualified, active provider.
  locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE" | null;
}): Promise<{
  failures: ValidationFailure[];
  warnings: ValidationWarning[];
  authorizationId: string | undefined;
}> {
  const { client, provider, startTime, endTime, billable, serviceCode, sessionTypeName, timezone, excludeSessionId, locationType } = params;

  const [overlapResult, authorizationResult] = await Promise.all([
    validateNoOverlap(provider.id, client.id, startTime, endTime, excludeSessionId),
    validateAuthorization(
      client.id,
      startTime,
      endTime,
      billable,
      serviceCode,
      client.authorizations,
      timezone,
      excludeSessionId,
      isDirectTherapyType(sessionTypeName)
    ),
  ]);

  // Approved-provider list only applies to HOME sessions.
  // At the center, any active qualified provider may work with any client.
  const approvedProviderResult: ValidationResult =
    locationType === "HOME"
      ? validateApprovedProvider(client, provider, client.approvedHomeProviders)
      : { valid: true };

  const syncResults: ValidationResult[] = [
    validateSessionTime(startTime, endTime),
    validateClientNotTerminated(client, startTime, timezone),
    validateRbtLevel(client, provider),
    validateProviderAvailability(startTime, endTime, provider.availability, timezone),
    validateProviderNotBlocked(startTime, endTime, provider.blocks, timezone),
    validateClientAvailability(startTime, endTime, client.availability, timezone),
    validateSpanishRequirement(client, provider),
    validateFemaleProviderOnly(client, provider),
    approvedProviderResult,
    overlapResult,
  ];

  // Authorization result has a different shape — extract just the valid/reason part
  const authAsResult: ValidationResult = authorizationResult.valid
    ? { valid: true }
    : { valid: false, reason: authorizationResult.reason };

  const failures: ValidationFailure[] = [...syncResults, authAsResult].filter(
    (r): r is ValidationFailure => !r.valid
  );

  const centerWarning = validateCenterAssignment(client, provider);
  const warnings: ValidationWarning[] = centerWarning ? [centerWarning] : [];

  const authorizationId =
    authorizationResult.valid && authorizationResult.authorizationId
      ? authorizationResult.authorizationId
      : undefined;

  return { failures, warnings, authorizationId };
}

// ─── Rule 13: Drive Time Gap ──────────────────────────────────────────────────
// For manually booked sessions, verify the provider has enough drive time between
// the new session and any adjacent HOME sessions on the same day.
//
// Checks all three transition types, matching the auto-scheduler (slots.ts) exactly:
//   HOME → HOME   : client home → client home
//   CENTER → HOME : center → client home
//   HOME → CENTER : client home → center
// CENTER → CENTER needs no gap (both parties travel independently).
//
// Uses real Maps API drive time, rounded UP to the nearest 15 min (same rounding
// the schedule display uses). Falls back to a 15-min minimum if the API is
// unavailable or no address data exists.

const MIN_HOME_GAP_MINS = 15;

function ceilTo15(mins: number): number {
  return Math.ceil(mins / 15) * 15;
}

function buildAddress(
  street: string | null,
  city: string | null,
  state: string | null,
  zip: string | null
): string | null {
  const s = [street, city, state, zip].filter(Boolean).join(", ");
  return s || null;
}

type MapsLocation = string | { lat: number; lng: number };

function toMapsLocation(
  address: string | null,
  lat: number | null,
  lng: number | null
): MapsLocation | null {
  if (address) return address;
  if (lat != null && lng != null) return { lat, lng };
  return null;
}

export async function validateDriveTimeGap(params: {
  providerId: string;
  newStartTime: Date;
  newEndTime: Date;
  newLocationType: "HOME" | "CENTER" | "SCHOOL" | "DAYCARE";
  newClientAddress: string | null;
  newClientLat: number | null;
  newClientLng: number | null;
  centerAddress: string | null;
  centerLat: number | null;
  centerLng: number | null;
  schoolAddress?: string | null;
  schoolLat?: number | null;
  schoolLng?: number | null;
  timezone: string;
  excludeSessionId?: string;
}): Promise<ValidationResult> {
  const {
    providerId,
    newStartTime,
    newEndTime,
    newLocationType,
    newClientAddress,
    newClientLat,
    newClientLng,
    centerAddress,
    centerLat,
    centerLng,
    schoolAddress = null,
    schoolLat = null,
    schoolLng = null,
    timezone,
    excludeSessionId,
  } = params;

  // Derive day boundaries in the center's timezone using the noon-UTC probe pattern.
  // UTC midnight boundaries would miss late-evening sessions in UTC-offset timezones —
  // a session ending at 7pm local (UTC-5) has a UTC endTime that falls the next UTC day.
  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(newStartTime);
  const noonUtc = new Date(`${localDateStr}T12:00:00Z`);
  const localNoonStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(noonUtc);
  const localNoonHour = parseInt(localNoonStr.slice(12, 14));
  const localNoonMin  = parseInt(localNoonStr.slice(15, 17));
  const offsetMs = (12 - localNoonHour) * 3_600_000 - localNoonMin * 60_000;
  const localMidnightUTC = new Date(noonUtc.getTime() + offsetMs - 12 * 3_600_000);
  const dayStart = localMidnightUTC;
  const dayEnd   = new Date(localMidnightUTC.getTime() + 24 * 60 * 60 * 1000);

  const sameDaySessions = await getProviderSameDaySessions(
    providerId,
    dayStart,
    dayEnd,
    excludeSessionId
  );

  if (sameDaySessions.length === 0) return { valid: true };

  const newStartMs = newStartTime.getTime();
  const newEndMs = newEndTime.getTime();

  // Immediately preceding session (last one whose end ≤ new session start)
  const preceding = sameDaySessions
    .filter((s) => s.endTime.getTime() <= newStartMs)
    .at(-1);

  // Immediately following session (first one whose start ≥ new session end)
  const following = sameDaySessions.find((s) => s.startTime.getTime() >= newEndMs);

  type GapPair = {
    from: MapsLocation | null;
    to: MapsLocation | null;
    gapMins: number;
  };

  const pairs: GapPair[] = [];

  const newClientLoc = toMapsLocation(newClientAddress, newClientLat, newClientLng);
  const centerLoc = toMapsLocation(centerAddress, centerLat, centerLng);
  const schoolLoc = toMapsLocation(schoolAddress, schoolLat, schoolLng);

  function sessionClientLoc(s: typeof sameDaySessions[0]): MapsLocation | null {
    if (!s.client) return null;
    const addr = buildAddress(s.client.street, s.client.city, s.client.state, s.client.zip);
    return toMapsLocation(addr, s.client.latitude, s.client.longitude);
  }

  // Preceding → new session
  if (preceding) {
    const gapMins = (newStartMs - preceding.endTime.getTime()) / 60_000;
    const precType = preceding.locationType;

    if (precType === "HOME" && newLocationType === "HOME") {
      pairs.push({ from: sessionClientLoc(preceding), to: newClientLoc, gapMins });
    } else if (precType === "HOME" && newLocationType === "CENTER") {
      pairs.push({ from: sessionClientLoc(preceding), to: centerLoc, gapMins });
    } else if (precType === "CENTER" && newLocationType === "HOME") {
      pairs.push({ from: centerLoc, to: newClientLoc, gapMins });
    } else if (precType === "HOME" && newLocationType === "SCHOOL") {
      pairs.push({ from: sessionClientLoc(preceding), to: schoolLoc, gapMins });
    } else if (precType === "SCHOOL" && newLocationType === "HOME") {
      pairs.push({ from: schoolLoc, to: newClientLoc, gapMins });
    } else if (precType === "CENTER" && newLocationType === "SCHOOL") {
      pairs.push({ from: centerLoc, to: schoolLoc, gapMins });
    } else if (precType === "SCHOOL" && newLocationType === "CENTER") {
      pairs.push({ from: schoolLoc, to: centerLoc, gapMins });
    }
    // CENTER → CENTER, SCHOOL → SCHOOL: no check needed (provider stays put)
  }

  // New session → following
  if (following) {
    const gapMins = (following.startTime.getTime() - newEndMs) / 60_000;
    const follType = following.locationType;

    if (newLocationType === "HOME" && follType === "HOME") {
      pairs.push({ from: newClientLoc, to: sessionClientLoc(following), gapMins });
    } else if (newLocationType === "HOME" && follType === "CENTER") {
      pairs.push({ from: newClientLoc, to: centerLoc, gapMins });
    } else if (newLocationType === "CENTER" && follType === "HOME") {
      pairs.push({ from: centerLoc, to: sessionClientLoc(following), gapMins });
    } else if (newLocationType === "HOME" && follType === "SCHOOL") {
      pairs.push({ from: newClientLoc, to: schoolLoc, gapMins });
    } else if (newLocationType === "SCHOOL" && follType === "HOME") {
      pairs.push({ from: schoolLoc, to: sessionClientLoc(following), gapMins });
    } else if (newLocationType === "CENTER" && follType === "SCHOOL") {
      pairs.push({ from: centerLoc, to: schoolLoc, gapMins });
    } else if (newLocationType === "SCHOOL" && follType === "CENTER") {
      pairs.push({ from: schoolLoc, to: centerLoc, gapMins });
    }
    // CENTER → CENTER, SCHOOL → SCHOOL: no check needed (provider stays put)
  }

  if (pairs.length === 0) return { valid: true };

  // Split into addressable (can call Maps API) vs unaddressable (fallback to minimum)
  const addressable = pairs.filter((p) => p.from !== null && p.to !== null);
  const unaddressable = pairs.filter((p) => p.from === null || p.to === null);

  for (const pair of unaddressable) {
    if (pair.gapMins < MIN_HOME_GAP_MINS) {
      return {
        valid: false,
        reason: `Insufficient drive time buffer: the gap between sessions is ${Math.round(pair.gapMins)} min but at least ${MIN_HOME_GAP_MINS} min is required (address data unavailable for exact calculation).`,
      };
    }
  }

  if (addressable.length === 0) return { valid: true };

  // Single Maps API call for all addressable pairs (diagonal: origins[i] → destinations[i])
  let apiMinsPerPair: number[];
  try {
    const { driveMinutes } = await getDriveTimeMatrix(
      addressable.map((p) => p.from!),
      addressable.map((p) => p.to!)
    );
    apiMinsPerPair = addressable.map((_, i) => driveMinutes[i]?.[i] ?? 0);
  } catch {
    // Maps API unavailable — fall back to minimum gap check only
    apiMinsPerPair = addressable.map(() => 0);
  }

  for (let i = 0; i < addressable.length; i++) {
    const pair = addressable[i];
    const rawMins = apiMinsPerPair[i];
    const required = rawMins > 0 ? ceilTo15(rawMins) : MIN_HOME_GAP_MINS;
    if (pair.gapMins < required) {
      return {
        valid: false,
        reason: `Insufficient drive time buffer: the gap between consecutive sessions is ${Math.round(pair.gapMins)} min but ${required} min is required (${rawMins > 0 ? `${rawMins} min drive, rounded up` : "minimum gap"}).`,
      };
    }
  }

  return { valid: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Convert a UTC Date to minutes-since-midnight in the given IANA timezone.
// This is what makes availability comparisons timezone-correct.
function toLocalMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour   = parseInt(parts.find((p) => p.type === "hour")?.value   ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  // Intl hour12:false returns "24" for midnight — normalize to 0
  return (hour === 24 ? 0 : hour) * 60 + minute;
}

// Return "YYYY-MM-DD" in the given IANA timezone — used for date boundary comparisons.
function toLocalDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Map a UTC Date to the DayOfWeek enum value in the given IANA timezone.
function toDayOfWeek(date: Date, timezone: string): DayOfWeek {
  const days: DayOfWeek[] = [
    "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
  ];
  const localDateStr = toLocalDateString(date, timezone);
  const localDate = new Date(localDateStr + "T12:00:00Z"); // noon UTC to avoid DST issues
  return days[localDate.getUTCDay()];
}

function formatDay(day: DayOfWeek): string {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

