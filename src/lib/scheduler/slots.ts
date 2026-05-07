// Time slot generation for the rules-based scheduling engine.
// Computes valid candidate slots for a client-provider pair by intersecting
// their availability windows and filtering out existing bookings and blocks.
// Pure functions — no database calls, no side effects.

import type { DayOfWeek } from "@prisma/client";
import type { SchedulerClient, SchedulerProvider, BookedSlot, WorkingState } from "./types";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface CandidateSlot {
  dayOfWeek: DayOfWeek;
  startTime: string;  // "HH:MM" 24h
  endTime: string;    // "HH:MM" 24h
  startMins: number;  // minutes since midnight
  endMins: number;
  durationMins: number; // actual scheduled duration — may be less than client.sessionHours when
                        // the available window is shorter (flex scheduling, minimum 2h)
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Only schedule Mon–Fri
const SCHEDULABLE_DAYS: DayOfWeek[] = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY",
];

// Candidate slots are generated every 15 minutes within each overlap window.
// 15-min steps let the scheduler start sessions closer to when drive time ends
// (e.g. a 9-min drive leaves a ~6-min buffer at 15-min granularity vs. 21 min at 30).
const SLOT_STEP_MINS = 15;

// Minimum billable session length. When an overlap window is shorter than the
// client's full sessionHours, the scheduler tries a flex duration snapped down
// to the nearest 30 minutes — as long as it's at least this minimum.
// This allows providers to fill afternoon windows that are slightly shorter than
// a full session (e.g., 3h45min after a 4h morning session) instead of leaving
// the provider idle and the client unscheduled.
const MIN_FLEX_SESSION_MINS = 90;        // 1.5h — HOME sessions
const MIN_CENTER_SESSION_MINS = 120;     // 2.0h — CENTER sessions
// CENTER clients get a higher floor to prevent 1.5h fragments with rotating providers
// (e.g. Anderson seeing 5 different providers in one week from short remnant windows).

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Compute the overlap of two intervals [aStart, aEnd) and [bStart, bEnd).
// Returns null if there is no overlap.
function intervalOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number
): { start: number; end: number } | null {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end > start ? { start, end } : null;
}

