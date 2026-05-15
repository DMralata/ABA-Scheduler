// Input and output types for the rules-based scheduling engine.
// This module is pure TypeScript — no database calls, no UI dependencies.

import { RbtLevel, DayOfWeek } from "@prisma/client";

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface AvailabilityWindow {
  dayOfWeek: DayOfWeek;
  startTime: string; // "HH:MM" 24h
  endTime: string;   // "HH:MM" 24h
}

export interface SchedulerClient {
  id: string;
  firstName: string;
  lastName: string;
  latitude: number | null;
  longitude: number | null;
  sessionHours: number;         // per-session hours: auth/daysNeeded (week mode) or fill-the-day (day mode)
  daysNeeded: number;           // how many sessions to schedule this week (derived from auth / MAX_SESSION_HOURS)
  minimumRbtLevel: RbtLevel | null;
  femaleProviderOnly: boolean;
  spanish: boolean;
  availability: AvailabilityWindow[];
  // Sessions already booked in the target week (to detect client-side conflicts)
  bookedWindows: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>;
  // One-off date blocks (rest-of-day cancellations) — date is "YYYY-MM-DD" in center timezone
  blocks: Array<{ date: string; startTime: string; endTime: string }>;
  // Authorization constraints for the target week
  authorizationId: string | null;
  approvedWeeklyHours: number;  // from active authorization
  usedHoursThisWeek: number;    // already-booked billable hours in target week
  authorizationEndDate: string | null; // ISO date string — used to emit expiring-auth warnings
  // Approved provider IDs (home visits only)
  approvedProviderIds: string[];
  // Provider IDs from prior weeks, most recent first — used for consistency preference
  historicalProviderIds: string[];
  // True only if the client had at least one billable session in the immediately preceding week.
  // When false (vacation, new client, etc.) history rank is skipped so preferred slot takes over.
  hasPriorWeekHistory: boolean;
  // Where this client receives therapy — determines session type and approved-provider enforcement
  preferredLocation: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE";
  // Preferred day+time slots — scheduler uses these as a near-lock filter when available.
  // If any candidate slot matches a preferred day+startTime, only those slots are considered.
  // Silent fallback to all slots when no preferred slot is available.
  preferredSlots?: Array<{ dayOfWeek: DayOfWeek; startTime: string }>;
}

export interface SchedulerProvider {
  id: string;
  firstName: string;
  lastName: string;
  position: "BCBA" | "BCaBA" | "RBT";
  rbtLevel: RbtLevel | null;
  gender: string;
  spanish: boolean;
  latitude: number | null;
  longitude: number | null;
  availability: AvailabilityWindow[];
  // Sessions already booked for the target week (to detect conflicts and enforce drive gaps).
  // clientId is populated for therapy sessions — used to look up client→client drive times.
  // Absent (undefined) for non-client sessions like Drive Time, Admin, etc.
  // locationType is set for therapy sessions so HOME→CENTER gap enforcement can filter by type.
  bookedWindows: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE" }>;
  // One-off date blocks for the target week — date is "YYYY-MM-DD" in center timezone
  blocks: Array<{ date: string; startTime: string; endTime: string }>;
  // Total billable hours already in the DB for this provider this week (across all prior days).
  // Used by the matcher to prefer underutilized providers across the full week, not just this run.
  weeklyHoursAlreadyScheduled: number;
}

