// Provider matching and ranking for a given client.
// Filters providers by hard constraints, generates candidate slots for each
// eligible provider, and ranks them by fit quality.
// Pure functions — no database calls, no side effects.

import type { DayOfWeek } from "@prisma/client";
import type { SchedulerClient, SchedulerProvider, BookedSlot, WorkingState } from "./types";
import type { CandidateSlot } from "./slots";
import { generateSlots } from "./slots";
import {
  checkRbtLevel,
  checkFemaleRequirement,
  checkSpanishRequirement,
  checkApprovedForClient,
} from "./constraints";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RankedProvider {
  provider: SchedulerProvider;
  slot: CandidateSlot;        // best slot for this provider-client pair (least idle time)
  committedHours: number;     // hours already committed by this provider this run
  driveMinutes: number;       // drive time to this client (0 if unknown)
  idleMinutes: number;        // unbillable non-travel gap this assignment would introduce
  weeklyHours: number;        // weeklyHoursAlreadyScheduled + committedHours — full-week load
  matchesPreferred: boolean;  // best slot lands on a client preferred day+time
}

export interface EligibilityFailure {
  providerId: string;
  reason: string;
}

export interface MatchResult {
  // Providers with at least one valid slot, sorted best-first
  ranked: RankedProvider[];
  // Providers that failed constraint checks or had no available slots
  failures: EligibilityFailure[];
}

// ─── notBefore UTC helper ─────────────────────────────────────────────────────
// Converts a local calendar date + minutes-since-midnight to a UTC timestamp (ms).
// Uses the noon-UTC probe pattern to derive the correct timezone offset including DST.
// Mirrors localToUtcMs in optimizer.ts — kept local to avoid a circular import.
function slotToUtcMs(dateStr: string, startMins: number, timezone: string): number {
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
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
  const localMidnightUTC = noonUtc.getTime() + offsetMs - 12 * 3_600_000;
  return localMidnightUTC + startMins * 60_000;
}

// ─── Idle Time Scoring ────────────────────────────────────────────────────────
// "Idle" is time the RBT is on the clock between sessions that isn't covered by
// drive time — pure dead time that reduces the billable ratio for the day.
//
// For each slot we compute: sum of max(0, gap - driveTime) for every adjacent
// committed session on the same day. Lower is better.

function slotIdleMinutes(
  day: DayOfWeek,
  slotStart: number,
  slotEnd: number,
  _providerId: string,
  clientId: string,
  committed: BookedSlot[],
  driveMinutes: Record<string, Record<string, number>>
): number {
  let idle = 0;
  for (const booked of committed) {
    if (booked.dayOfWeek !== day) continue;
    if (slotStart >= booked.endMins) {
      // New slot after this committed slot — drive from committed client to new client.
      // Use client→client drive time (accurate travel between homes, not provider home).
      const drive = driveMinutes[booked.clientId]?.[clientId] ?? 0;
      idle += Math.max(0, (slotStart - booked.endMins) - drive);
    } else if (slotEnd <= booked.startMins) {
      // New slot before this committed slot — drive from new client to committed client.
      const drive = driveMinutes[clientId]?.[booked.clientId] ?? 0;
      idle += Math.max(0, (booked.startMins - slotEnd) - drive);
    }
  }
  return idle;
}

/** Among all candidate slots, return the one that introduces the least idle time.
 *  Priority order for tie-breaking:
 *    1. Preferred slots — if client has preferred day+time slots, restrict to those first
 *    2. Days the provider is already working (day-consolidation — zero marginal day cost)
 *    3. Less idle time — minimize unbillable dead time
 *    4. Less loaded day (sessionsPerDay) — distribute sessions across the week
 *    5. Earlier in day (natural slot order)
 */
