// Greedy scheduling optimizer.
// Iterates clients in priority order, finds the best available provider for each,
// commits the assignment, and moves on. Tracks all within-run assignments in
// WorkingState to prevent double-booking across the same run.
// Pure functions — no database calls, no side effects.

import type { DayOfWeek } from "@prisma/client";
import type {
  SchedulerInput,
  SchedulerOutput,
  ProposedSessionOutput,
  SchedulerClient,
  SchedulerProvider,
  WorkingState,
  BookedSlot,
} from "./types";
import type { CandidateSlot } from "./slots";
import { findEligibleProviders } from "./matcher";
import {
  checkHasAuthorization,
  checkRemainingHours,
  checkRbtLevel,
  checkFemaleRequirement,
  checkSpanishRequirement,
  checkApprovedForClient,
} from "./constraints";

// ─── WorkingState Factory ─────────────────────────────────────────────────────

export function createWorkingState(): WorkingState {
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

// ─── Constraint Anchor Pre-Pass ───────────────────────────────────────────────
// Clients with a very small eligible provider pool are "constrained" — their rare
// providers must be protected. Before the main loop runs, this pass identifies those
// providers and the days they're needed so the matcher can prioritize them.
//
// A provider is anchored to a day if:
//   1. A constrained client (pool ≤ CONSTRAINT_POOL_THRESHOLD) has availability on that day
//   2. The provider passes all static hard constraints for that client
//   3. The provider has availability on that day
//
// "Regardless of which day we eventually schedule the client" — we anchor across all
// days the client is available, not just the days we plan to schedule them.

const CONSTRAINT_POOL_THRESHOLD = 2;

function computeAnchoredProviderDays(
  clients: SchedulerClient[],
  providers: SchedulerProvider[],
  weekDates: Record<DayOfWeek, string>
): Map<string, Set<DayOfWeek>> {
  const anchored = new Map<string, Set<DayOfWeek>>();
  const scheduledDays = new Set(Object.keys(weekDates) as DayOfWeek[]);

  for (const client of clients) {
    // Static hard constraint check only — no slot generation, no availability overlap yet.
    // Mirror the same checks used in findEligibleProviders.
    const eligible = providers.filter((p) => {
      const checks = [
        checkRbtLevel(client, p),
        checkFemaleRequirement(client, p),
        checkSpanishRequirement(client, p),
        // HYBRID tries CENTER first (no approved list), HOME fallback handled at scheduling time
        ...(client.preferredLocation === "HOME" ? [checkApprovedForClient(client, p)] : []),
      ];
      return checks.every((c) => c.pass);
    });

    // Only constrained clients trigger anchoring — if many providers qualify, no anchor needed.
    if (eligible.length === 0 || eligible.length > CONSTRAINT_POOL_THRESHOLD) continue;

    // For each day this client is available (and is a scheduled day this week), find eligible
    // providers who also have availability that day and mark them as anchored.
    for (const window of client.availability) {
      const day = window.dayOfWeek;
      if (!scheduledDays.has(day)) continue;
      for (const provider of eligible) {
        if (!provider.availability.some((w: { dayOfWeek: DayOfWeek }) => w.dayOfWeek === day)) continue;
        if (!anchored.has(provider.id)) anchored.set(provider.id, new Set());
        anchored.get(provider.id)!.add(day);
      }
    }
  }

  return anchored;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a Record<DayOfWeek, "YYYY-MM-DD"> for the Mon–Sun of the target week.
 * weekOf is Monday midnight expressed as UTC (anchored to the center's timezone).
 * Uses Intl.DateTimeFormat to produce the correct local calendar date for each day —
 * avoids UTC date drift for UTC+ timezones where local midnight precedes UTC midnight.
 */
function buildWeekDates(weekOf: Date, timezone: string): Record<DayOfWeek, string> {
  const days: DayOfWeek[] = [
    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY",
    "FRIDAY", "SATURDAY", "SUNDAY",
  ];
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const result = {} as Record<DayOfWeek, string>;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekOf.getTime() + i * 24 * 3_600_000);
    result[days[i]] = fmt.format(d);
  }
  return result;
}

/** Writes an assignment into WorkingState so subsequent clients see it. */
function commitAssignment(
  providerId: string,
  clientId: string,
  slot: CandidateSlot,
  sessionHours: number,
  locationType: "HOME" | "CENTER" | "SCHOOL",
  workingState: WorkingState
): void {
  const booked: BookedSlot = {
    dayOfWeek: slot.dayOfWeek,
    startMins: slot.startMins,
    endMins: slot.endMins,
    clientId,
    locationType,
  };

  if (!workingState.providerBookings.has(providerId)) {
    workingState.providerBookings.set(providerId, []);
  }
  workingState.providerBookings.get(providerId)!.push(booked);

  // Single-day compat: clientScheduled tracks any assignment (used as fallback in slots.ts)
  workingState.clientScheduled.add(clientId);

  workingState.providerHoursCommitted.set(
    providerId,
    (workingState.providerHoursCommitted.get(providerId) ?? 0) + sessionHours
  );

  // Week-mode tracking
  if (!workingState.clientScheduledDays.has(clientId)) {
    workingState.clientScheduledDays.set(clientId, new Set());
  }
  workingState.clientScheduledDays.get(clientId)!.add(slot.dayOfWeek);

  workingState.sessionsPerDay.set(
    slot.dayOfWeek,
    (workingState.sessionsPerDay.get(slot.dayOfWeek) ?? 0) + 1
  );

  workingState.clientHoursCommitted.set(
    clientId,
    (workingState.clientHoursCommitted.get(clientId) ?? 0) + sessionHours
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function optimize(
  input: SchedulerInput,
  workingState: WorkingState
): SchedulerOutput {
  const allWeekDates = buildWeekDates(input.weekOf, input.timezone);

  // In week mode use Mon–Fri dates on or after targetDate (skips already-passed days).
  // targetDate = today when called from propose-week, so Monday/Tuesday are excluded
  // when running mid-week. In day mode restrict to targetDate only.
  const weekDates = input.weekMode
    ? (Object.fromEntries(
        Object.entries(allWeekDates).filter(([day, dateStr]) =>
          ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"].includes(day) &&
          dateStr >= input.targetDate
        )
      ) as Record<DayOfWeek, string>)
    : (Object.fromEntries(
        Object.entries(allWeekDates).filter(([, dateStr]) => dateStr === input.targetDate)
      ) as Record<DayOfWeek, string>);

  // Pre-pass: anchor constrained-client providers to days they're needed.
  // Runs after weekDates is finalized so we only consider days in scope for this run.
  workingState.anchoredProviderDays = computeAnchoredProviderDays(
    input.clients, input.providers, weekDates
  );

  // targetDay: only meaningful in single-day mode (used for availability sort)
  const targetDay = input.weekMode
    ? null
    : ((Object.keys(weekDates)[0] ?? null) as DayOfWeek | null);

  const providerCount = input.providers.length;

  // Count providers that actually pass all hard constraints for this client.
  // Replaces the old approvedProviderIds.length shortcut, which ignored RBT level,
  // female-only, and Spanish requirements — inflating pool size for constrained clients
  // and causing them to be deprioritized behind easier-to-schedule clients.
  function constraintScore(c: SchedulerClient): number {
    // HYBRID and CENTER clients don't require the approved-home list — use the wider pool.
    if (c.preferredLocation === "CENTER" || c.preferredLocation === "HYBRID" || c.preferredLocation === "SCHOOL") {
      const eligibleCount = input.providers.filter((p) =>
        checkRbtLevel(c, p).pass && checkFemaleRequirement(c, p).pass && checkSpanishRequirement(c, p).pass
      ).length;
      return eligibleCount - c.sessionHours;
    }
    const eligibleCount = input.providers.filter((p) =>
      checkRbtLevel(c, p).pass && checkFemaleRequirement(c, p).pass &&
      checkSpanishRequirement(c, p).pass && checkApprovedForClient(c, p).pass
    ).length;
    const poolBase = eligibleCount === 0 ? input.providers.length : eligibleCount;
    return poolBase - c.sessionHours;
  }

  function availWindowMins(c: SchedulerClient): number {
    if (input.weekMode) {
      // Week mode: total available minutes across all scheduled days
      const mins = c.availability.reduce((sum, w) => {
        if (!weekDates[w.dayOfWeek]) return sum;
        const [sh, sm] = w.startTime.split(":").map(Number);
        const [eh, em] = w.endTime.split(":").map(Number);
        return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
      }, 0);
      return mins === 0 ? 9999 : mins;
    }
    // Single-day mode
    if (!targetDay) return 9999;
    const mins = c.availability
      .filter((w) => w.dayOfWeek === targetDay)
      .reduce((sum, w) => {
        const [sh, sm] = w.startTime.split(":").map(Number);
        const [eh, em] = w.endTime.split(":").map(Number);
        return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
      }, 0);
    return mins === 0 ? 9999 : mins;
  }

  const lockedSet = new Set(input.lockedClientIds ?? []);

  const sortedClients = [...input.clients].sort((a, b) => {
    const aLocked = lockedSet.has(a.id) ? 0 : 1;
    const bLocked = lockedSet.has(b.id) ? 0 : 1;
    if (aLocked !== bLocked) return aLocked - bLocked;

    const aScore = constraintScore(a);
    const bScore = constraintScore(b);
    if (aScore !== bScore) return aScore - bScore;
    if (b.sessionHours !== a.sessionHours) return b.sessionHours - a.sessionHours;
    const aWin = availWindowMins(a);
    const bWin = availWindowMins(b);
    if (aWin !== bWin) return aWin - bWin;
    const aRemaining = a.approvedWeeklyHours - a.usedHoursThisWeek;
    const bRemaining = b.approvedWeeklyHours - b.usedHoursThisWeek;
    if (aRemaining !== bRemaining) return aRemaining - bRemaining;
    return a.id.localeCompare(b.id);
  });

  const proposals: ProposedSessionOutput[] = [];
  const skipReasons: Record<string, string> = {};
  const warnings: string[] = [];

  // ── Expiring authorization warnings ──────────────────────────────────────────
  const targetMs = new Date(input.targetDate).getTime();
  for (const client of input.clients) {
    if (!client.authorizationEndDate) continue;
    const daysLeft = Math.ceil(
      (new Date(client.authorizationEndDate).getTime() - targetMs) / 86_400_000
    );
    if (daysLeft >= 0 && daysLeft <= 14) {
      warnings.push(
        `Authorization expiring: ${client.lastName}, ${client.firstName} — ${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`
      );
    }
  }

  // ── Helper: attempt to schedule one client ────────────────────────────────────
  function trySchedule(client: SchedulerClient, relaxDriveTime: boolean): boolean {
    // Cancellation pairing restriction: when a cancellationContext is present,
    // displaced clients (provider-cancelled) can ONLY be matched with freed providers
    // (client-cancelled), and freed providers cannot be used for regular clients.
    // This enforces: single cancellation → no new proposals; double → targeted match only.
    const ctx = input.cancellationContext;
    let visibleProviders = input.providers;
    if (ctx) {
      const freedSet = new Set(ctx.freedProviderIds);
      const isDisplaced = ctx.displacedClientIds.includes(client.id);
      if (isDisplaced) {
        // Displaced client: only a freed provider (whose client cancelled) can absorb them
        visibleProviders = input.providers.filter((p) => freedSet.has(p.id));
        if (visibleProviders.length === 0) {
          skipReasons[client.id] =
            "Provider cancelled — no client cancellations on this day to create a swap opportunity";
          return false;
        }
      } else {
        // Not a displaced client — skip entirely during a switch-only run.
        // No new clients should be brought in who weren't already on this day's schedule.
        return false;
      }
    }

    // HYBRID: try CENTER first, fall back to HOME if no eligible providers found.
    // SCHOOL behaves like CENTER for matching (open pool, no approved-list, no provider→client drive)
    // but the resolved locationType is recorded as SCHOOL on the proposal.
    // resolvedLocationType tracks which mode succeeded for proposal creation below.
    let resolvedLocationType: "HOME" | "CENTER" | "SCHOOL" =
      client.preferredLocation === "SCHOOL" ? "SCHOOL" : "CENTER";
    let clientForMatch =
      client.preferredLocation === "HYBRID" || client.preferredLocation === "SCHOOL"
        ? { ...client, preferredLocation: "CENTER" as const }
        : client;

    const notBeforeMs = input.notBefore?.getTime() ?? null;

    let { ranked, failures } = findEligibleProviders(
      clientForMatch,
      visibleProviders,
      weekDates,
      input.driveMinutes,
      workingState,
      relaxDriveTime,
      input.centerId ?? null,
      notBeforeMs,
      input.timezone
    );

    if (ranked.length === 0 && client.preferredLocation === "HYBRID") {
      // CENTER pass found nothing — retry as HOME
      clientForMatch = { ...client, preferredLocation: "HOME" as const };
      ({ ranked, failures } = findEligibleProviders(
        clientForMatch,
        visibleProviders,
        weekDates,
        input.driveMinutes,
        workingState,
        relaxDriveTime,
        input.centerId ?? null,
        notBeforeMs,
        input.timezone
      ));
      if (ranked.length > 0) resolvedLocationType = "HOME";
    } else if (client.preferredLocation !== "HYBRID") {
      resolvedLocationType =
        client.preferredLocation === "HOME"
          ? "HOME"
          : client.preferredLocation === "SCHOOL"
            ? "SCHOOL"
            : "CENTER";
    }

    if (ranked.length === 0) {
      const uniqueReasons = [...new Set(failures.map((f) => f.reason))];
      const isDisplacedClient = ctx?.displacedClientIds.includes(client.id) ?? false;
      if (isDisplacedClient) {
        skipReasons[client.id] = uniqueReasons.length > 0
          ? `Provider cancelled — freed provider available but no compatible time slot: ${uniqueReasons.slice(0, 2).join("; ")}`
          : "Provider cancelled — freed provider available but no overlapping time slots today";
      } else {
        skipReasons[client.id] = uniqueReasons.length > 0
          ? `No eligible providers: ${uniqueReasons.slice(0, 2).join("; ")}`
          : "No providers available for this week";
      }
      return false;
    }

    const best = ranked[0];
    const { provider, slot } = best;

    const providerLabel = `${provider.lastName}, ${provider.firstName} (${provider.position}${provider.rbtLevel ? ` Level ${provider.rbtLevel}` : ""})`;
    const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
    const remaining = client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours;
    const constraintNotes: string[] = [];
    if (client.spanish) constraintNotes.push("Spanish requirement matched");
    if (client.femaleProviderOnly) constraintNotes.push("Female provider requirement met");
    if (provider.position === "BCBA") constraintNotes.push("BCBA assigned as last resort — no eligible RBT or BCaBA available");
    if (relaxDriveTime) constraintNotes.push("Drive time constraint relaxed (retry pass)");

    const locationType = resolvedLocationType;
    const sessionTypeId = input.sessionTypeIds[locationType];

    if (client.preferredLocation === "HYBRID" && locationType === "HOME")
      constraintNotes.push("Hybrid client — scheduled HOME (no CENTER slots available)");
    if (locationType === "HOME") constraintNotes.push("Home session — approved provider list enforced");

    const reasoning = [
      `Assigned ${providerLabel} on ${slot.dayOfWeek} ${slot.startTime}–${slot.endTime}.`,
      `Auth …${client.authorizationId?.slice(-6)}: ${remaining.toFixed(1)}h remaining of ${client.approvedWeeklyHours}h authorized.`,
      `Provider ranked #1 of ${ranked.length} eligible: ${best.committedHours}h committed this run, ${best.driveMinutes} min drive, ${best.idleMinutes} min idle introduced.`,
      constraintNotes.length > 0 ? constraintNotes.join(". ") + "." : null,
    ]
      .filter(Boolean)
      .join(" ");

    proposals.push({
      clientId: client.id,
      providerId: provider.id,
      authorizationId: client.authorizationId,
      sessionTypeId,
      locationType,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      reasoning,
    });

    commitAssignment(provider.id, client.id, slot, slot.durationMins / 60, locationType, workingState);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WEEK MODE — multi-round scheduling
  // Each round attempts to assign one more day for every client that still needs days.
  // Rounds continue until every client has reached daysNeeded or no more slots exist.
  // ─────────────────────────────────────────────────────────────────────────────
  if (input.weekMode) {
    const maxRounds = Math.max(...sortedClients.map((c) => c.daysNeeded), 1);
    const partialFailures = new Set<string>(); // clients that failed at least one round

    for (let round = 0; round < maxRounds; round++) {
      for (const client of sortedClients) {
        const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
        if (daysScheduled >= client.daysNeeded) continue;

        const authCheck = checkHasAuthorization(client);
        if (!authCheck.pass) { skipReasons[client.id] = authCheck.reason; continue; }

        if (client.availability.length === 0) {
          skipReasons[client.id] = "Client has no availability windows on file";
          continue;
        }

        // Account for hours already committed this run so auth isn't over-drawn
        const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
        const effectiveRemaining = client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours;
        if (effectiveRemaining < client.sessionHours) {
          // Only record a skip reason for clients with zero days scheduled — partials
          // get their reason set later in the partial-coverage pass below.
          const daysSoFar = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
          if (daysSoFar === 0) {
            skipReasons[client.id] = `Auth exhausted: ${effectiveRemaining.toFixed(1)}h remaining < ${client.sessionHours}h per session`;
          }
          continue;
        }

        const scheduled = trySchedule(client, false);
        if (!scheduled) partialFailures.add(client.id);
      }
    }

    // Retry pass: relax drive time for clients that still need days
    for (const client of sortedClients) {
      const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
      if (daysScheduled >= client.daysNeeded) {
        delete skipReasons[client.id]; // fully scheduled — clear any stale reason
        continue;
      }
      if (!partialFailures.has(client.id) && daysScheduled === 0) continue;

      const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
      const effectiveRemaining = client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours;
      if (effectiveRemaining < client.sessionHours) continue;

      // Try remaining days with relaxed drive time
      const remaining = client.daysNeeded - daysScheduled;
      for (let i = 0; i < remaining; i++) {
        const inRun2 = workingState.clientHoursCommitted.get(client.id) ?? 0;
        const effRem2 = client.approvedWeeklyHours - client.usedHoursThisWeek - inRun2;
        if (effRem2 < client.sessionHours) break;
        const scheduled = trySchedule(client, true);
        if (!scheduled) break; // no more slots — stop retrying
      }
    }

    // Capacity sweep: after the retry pass, look for clients who are scheduled on all
    // their daysNeeded but still have authorized hours remaining. Attempt extra sessions
    // on unscheduled days to absorb the leftover authorization budget. This catches
    // clients like Clark (35h auth, 5h sessions, 5 days needed) who reach daysNeeded
    // but have residual hours that could become additional billable sessions.
    for (const client of sortedClients) {
      const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
      const effectiveRemaining = client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours;
      // Only run sweep if meaningful hours remain (at least one full session worth)
      if (effectiveRemaining < client.sessionHours) continue;

      // Only sweep clients already at or past daysNeeded — they finished the normal loop
      const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
      if (daysScheduled < client.daysNeeded) continue;

      // Temporarily raise daysNeeded ceiling for this sweep — let the engine schedule more days
      // up to the client's max available weekdays. Use relaxed drive time so availability
      // overlap is the only remaining constraint.
      const availableDays = [...new Set(client.availability.map((w) => w.dayOfWeek))].length;
      const originalDaysNeeded = client.daysNeeded;
      client.daysNeeded = availableDays;

      for (let extra = 0; extra < availableDays - originalDaysNeeded; extra++) {
        const inRun2 = workingState.clientHoursCommitted.get(client.id) ?? 0;
        const effRem2 = client.approvedWeeklyHours - client.usedHoursThisWeek - inRun2;
        if (effRem2 < client.sessionHours) break;
        const scheduled = trySchedule(client, true);
        if (!scheduled) break;
      }

      // Restore original daysNeeded so skip reason reporting is unaffected
      client.daysNeeded = originalDaysNeeded;
    }

    // Final pass: set skip reasons correctly
    for (const client of sortedClients) {
      const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
      if (daysScheduled >= client.daysNeeded) {
        delete skipReasons[client.id];
      } else if (daysScheduled > 0) {
        // Partial — got some but not all needed days
        const existing = skipReasons[client.id] ?? "no provider found for remaining days";
        skipReasons[client.id] = `Partially scheduled (${daysScheduled}/${client.daysNeeded} days): ${existing}`;
      }
      // daysScheduled === 0: keep whatever skip reason was set
    }

  } else {
    // ─────────────────────────────────────────────────────────────────────────
    // SINGLE-DAY MODE — original behavior preserved exactly
    // ─────────────────────────────────────────────────────────────────────────
    const failedFirstPass: SchedulerClient[] = [];
    for (const client of sortedClients) {
      if (workingState.clientScheduled.has(client.id)) continue;

      const authCheck = checkHasAuthorization(client);
      if (!authCheck.pass) { skipReasons[client.id] = authCheck.reason; continue; }

      const hoursCheck = checkRemainingHours(client, client.sessionHours);
      if (!hoursCheck.pass) { skipReasons[client.id] = hoursCheck.reason; continue; }

      if (client.availability.length === 0) {
        skipReasons[client.id] = "Client has no availability windows on file";
        continue;
      }

      if (targetDay && !client.availability.some((w) => w.dayOfWeek === targetDay)) {
        const dayLabel = targetDay.charAt(0) + targetDay.slice(1).toLowerCase();
        skipReasons[client.id] = `Not available on ${dayLabel}s`;
        continue;
      }

      const scheduled = trySchedule(client, false);
      if (!scheduled) failedFirstPass.push(client);
    }

    for (const client of failedFirstPass) {
      if (workingState.clientScheduled.has(client.id)) continue;
      const scheduled = trySchedule(client, true);
      if (scheduled) delete skipReasons[client.id];
    }
  }

  // ── High drive time warnings ──────────────────────────────────────────────────
  const HIGH_DRIVE_THRESHOLD = 30;
  const clientNameMap = new Map(input.clients.map((c) => [c.id, `${c.lastName}, ${c.firstName}`]));
  const providerNameMap = new Map(input.providers.map((p) => [p.id, `${p.lastName}, ${p.firstName}`]));
  for (const proposal of proposals) {
    const drive = input.driveMinutes[proposal.providerId]?.[proposal.clientId] ?? 0;
    if (drive > HIGH_DRIVE_THRESHOLD) {
      warnings.push(
        `High drive time: ${providerNameMap.get(proposal.providerId)} → ${clientNameMap.get(proposal.clientId)} (${drive} min)`
      );
    }
  }

  // A client is "scheduled" if they have at least one proposal this run
  const scheduledIds = new Set(proposals.map((p) => p.clientId));
  const unscheduledClientIds = input.clients
    .map((c) => c.id)
    .filter((id) => !scheduledIds.has(id));

  const estimatedTotalDriveMinutes = proposals.reduce(
    (sum, p) => sum + (input.driveMinutes[p.providerId]?.[p.clientId] ?? 0),
    0
  );

  return {
    proposals,
    totalClientsScheduled: scheduledIds.size,
    totalClientsUnscheduled: unscheduledClientIds.length,
    unscheduledClientIds,
    estimatedTotalDriveMinutes,
    skipReasons,
    warnings,
  };
}
