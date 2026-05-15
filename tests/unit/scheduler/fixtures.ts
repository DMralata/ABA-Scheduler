/**
 * Shared test fixtures for scheduler unit tests.
 * All fixtures represent minimal valid objects — add fields only when a test
 * needs them, so tests remain readable and failures stay localized.
 */

import type { SchedulerClient, SchedulerProvider, SchedulerInput, WorkingState } from "@/lib/scheduler/types";

// ─── Availability Helpers ────────────────────────────────────────────────────

/** A full Monday window (8am–6pm) that comfortably fits any reasonable session. */
export const MON_ALL_DAY = [{ dayOfWeek: "MONDAY" as const, startTime: "08:00", endTime: "18:00" }];

/** A week-dates map restricted to Monday only — matches the optimizer's targetDate filter. */
export const WEEK_DATES_MON = { MONDAY: "2026-03-23" } as Record<import("@prisma/client").DayOfWeek, string>;

// ─── Client Builders ─────────────────────────────────────────────────────────

export function makeClient(overrides: Partial<SchedulerClient> = {}): SchedulerClient {
  return {
    id: "client-1",
    firstName: "Alex",
    lastName: "Alvarez",
    latitude: null,
    longitude: null,
    sessionHours: 2,
    daysNeeded: 1,
    minimumRbtLevel: null,
    femaleProviderOnly: false,
    spanish: false,
    availability: MON_ALL_DAY,
    bookedWindows: [],
    blocks: [],
    authorizationId: "auth-1",
    approvedWeeklyHours: 10,
    usedHoursThisWeek: 0,
    approvedProviderIds: [],
    authorizationEndDate: null,
    historicalProviderIds: [],
    hasPriorWeekHistory: false,
    preferredLocation: "CENTER",
    ...overrides,
  };
}

// ─── Provider Builders ───────────────────────────────────────────────────────

export function makeRbt(overrides: Partial<SchedulerProvider> = {}): SchedulerProvider {
  return {
    id: "provider-rbt",
    firstName: "Riley",
    lastName: "Rbt",
    position: "RBT",
    rbtLevel: "II",
    gender: "female",
    spanish: false,
    latitude: null,
    longitude: null,
    availability: MON_ALL_DAY,
    bookedWindows: [],
    blocks: [],
    weeklyHoursAlreadyScheduled: 0,
    ...overrides,
  };
}

export function makeBcaBA(overrides: Partial<SchedulerProvider> = {}): SchedulerProvider {
  return {
    id: "provider-bcaba",
    firstName: "Blake",
    lastName: "Bcaba",
    position: "BCaBA",
    rbtLevel: null,
    gender: "female",
    spanish: false,
    latitude: null,
    longitude: null,
    availability: MON_ALL_DAY,
    bookedWindows: [],
    blocks: [],
    weeklyHoursAlreadyScheduled: 0,
    ...overrides,
  };
}

export function makeBcba(overrides: Partial<SchedulerProvider> = {}): SchedulerProvider {
  return {
    id: "provider-bcba",
    firstName: "Casey",
    lastName: "Bcba",
    position: "BCBA",
    rbtLevel: null,
    gender: "female",
    spanish: false,
    latitude: null,
    longitude: null,
    availability: MON_ALL_DAY,
    bookedWindows: [],
    blocks: [],
    weeklyHoursAlreadyScheduled: 0,
    ...overrides,
  };
}

// ─── Input / State Builders ──────────────────────────────────────────────────

export function makeWorkingState(): WorkingState {
  return {
    providerBookings: new Map(),
    clientScheduled: new Set(),
    providerHoursCommitted: new Map(),
    clientScheduledDays: new Map(),
    sessionsPerDay: new Map(),
    clientHoursCommitted: new Map(),
    anchoredProviderDays: new Map(),
  };
}

export function makeInput(
  clients: SchedulerClient[],
  providers: SchedulerProvider[],
  driveMinutes: Record<string, Record<string, number>> = {}
): SchedulerInput {
  return {
    weekOf: new Date("2026-03-23T05:00:00Z"), // Monday midnight EST
    targetDate: "2026-03-23",
    timezone: "America/New_York",
    centerId: null,
    clients,
    providers,
    sessionTypeIds: { CENTER: "session-type-dt", HOME: "session-type-dt-home", SCHOOL: "session-type-dt", DAYCARE: "session-type-dt" },
    driveTimeSessionTypeId: null,
    driveMinutes, distanceMeters: {},
  };
}
