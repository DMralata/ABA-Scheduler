// Session-length sizing.
//
// Resolves how long each session should be for a client, given their auth and
// availability. Uses historical patterns when established (≥4 weeks of history)
// and falls back to math-derived sizing capped by the daily availability
// window when not (Patch A fallback). Also surfaces warnings when the auth
// can't be met by the proposed cadence.

import type { DayOfWeek } from "@prisma/client";

import type { AvailabilityWindow } from "./types";

const HISTORY_THRESHOLD_WEEKS = 4;
const DEFAULT_MIN_SESSION_HOURS = 1.5;
const DEFAULT_MAX_SESSION_HOURS = 8.0;
const SCHEDULABLE_DAYS: ReadonlySet<DayOfWeek> = new Set([
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY",
] as DayOfWeek[]);

export interface HistoricalSession {
  startTime: Date;
  endTime: Date;
}

export interface SessionLengthInput {
  clientName: string;                     // e.g. "Rice, Amelia" — for warning messages
  authorizedHoursPerWeek: number | null;  // null if no auth
  usedHoursThisWeek: number;              // already-committed hours toward target
  availability: AvailabilityWindow[];     // weekly availability windows
  historicalSessions: HistoricalSession[];// 12-week window
  weekStart: Date;                        // Monday of target week (UTC)
  defaultSessionHours: number;            // fallback when no remaining hours
  minSessionHours?: number;
  maxSessionHours?: number;
}

export interface SessionLengthOutput {
  sessionHours: number;
  daysNeeded: number;
  warnings: string[];          // human-readable advisories for the audit/UI
  source: "historical-median" | "window-capped" | "default";
}

export function resolveSessionLength(input: SessionLengthInput): SessionLengthOutput {
  const minHours = input.minSessionHours ?? DEFAULT_MIN_SESSION_HOURS;
  const maxHours = input.maxSessionHours ?? DEFAULT_MAX_SESSION_HOURS;
  const auth = input.authorizedHoursPerWeek;
  const remaining = auth !== null ? Math.max(0, auth - input.usedHoursThisWeek) : null;

  // Schedulable-day availability windows (Mon–Fri only)
  const schedulableAvail = input.availability.filter((a) => SCHEDULABLE_DAYS.has(a.dayOfWeek));
  const distinctSchedulableDays = new Set(schedulableAvail.map((a) => a.dayOfWeek));
  const numAvailDays = distinctSchedulableDays.size;
  const minDailyWindowHours = numAvailDays === 0
    ? 0
    : Math.min(...[...distinctSchedulableDays].map((day) =>
        schedulableAvail
          .filter((a) => a.dayOfWeek === day)
          .reduce((sum, a) => sum + windowHours(a), 0),
      ));
  const maxPossibleWeeklyHours = schedulableAvail.reduce((s, a) => s + windowHours(a), 0);

  const warnings: string[] = [];

  // Hard ceiling check: auth physically can't be met regardless of session length
  if (auth !== null && auth > maxPossibleWeeklyHours && maxPossibleWeeklyHours > 0) {
    warnings.push(
      `${input.clientName}: availability ceiling — authorized ${auth}h/wk but maximum ` +
      `physical capacity from windows = ${maxPossibleWeeklyHours}h/wk. Availability windows must widen.`,
    );
  }

  // No remaining hours → degenerate case, use default
  if (remaining === null || remaining <= 0) {
    return {
      sessionHours: input.defaultSessionHours,
      daysNeeded: 1,
      warnings,
      source: "default",
    };
  }

  // No schedulable availability at all
  if (numAvailDays === 0) {
    return {
      sessionHours: input.defaultSessionHours,
      daysNeeded: 1,
      warnings,
      source: "default",
    };
  }

  const weeksOfHistory = computeWeeksOfHistory(input.historicalSessions, input.weekStart);
  const median = computeMedianSessionHours(input.historicalSessions);

  let sessionHours: number;
  let source: SessionLengthOutput["source"];

  if (weeksOfHistory >= HISTORY_THRESHOLD_WEEKS && median !== null) {
    // Patch B — use the practice's established session length for this client
    sessionHours = clamp(median, minHours, maxHours);
    source = "historical-median";
  } else {
    // Patch A fallback — math-derived, capped by per-day window
    const rawDaysNeeded = Math.max(1, Math.min(Math.ceil(remaining / maxHours), numAvailDays));
    const rawPerDay = remaining / rawDaysNeeded;
    const snapped = Math.round(rawPerDay * 2) / 2;
    const capped = Math.min(snapped, minDailyWindowHours);
    sessionHours = clamp(capped, minHours, maxHours);
    source = "window-capped";
  }

  // Days needed for the chosen session length
  const daysNeeded = Math.max(
    1,
    Math.min(Math.ceil(remaining / sessionHours), numAvailDays),
  );

  // Under-target warning: chosen cadence produces less than the auth allows
  const projectedHours = sessionHours * daysNeeded;
  if (auth !== null && projectedHours < auth - 0.01) {
    const gap = auth - projectedHours;
    // Compute the recommendation (extended session length, capped by per-day window)
    const idealPerDay = auth / numAvailDays;
    const idealSnapped = Math.round(idealPerDay * 2) / 2;
    const recommended = Math.min(idealSnapped, minDailyWindowHours);
    const recommendationIsFeasible = recommended * numAvailDays >= auth - 0.01;
    if (recommendationIsFeasible) {
      warnings.push(
        `${input.clientName}: proposed ${projectedHours}h/wk (${sessionHours}h × ${daysNeeded} days), ` +
        `authorized ${auth}h/wk — ${gap.toFixed(1)}h under target. ` +
        `Extend session length on existing days (current: ${sessionHours}h × ${daysNeeded} days; ` +
        `would need: ${recommended}h × ${numAvailDays} days).`,
      );
    }
    // If recommendation isn't feasible, the ceiling warning above already covers it.
  }

  return { sessionHours, daysNeeded, warnings, source };
}

// ── Internals ────────────────────────────────────────────────────────────────

function windowHours(w: { startTime: string; endTime: string }): number {
  const [sh, sm] = w.startTime.split(":").map(Number);
  const [eh, em] = w.endTime.split(":").map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

function computeWeeksOfHistory(sessions: HistoricalSession[], weekStart: Date): number {
  if (sessions.length === 0) return 0;
  const earliest = sessions.reduce(
    (min, s) => (s.startTime < min ? s.startTime : min),
    sessions[0].startTime,
  );
  return (weekStart.getTime() - earliest.getTime()) / (7 * 24 * 3_600_000);
}

function computeMedianSessionHours(sessions: HistoricalSession[]): number | null {
  if (sessions.length === 0) return null;
  const durations = sessions
    .map((s) => (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 0
    ? (durations[mid - 1] + durations[mid]) / 2
    : durations[mid];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