function selectBestSlot(
  slots: CandidateSlot[],
  providerId: string,
  clientId: string,
  committed: BookedSlot[],
  driveMinutes: Record<string, Record<string, number>>,
  sessionsPerDay?: Map<import("@prisma/client").DayOfWeek, number>,
  anchoredProviderDays?: Map<string, Set<import("@prisma/client").DayOfWeek>>,
  preferredSlots?: Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string }>
): { slot: CandidateSlot; idleMinutes: number; matchesPreferred: boolean } {
  // If the client has preferred slots, restrict to those that match day + exact start time.
  // Silent fallback: if none match (provider unavailable at preferred time), use all slots.
  let matchesPreferred = false;
  if (preferredSlots && preferredSlots.length > 0) {
    const preferred = slots.filter((s) =>
      preferredSlots.some(
        (p) => p.dayOfWeek === s.dayOfWeek && s.startMins === (parseInt(p.startTime.split(":")[0]) * 60 + parseInt(p.startTime.split(":")[1]))
      )
    );
    if (preferred.length > 0) { slots = preferred; matchesPreferred = true; }
  }
  // Days this provider is already committed to during this run — extending an existing
  // work day has zero marginal scheduling cost vs. opening a new day entirely.
  const providerWorkingDays = new Set(committed.map((b) => b.dayOfWeek));

  const isWorkingDay = (dayOfWeek: import("@prisma/client").DayOfWeek) =>
    providerWorkingDays.has(dayOfWeek) ||
    (anchoredProviderDays?.get(providerId)?.has(dayOfWeek) ?? false);

  let best = slots[0];
  let bestIdle = slotIdleMinutes(
    slots[0].dayOfWeek, slots[0].startMins, slots[0].endMins,
    providerId, clientId, committed, driveMinutes
  );
  let bestDayLoad = sessionsPerDay?.get(slots[0].dayOfWeek) ?? 0;
  let bestWorkingDay = isWorkingDay(slots[0].dayOfWeek);

  for (let i = 1; i < slots.length; i++) {
    const idle = slotIdleMinutes(
      slots[i].dayOfWeek, slots[i].startMins, slots[i].endMins,
      providerId, clientId, committed, driveMinutes
    );
    const dayLoad = sessionsPerDay?.get(slots[i].dayOfWeek) ?? 0;
    const workingDay = isWorkingDay(slots[i].dayOfWeek);

    // Prefer: already working this day → less idle → less loaded day → earlier (natural order)
    const betterWorkingDay = workingDay && !bestWorkingDay;
    const worseWorkingDay = !workingDay && bestWorkingDay;
    if (worseWorkingDay) continue;
    if (
      betterWorkingDay ||
      (!worseWorkingDay && idle < bestIdle) ||
      (!worseWorkingDay && idle === bestIdle && dayLoad < bestDayLoad)
    ) {
      bestIdle = idle; best = slots[i]; bestDayLoad = dayLoad; bestWorkingDay = workingDay;
    }
  }
  return { slot: best, idleMinutes: bestIdle, matchesPreferred };
}

// ─── Position Tier ────────────────────────────────────────────────────────────
// For direct therapy (and any non-BCBA-restricted session), prefer lower-cost
// positions first. BCBAs carry higher billing rates and should only be assigned
// when no RBT or BCaBA is available — using a BCBA for direct therapy reduces
// the practice's margin on every hour they deliver.

const POSITION_TIER: Record<"BCBA" | "BCaBA" | "RBT", number> = {
  RBT:   0, // preferred
  BCaBA: 1, // acceptable
  BCBA:  2, // last resort
};

// Days the optimizer can actually schedule on. Mirrors slots.ts:SCHEDULABLE_DAYS.
// Used by the >80% load soft-cap denominator so weekend availability doesn't
// dilute the load ratio (slots are never generated for Sat/Sun).
const SCHEDULABLE_WEEKDAYS = new Set<DayOfWeek>([
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY",
]);

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Finds all eligible providers for the given client this week, generates
 * their candidate slots, and returns them sorted by:
 *   1. Position tier — RBT > BCaBA > BCBA (margin optimization)
 *   2. Idle minutes — minimize unbillable dead time in the provider's day
 *   3. Committed hours — spread load across providers (caseload balance)
 *   4. Historical match — prefer same provider as prior weeks (consistency)
 *   5. Drive time — minimize unbilled travel
 *   6. Last name / ID — determinism
 *
 * When relaxDriveTime is true (retry pass), drive gap enforcement in slot
 * generation is skipped so clients with tight schedules get a second chance.
 */