export interface SchedulerInput {
  weekOf: Date;               // Monday midnight UTC of the target week
  targetDate: string;         // "YYYY-MM-DD" in center timezone — only schedule sessions on this day
  timezone: string;           // IANA timezone of the center
  centerId: string | null;    // Center ID — used to look up center→client drive times
  // Synthetic origin id for the school location (shared per center). Drive matrices have
  // school→client and school↔center entries keyed by this id. Null when no school address
  // is configured for the center; SCHOOL transitions then fall back to in-memory minimums.
  schoolOriginId?: string | null;
  clients: SchedulerClient[];
  providers: SchedulerProvider[];
  sessionTypeIds: { CENTER: string; HOME: string; SCHOOL: string; DAYCARE: string }; // Direct Therapy used for CENTER/SCHOOL/DAYCARE locations; Direct Therapy Home for HOME
  driveTimeSessionTypeId: string | null; // "Drive Time" session type — used to create gap sessions
  // Drive time matrix: driveMinutes[providerId][clientId] = minutes (provider→client)
  //                    driveMinutes[clientId][clientId]   = minutes (client→client, consecutive sessions)
  //                    driveMinutes[centerId][clientId]   = minutes (center→client, for CENTER transitions)
  driveMinutes: Record<string, Record<string, number>>;
  // Distance matrix (same shape): distanceMeters[id][clientId] = meters
  distanceMeters: Record<string, Record<string, number>>;
  // Existing HOME sessions on the target day from prior runs (APPROVED proposals or SCHEDULED sessions).
  // Combined with newly saved HOME proposals so drive time blocks span ALL consecutive home visits,
  // not just pairs created in the same scheduler run.
  existingHomeSessions?: Array<{
    providerId: string;
    clientId: string;
    startTime: Date;
    endTime: Date;
  }>;
  // When true, the optimizer schedules each client across daysNeeded days within the full week
  // instead of targeting a single targetDate. Provider days fall out naturally from client demand.
  weekMode?: boolean;
  // When set, proposals with a startTime before this value are skipped (Rest of Day mode).
  notBefore?: Date;
  // Client IDs that were on the schedule for this day before Auto Complete ran.
  // These clients get scheduling priority and are flagged as "unserved" if no
  // provider can be found after the full two-pass attempt.
  lockedClientIds?: string[];
  // Cancellation pairing context — only set when cancelled sessions exist on the target day.
  // Enforces the rule: displaced clients (provider-cancelled) can ONLY be matched with freed
  // providers (client-cancelled), and vice versa. Single cancellations (only one side present)
  // produce no new proposals — no auto-fill without a matching freed resource on both sides.
  cancellationContext?: {
    displacedClientIds: string[]; // clients whose provider cancelled on the target day
    freedProviderIds: string[];   // providers whose client cancelled on the target day
  };
}

// ─── Output Types ────────────────────────────────────────────────────────────

export interface ProposedSessionOutput {
  clientId: string;
  providerId: string;
  authorizationId: string | null;
  sessionTypeId: string;
  locationType: "HOME" | "CENTER" | "SCHOOL" | "DAYCARE";
  // Day + local times (resolved to UTC datetimes by the caller)
  dayOfWeek: DayOfWeek;
  startTime: string; // "HH:MM" 24h local
  endTime: string;   // "HH:MM" 24h local
  reasoning: string;
}

export interface SchedulerOutput {
  proposals: ProposedSessionOutput[];
  // Summary metrics for the UI
  totalClientsScheduled: number;
  totalClientsUnscheduled: number;
  unscheduledClientIds: string[];
  estimatedTotalDriveMinutes: number;
  // Per-client skip reasons for auditability
  skipReasons: Record<string, string>;
  // Advisory warnings: expiring authorizations, high drive time routes, etc.
  warnings: string[];
  // Clients who were on the schedule for this day (lockedClientIds) but could not
  // be rescheduled after the full two-pass attempt. Distinct from "unscheduled"
  // because these clients had a confirmed session that was disrupted (e.g. by a
  // provider cancellation), requiring immediate attention from the scheduler.
  unservedRosterClients?: Array<{ clientId: string; reason: string }>;
}

// ─── Internal Engine Types ────────────────────────────────────────────────────
// Used only within the scheduler module — not exported to consumers.

export interface BookedSlot {
  dayOfWeek: DayOfWeek;
  startMins: number; // minutes since midnight
  endMins: number;
  clientId: string; // used to look up drive time between consecutive sessions
  locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE"; // used to enforce HOME→CENTER drive gap before CENTER slots
}

// Mutable state accumulated during a single scheduling run.
// Tracks what the engine has already committed so later clients
// don't collide with earlier assignments made in the same run.
export interface WorkingState {
  // providerId → slots committed during this run
  providerBookings: Map<string, BookedSlot[]>;
  // clientIds that have been assigned a session during this run (single-day compat)
  clientScheduled: Set<string>;
  // providerId → total hours committed during this run
  providerHoursCommitted: Map<string, number>;
  // clientId → set of days already scheduled this run (week mode)
  clientScheduledDays: Map<string, Set<import("@prisma/client").DayOfWeek>>;
  // dayOfWeek → number of sessions committed on that day this run (for load balancing)
  sessionsPerDay: Map<import("@prisma/client").DayOfWeek, number>;
  // clientId → total hours committed this run (for cross-round auth tracking)
  clientHoursCommitted: Map<string, number>;
  // Pre-computed by the optimizer pre-pass: providers who are the only viable option
  // for a constrained client (pool ≤ CONSTRAINT_POOL_THRESHOLD). Maps providerId →
  // days on which that provider has both availability and a constrained client who needs them.
  anchoredProviderDays: Map<string, Set<import("@prisma/client").DayOfWeek>>;
}