// Merge a list of possibly-overlapping intervals into a sorted, non-overlapping list.
function mergeIntervals(
  intervals: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

// Subtracts a list of block intervals from a list of free intervals.
// Used to carve lunch blocks (and other provider blocks) out of availability so that
// sessions can only be placed in the remaining contiguous free windows.
// Example: free=[8am–5pm], block=[12pm–1pm] → result=[8am–12pm, 1pm–5pm]
// Without this, a 4h slot starting at 9am would span the lunch block and be rejected,
// even though a 3h session ending at 12pm (or a session starting at 1pm) is perfectly valid.
function subtractIntervals(
  intervals: Array<{ start: number; end: number }>,
  toRemove: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  let result = [...intervals];
  for (const block of toRemove) {
    const next: Array<{ start: number; end: number }> = [];
    for (const iv of result) {
      // No overlap — keep as-is
      if (block.end <= iv.start || block.start >= iv.end) {
        next.push(iv);
        continue;
      }
      // Portion before the block
      if (iv.start < block.start) next.push({ start: iv.start, end: block.start });
      // Portion after the block
      if (iv.end > block.end) next.push({ start: block.end, end: iv.end });
    }
    result = next;
  }
  return result;
}

// Returns true if [slotStart, slotEnd) overlaps any window in the booked list for the given day.
function overlapsAnyBooked(
  day: DayOfWeek,
  slotStart: number,
  slotEnd: number,
  windows: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>
): boolean {
  return windows.some((w) => {
    if (w.dayOfWeek !== day) return false;
    const ws = parseHHMM(w.startTime);
    const we = parseHHMM(w.endTime);
    return slotStart < we && slotEnd > ws;
  });
}

// Returns true if [slotStart, slotEnd) overlaps any committed BookedSlot for the given day.
function overlapsWorkingState(
  day: DayOfWeek,
  slotStart: number,
  slotEnd: number,
  committed: BookedSlot[]
): boolean {
  return committed.some(
    (s) => s.dayOfWeek === day && slotStart < s.endMins && slotEnd > s.startMins
  );
}

// Minimum gap enforced between consecutive HOME sessions when the Maps API has no data.
// Prevents back-to-back scheduling even when drive time is unknown.
const MIN_HOME_GAP_MINS = 15;

// Returns true if there is enough travel time between the proposed slot and every
// already-committed slot for this provider on the same day.
//
// For each committed slot on the same day:
//   - If the new slot starts after the committed slot ends → the provider drives FROM
//     the committed client TO the new client. Gap must be ≥ client→client drive time.
//   - If the new slot ends before the committed slot starts → the provider drives FROM
//     the new client TO the committed client. Gap must be ≥ client→client drive time.
//
// Falls back to MIN_HOME_GAP_MINS when the Maps API returned 0 (API failure or no data),
// so consecutive HOME sessions are never scheduled back-to-back.
//
// Committed slots include BOTH in-run working state assignments AND existing DB sessions.
// This ensures a new proposal always has proper drive time clearance from already-approved
// sessions, not just from sessions committed earlier in the same run.
//
// minimumOnly = true (used on the retry pass for HOME clients): always use MIN_HOME_GAP_MINS
// regardless of API times, giving the client a second chance without allowing zero-gap scheduling.
//
// Drive Time sessions are skipped — they already represent the travel buffer.
// All other non-client sessions (Lunch, Break, Admin, etc.) require at least
// MIN_HOME_GAP_MINS gap before/after a HOME client slot — the provider's lunch
// location isn't tracked, so a hard 15-min floor prevents zero-gap scheduling
// from a lunch into a HOME visit. (Direct overlap is still blocked separately.)
function hasSufficientDriveGap(
  day: DayOfWeek,
  slotStart: number,
  slotEnd: number,
  _providerId: string,
  newClientId: string,
  committed: BookedSlot[],
  driveMinutes: Record<string, Record<string, number>>,
  minimumOnly = false
): boolean {
  for (const booked of committed) {
    if (booked.dayOfWeek !== day) continue;
    // Drive Time sessions are filtered out by the propose route before reaching
    // the engine, so any clientId-less window here is a lunch/break/admin and
    // requires at least the minimum gap before/after a HOME client slot.
    const isNonClient = !booked.clientId;

    if (slotStart >= booked.endMins) {
      // New slot is after this committed slot.
      // - If prior slot has a client, use client→client drive time.
      // - If prior slot is non-client (lunch/admin), enforce only the minimum gap.
      const apiMins = isNonClient
        ? 0
        : (minimumOnly ? 0 : (driveMinutes[booked.clientId]?.[newClientId] ?? 0));
      const required = apiMins > 0 ? apiMins : MIN_HOME_GAP_MINS;
      const gap = slotStart - booked.endMins;
      if (gap < required) return false;
    } else if (slotEnd <= booked.startMins) {
      // New slot is before this committed slot — same logic in reverse.
      const apiMins = isNonClient
        ? 0
        : (minimumOnly ? 0 : (driveMinutes[newClientId]?.[booked.clientId] ?? 0));
      const required = apiMins > 0 ? apiMins : MIN_HOME_GAP_MINS;
      const gap = booked.startMins - slotEnd;
      if (gap < required) return false;
    }
  }
  return true;
}

// Returns true if [slotStart, slotEnd) overlaps a ProviderBlock on the given calendar date.
// dateStr is "YYYY-MM-DD" in the center's timezone.
function overlapsBlock(
  dateStr: string,
  slotStart: number,
  slotEnd: number,
  blocks: Array<{ date: string; startTime: string; endTime: string }>
): boolean {
  return blocks.some((b) => {
    if (b.date !== dateStr) return false;
    const bs = parseHHMM(b.startTime);
    const be = parseHHMM(b.endTime);
    return slotStart < be && slotEnd > bs;
  });
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Generates all valid candidate time slots for a client-provider pairing
 * during the target week.
 *
 * weekDates maps each DayOfWeek → "YYYY-MM-DD" calendar date string
 * (in the center's timezone) for the target week.
 *
 * Returns an empty array if:
 * - The client has already been scheduled in this run (WorkingState)
 * - No overlapping availability exists on any day
 * - All computed slots are blocked by existing bookings or provider blocks
 */
export function generateSlots(
  client: SchedulerClient,
  provider: SchedulerProvider,
  weekDates: Record<DayOfWeek, string>,
  durationMins: number,
  workingState: WorkingState,
  driveMinutes: Record<string, Record<string, number>>,
  relaxDriveTime = false,
  centerId: string | null = null
): CandidateSlot[] {
  // In week mode: stop generating slots once the client has reached their daysNeeded cap.
  // In single-day mode: stop after any assignment (daysNeeded = 1 by design).
  const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
  const daysNeeded = client.daysNeeded ?? 1;
  if (daysScheduled >= daysNeeded) return [];

  const providerCommitted = workingState.providerBookings.get(provider.id) ?? [];

  // Build combined committed list for gap checking: in-run working state + existing DB sessions.
  // DB sessions (bookedWindows) are included so the gap check applies to already-approved work
  // from prior runs, not just assignments made in the current run.
  // clientId is kept as-is: real UUIDs for therapy sessions, undefined for Drive Time/Admin/etc.
  const dbBooked: BookedSlot[] = provider.bookedWindows.map((w) => ({
    dayOfWeek: w.dayOfWeek,
    startMins: parseHHMM(w.startTime),
    endMins: parseHHMM(w.endTime),
    clientId: w.clientId ?? "",
    locationType: w.locationType,
  }));
  const allCommittedForGap: BookedSlot[] = [...providerCommitted, ...dbBooked];

  const slots: CandidateSlot[] = [];

  for (const day of SCHEDULABLE_DAYS) {
    const dateStr = weekDates[day];

    // weekDates is pre-filtered to the target day only — skip days not in scope
    if (!dateStr) continue;

    // In week mode: skip days this client is already scheduled on this run
    if (workingState.clientScheduledDays.get(client.id)?.has(day)) continue;

    const clientWindows = client.availability.filter((w) => w.dayOfWeek === day);
    const providerWindows = provider.availability.filter((w) => w.dayOfWeek === day);

    // Both parties must have availability on this day
    if (clientWindows.length === 0 || providerWindows.length === 0) continue;

    // Compute all pairwise overlaps between client and provider windows
    const overlaps: Array<{ start: number; end: number }> = [];
    for (const cw of clientWindows) {
      for (const pw of providerWindows) {
        const overlap = intervalOverlap(
          parseHHMM(cw.startTime), parseHHMM(cw.endTime),
          parseHHMM(pw.startTime), parseHHMM(pw.endTime)
        );
        if (overlap) overlaps.push(overlap);
      }
    }
    if (overlaps.length === 0) continue;

    const merged = mergeIntervals(overlaps);

    // Subtract provider blocks, client blocks, AND already-booked sessions from
    // the merged availability before generating slots. This carves committed time
    // out of the free window so the slot generator sees contiguous sub-intervals.
    //
    // ProviderBlock/ClientBlock records are date-specific (one-off day blocks).
    // bookedWindows are dayOfWeek-specific (recurring scheduled sessions).
    // The overlapsAnyBooked / overlapsBlock / overlapsWorkingState checks further
    // in the loop remain as safety nets for edge cases.
    const blockIntervalsToday = provider.blocks
      .filter((b) => b.date === dateStr)
      .map((b) => ({ start: parseHHMM(b.startTime), end: parseHHMM(b.endTime) }));
    const clientBlockIntervalsToday = (client.blocks ?? [])
      .filter((b) => b.date === dateStr)
      .map((b) => ({ start: parseHHMM(b.startTime), end: parseHHMM(b.endTime) }));
    const bookedIntervalsToday = provider.bookedWindows
      .filter((w) => w.dayOfWeek === day)
      .map((w) => ({ start: parseHHMM(w.startTime), end: parseHHMM(w.endTime) }));
    const allBlockedToday = [...blockIntervalsToday, ...clientBlockIntervalsToday, ...bookedIntervalsToday];
    const freeIntervals = allBlockedToday.length > 0
      ? subtractIntervals(merged, allBlockedToday)
      : merged;

    // Minimum session floor scales with the client's expected session length.
    // CENTER clients: max(2h, 60% of session hours) — prevents short fragments with rotating providers.
    // HOME clients:   max(1.5h, 60% of session hours) — prevents 1.5h remnants from being counted
    //   as a full day for clients with 6–7h sessions (Bug A fix: a 1.5h slot must not satisfy a
    //   daysNeeded count for a client whose normal session is 7h).
    const sessionFloor = Math.round(client.sessionHours * 0.6 * 60);
    const minSessionMins = client.preferredLocation === "CENTER"
      ? Math.max(MIN_CENTER_SESSION_MINS, sessionFloor)
      : Math.max(MIN_FLEX_SESSION_MINS, sessionFloor);

    for (const interval of freeIntervals) {
      // Skip intervals that can't possibly fit even the minimum session.
      if (interval.end - interval.start < minSessionMins) continue;

      // Generate candidate slots at SLOT_STEP_MINS intervals.
      // Effective duration is computed per slot based on remaining space from
      // this start to the interval end — this is what enables flex scheduling
      // when earlier slots in the interval are blocked by bookings or drive gaps.
      // Example: interval 9am–5pm, provider already booked 9am–1pm + 15-min gap →
      //   first valid start is 1:15pm, remaining = 3h45m → effectiveDuration = 3.5h (flex).
      for (
        let start = interval.start;
        start + minSessionMins <= interval.end;
        start += SLOT_STEP_MINS
      ) {
        const remainingMins = interval.end - start;
        const effectiveDuration = remainingMins >= durationMins
          ? durationMins
          : Math.floor(remainingMins / 30) * 30;
        if (effectiveDuration < minSessionMins) continue;
        const end = start + effectiveDuration;

        // Reject if the provider has a one-off block covering this slot
        if (overlapsBlock(dateStr, start, end, provider.blocks)) continue;

        // Reject if the client has a rest-of-day block covering this slot
        if (overlapsBlock(dateStr, start, end, client.blocks ?? [])) continue;

        // Reject if the provider is already booked (DB sessions)
        if (overlapsAnyBooked(day, start, end, provider.bookedWindows)) continue;

        // Reject if this client already has a session with this provider today —
        // even if the times don't overlap. Avoids splitting one client's day into
        // two separate sessions with the same provider when a single longer session
        // (or a different client filling the freed slot) is the correct outcome.
        if (provider.bookedWindows.some(w => w.dayOfWeek === day && w.clientId === client.id)) continue;

        // Reject if the provider is already committed in this run
        if (overlapsWorkingState(day, start, end, providerCommitted)) continue;

        // Reject if there isn't enough drive time between this slot and any
        // session already committed to this provider (in-run or existing DB sessions).
        //
        // HOME clients: enforce full API-based gap (MIN_HOME_GAP_MINS fallback).
        //   Retry pass (relaxDriveTime = true): still enforce MIN_HOME_GAP_MINS to prevent
        //   zero-gap scheduling. The retry only relaxes the 45-min hard cap and API gap.
        //
        // CENTER clients: skip the HOME-style gap check (both parties travel to the clinic
        //   independently). HOWEVER, if this CENTER slot immediately follows a HOME session,
        //   the provider must drive from the client's home to the clinic first. Enforce a
        //   gap using driveMinutes[providerId][prevClientId] as a proxy for that distance.
        if (client.preferredLocation !== "CENTER") {
          const minimumOnly = relaxDriveTime;
          if (!hasSufficientDriveGap(day, start, end, provider.id, client.id, allCommittedForGap, driveMinutes, minimumOnly)) continue;
        } else {
          // HOME→CENTER: check that the provider has enough time to travel from each
          // preceding HOME session's client location back to the clinic.
          // Use center→client drive time (centerId key) as a proxy for client→clinic distance.
          // Fall back to provider home if no centerId is set.
          // Mirror the HOME→HOME pattern: always require at least MIN_HOME_GAP_MINS even
          // when the Maps API returns 0 (unknown/failure). On the retry pass, always use
          // MIN_HOME_GAP_MINS regardless of API data (relaxDriveTime = true).
          const driveOriginId = centerId ?? provider.id;
          let sufficientGap = true;
          for (const booked of allCommittedForGap) {
            if (booked.dayOfWeek !== day) continue;
            if (!booked.clientId) continue;
            if (booked.locationType !== "HOME") continue; // only HOME→CENTER transitions need a gap
            if (start < booked.endMins) continue; // CENTER slot overlaps or precedes this HOME slot
            const apiMins = relaxDriveTime ? 0 : (driveMinutes[driveOriginId]?.[booked.clientId] ?? 0);
            const required = apiMins > 0 ? apiMins : MIN_HOME_GAP_MINS;
            if ((start - booked.endMins) < required) {
              sufficientGap = false;
              break;
            }
          }
          if (!sufficientGap) continue;
        }

        // Reject if the client is already booked (DB sessions)
        if (overlapsAnyBooked(day, start, end, client.bookedWindows)) continue;

        slots.push({
          dayOfWeek: day,
          startTime: formatHHMM(start),
          endTime: formatHHMM(end),
          startMins: start,
          endMins: end,
          durationMins: effectiveDuration,
        });
      }
    }
  }

  return slots;
}