export function findEligibleProviders(
  client: SchedulerClient,
  providers: SchedulerProvider[],
  weekDates: Record<DayOfWeek, string>,
  driveMinutes: Record<string, Record<string, number>>,
  workingState: WorkingState,
  relaxDriveTime = false,
  centerId: string | null = null,
  notBeforeMs: number | null = null,
  timezone: string = "UTC"
): MatchResult {
  const durationMins = Math.round(client.sessionHours * 60);
  const ranked: RankedProvider[] = [];
  const failures: EligibilityFailure[] = [];

  for (const provider of providers) {
    // Run provider-specific hard constraint checks.
    // ApprovedHome is enforced when the client's preferredLocation is HOME.
    // For CENTER sessions it is intentionally skipped (enforced at booking time via validateSession).
    const checks = [
      checkRbtLevel(client, provider),
      checkFemaleRequirement(client, provider),
      checkSpanishRequirement(client, provider),
      ...(client.preferredLocation === "HOME" ? [checkApprovedForClient(client, provider)] : []),
    ];

    const failed = checks.find((c) => !c.pass);
    if (failed) {
      failures.push({ providerId: provider.id, reason: failed.reason });
      continue;
    }

    // Hard drive time cap for HOME sessions — reject providers > 45 min away.
    // Only enforced when actual drive data exists (drive > 0) and not on the retry pass.
    // CENTER sessions are excluded: provider→client home distance is irrelevant at a clinic.
    const MAX_DRIVE_MINS = 45;
    if (!relaxDriveTime && client.preferredLocation !== "CENTER") {
      const driveCap = driveMinutes[provider.id]?.[client.id] ?? 0;
      if (driveCap > MAX_DRIVE_MINS) {
        failures.push({ providerId: provider.id, reason: `${driveCap} min drive exceeds 45-min cap` });
        continue;
      }
    }

    // Generate valid time slots for this pairing
    let slots = generateSlots(
      client, provider, weekDates, durationMins, workingState, driveMinutes, relaxDriveTime, centerId
    );
    if (slots.length === 0) {
      failures.push({
        providerId: provider.id,
        reason: "No overlapping availability windows for this week",
      });
      continue;
    }

    // notBefore filter: strip slots whose local start time is before the cutoff.
    // Applied here — before selectBestSlot — so each provider's "best slot" is
    // always a valid future slot, not a past one that gets rejected downstream.
    if (notBeforeMs !== null) {
      slots = slots.filter((s) => {
        const dateStr = weekDates[s.dayOfWeek];
        if (!dateStr) return true;
        return slotToUtcMs(dateStr, s.startMins, timezone) >= notBeforeMs;
      });
      if (slots.length === 0) {
        failures.push({
          providerId: provider.id,
          reason: "No slots available after current time cutoff",
        });
        continue;
      }
    }

    const committedHours = workingState.providerHoursCommitted.get(provider.id) ?? 0;
    // Drive time used for ranking: zero it out for CENTER sessions since provider→client home
    // distance is meaningless when both parties travel to the clinic independently.
    const drive = client.preferredLocation === "CENTER" ? 0 : (driveMinutes[provider.id]?.[client.id] ?? 0);
    const providerCommitted = workingState.providerBookings.get(provider.id) ?? [];
    const { slot, idleMinutes, matchesPreferred } = selectBestSlot(
      slots, provider.id, client.id, providerCommitted, driveMinutes,
      workingState.sessionsPerDay, workingState.anchoredProviderDays, client.preferredSlots
    );

    ranked.push({ provider, slot, committedHours, driveMinutes: drive, idleMinutes, weeklyHours: (provider.weeklyHoursAlreadyScheduled ?? 0) + committedHours, matchesPreferred });
  }

  // Historical provider rank: lower index = more recent = higher preference.
  // Providers not in the history get rank = Infinity (no preference).
  const historyRank = (providerId: string): number => {
    const idx = client.historicalProviderIds.indexOf(providerId);
    return idx === -1 ? Infinity : idx;
  };

  // Sort:
  // 1. Position tier: RBT always before BCBA — hard priority, never relaxed.
  // 2. Historical match: prefer the provider who worked with this client most recently.
  //    Clinical continuity in ABA is a real priority — same provider reduces behavioral disruption
  //    and maintains established rapport. Ranked before efficiency criteria.
  // 3. Already working slot's day: provider already has a proposal on this day — zero marginal
  //    day cost, keeps working days full rather than opening new sparse days.
  // 4. Anchored to slot's day: provider is one of the only options for a constrained client
  //    on this day — prefer them so constrained clients can be filled alongside other sessions.
  // 5. Idle minutes: prefer the slot that leaves the least unbillable dead time.
  // 6. Weekly hours: fewest total hours this week (DB + this run) — cross-week load balance.
  //    Prevents one provider accumulating hours Mon-Thu while another sits empty, then on
  //    Friday both look equal because this-run committedHours resets each day.
  // 7. Drive time: minimize unbilled travel.
  // 8. Last name / ID: determinism.
  // Providers already committed to this client in the current run — used to
  // deprioritize reuse within the same week (Bug B fix). Different days should
  // spread across the approved provider pool rather than reusing one provider.
  const alreadyAssignedThisWeek = new Set(
    [...(workingState.providerBookings.entries())]
      .filter(([, bookings]) => bookings.some((b) => b.clientId === client.id))
      .map(([providerId]) => providerId)
  );

  ranked.sort((a, b) => {
    const aTier = POSITION_TIER[a.provider.position] ?? 0;
    const bTier = POSITION_TIER[b.provider.position] ?? 0;
    if (aTier !== bTier) return aTier - bTier;

    // Preferred slot match: prefer providers whose best slot lands on the client's preferred day+time.
    // Checked before history when there is no prior-week data — if the client had no sessions last
    // week (vacation, new start, etc.) stale history should not override the family's schedule preference.
    if (!client.hasPriorWeekHistory && a.matchesPreferred !== b.matchesPreferred) return a.matchesPreferred ? -1 : 1;

    // Historical match: prefer same provider as prior weeks (clinical continuity — ABA priority).
    // Always runs regardless of hasPriorWeekHistory — the flag only controls whether preferred
    // slots fire BEFORE or AFTER history (see checks above/below), not whether history is
    // consulted at all. A vacation week should still fall back to 12-week history; it just
    // loses to an explicit preferred-slot match when one exists.
    // Soft-cap: if a historical provider is already running at >80% of their weekly availability,
    // treat their history rank as Infinity — they are near-full and spreading load matters more.
    {
      const HISTORY_LOAD_CAP = 0.8;
      const aHistRaw = historyRank(a.provider.id);
      const bHistRaw = historyRank(b.provider.id);
      // Only Mon–Fri availability counts toward the load denominator — slot
      // generation is Mon–Fri only, so weekend hours don't represent
      // schedulable capacity and would inflate the cap.
      const sumWeekdayHours = (provider: typeof a.provider) =>
        provider.availability.reduce((sum, w) => {
          if (!SCHEDULABLE_WEEKDAYS.has(w.dayOfWeek)) return sum;
          const [sh, sm] = w.startTime.split(":").map(Number);
          const [eh, em] = w.endTime.split(":").map(Number);
          return sum + ((eh * 60 + em) - (sh * 60 + sm)) / 60;
        }, 0);
      const aAvailHours = sumWeekdayHours(a.provider);
      const bAvailHours = sumWeekdayHours(b.provider);
      const aHist = aAvailHours > 0 && a.weeklyHours / aAvailHours > HISTORY_LOAD_CAP ? Infinity : aHistRaw;
      const bHist = bAvailHours > 0 && b.weeklyHours / bAvailHours > HISTORY_LOAD_CAP ? Infinity : bHistRaw;
      if (aHist !== bHist) return aHist - bHist;
    }

    // Preferred slot match (when prior-week history exists — checked after history as a tiebreaker).
    if (client.hasPriorWeekHistory && a.matchesPreferred !== b.matchesPreferred) return a.matchesPreferred ? -1 : 1;

    // Week-reuse penalty: demote providers already assigned to this client this week.
    // Applied AFTER history so the regular provider wins all days first. Spread only kicks
    // in as a tiebreaker — when two providers are otherwise equal, prefer the one who hasn't
    // already seen this client this week. This preserves clinical continuity (same provider
    // week over week) while still distributing load when the regular provider is near capacity
    // (caught above by the 80% soft-cap) or unavailable.
    const aReused = alreadyAssignedThisWeek.has(a.provider.id);
    const bReused = alreadyAssignedThisWeek.has(b.provider.id);
    if (aReused !== bReused) return aReused ? 1 : -1;

    // Day-consolidation: prefer providers already working on their best slot's day
    const aAlreadyWorking = (workingState.providerBookings.get(a.provider.id) ?? [])
      .some((bk) => bk.dayOfWeek === a.slot.dayOfWeek);
    const bAlreadyWorking = (workingState.providerBookings.get(b.provider.id) ?? [])
      .some((bk) => bk.dayOfWeek === b.slot.dayOfWeek);
    if (aAlreadyWorking !== bAlreadyWorking) return aAlreadyWorking ? -1 : 1;

    // Constraint anchor: prefer providers anchored to their best slot's day
    const aAnchored = workingState.anchoredProviderDays.get(a.provider.id)?.has(a.slot.dayOfWeek) ?? false;
    const bAnchored = workingState.anchoredProviderDays.get(b.provider.id)?.has(b.slot.dayOfWeek) ?? false;
    if (aAnchored !== bAnchored) return aAnchored ? -1 : 1;

    // When two providers have a large weekly hours imbalance (≥8h), load balance takes
    // precedence over idle minutes — prevents one provider accumulating all hours while
    // another sits at low utilization just because they introduce slightly less idle time.
    const LOAD_BALANCE_THRESHOLD_HRS = 8;
    if (Math.abs(a.weeklyHours - b.weeklyHours) >= LOAD_BALANCE_THRESHOLD_HRS) return a.weeklyHours - b.weeklyHours;
    if (a.idleMinutes !== b.idleMinutes) return a.idleMinutes - b.idleMinutes;
    if (a.weeklyHours !== b.weeklyHours) return a.weeklyHours - b.weeklyHours;
    if (a.driveMinutes !== b.driveMinutes) return a.driveMinutes - b.driveMinutes;
    return a.provider.id.localeCompare(b.provider.id); // determinism only — no scheduling logic
  });

  return { ranked, failures };
}
