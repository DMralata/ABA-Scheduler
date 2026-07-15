/**
 * simulate-logic-changes.ts
 *
 * Runs the scheduler TWICE on the same week — BASELINE vs PROPOSED — without
 * writing anything to the database. Produces a side-by-side comparison of every
 * metric AUDIT_GOD tracks so you can decide which changes to permanently apply.
 *
 * Changes simulated:
 *   Bug 1    — sessionHours capped at MAX_SESSION_HOURS (was uncapped; Clark gets 7h, Rivera 10h)
 *   Bug 2    — daysNeeded filtered to Mon–Fri only (was counting Sat/Sun availability days)
 *   Bug 3    — constraintScore uses actual eligible provider count (female/Spanish/RBT level)
 *   LogicGap1 — preferred slot match added as provider sort tier (tier 3, after historical)
 *   LogicGap2 — historical lookback extended 4 weeks → 12 weeks
 *   LogicGap3 — weeklyHoursAlreadyScheduled loaded from DB (was hardcoded 0 in scripts)
 *
 * Not simulated (LogicGap4: flex snapping floor→round — <15 min/session, low impact)
 *
 * Usage: npx tsx scripts/simulate-logic-changes.ts [YYYY-MM-DD]
 */

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import { generateSlots } from "../src/lib/scheduler/slots";
import type { CandidateSlot } from "../src/lib/scheduler/slots";
import type {
  SchedulerClient, SchedulerProvider, WorkingState,
  BookedSlot, SchedulerInput, SchedulerOutput, ProposedSessionOutput,
} from "../src/lib/scheduler/types";
import {
  checkRbtLevel, checkFemaleRequirement, checkSpanishRequirement,
  checkApprovedForClient, checkHasAuthorization,
} from "../src/lib/scheduler/constraints";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();

const MAX_SESSION_HOURS = 6.0;
const MIN_SESSION_HOURS = 1.5;
const SCHEDULABLE_DAYS = new Set<DayOfWeek>(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]);

// ─── Shared helpers ───────────────────────────────────────────────────────────

function toLocalDateStr(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function toLocalDayOfWeek(d: Date, tz: string): DayOfWeek {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d).toUpperCase() as DayOfWeek;
}
function toLocalTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
function parseHHMM(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

// ─── Proposed engine — inlined with changes for Bug 3 and LogicGap 1 ─────────
// Copies the minimum needed from optimizer.ts and matcher.ts with modifications
// clearly marked. Everything unchanged is identical to the production code.

const POSITION_TIER: Record<"BCBA" | "BCaBA" | "RBT", number> = { RBT: 0, BCaBA: 1, BCBA: 2 };

// Copied from optimizer.ts (not exported) — unchanged
function buildWeekDatesSim(weekOf: Date, timezone: string): Record<DayOfWeek, string> {
  const days: DayOfWeek[] = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const result = {} as Record<DayOfWeek, string>;
  for (let i = 0; i < 7; i++) {
    result[days[i]] = fmt.format(new Date(weekOf.getTime() + i * 24 * 3_600_000));
  }
  return result;
}

// Copied from optimizer.ts (not exported) — unchanged
function commitAssignmentSim(
  providerId: string, clientId: string, slot: CandidateSlot,
  sessionHours: number, locationType: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE", ws: WorkingState
): void {
  const booked: BookedSlot = { dayOfWeek: slot.dayOfWeek, startMins: slot.startMins, endMins: slot.endMins, clientId, locationType };
  if (!ws.providerBookings.has(providerId)) ws.providerBookings.set(providerId, []);
  ws.providerBookings.get(providerId)!.push(booked);
  ws.clientScheduled.add(clientId);
  ws.providerHoursCommitted.set(providerId, (ws.providerHoursCommitted.get(providerId) ?? 0) + sessionHours);
  if (!ws.clientScheduledDays.has(clientId)) ws.clientScheduledDays.set(clientId, new Set());
  ws.clientScheduledDays.get(clientId)!.add(slot.dayOfWeek);
  ws.sessionsPerDay.set(slot.dayOfWeek, (ws.sessionsPerDay.get(slot.dayOfWeek) ?? 0) + 1);
  ws.clientHoursCommitted.set(clientId, (ws.clientHoursCommitted.get(clientId) ?? 0) + sessionHours);
}

// Copied from optimizer.ts (not exported) — unchanged
function computeAnchoredProviderDaysSim(
  clients: SchedulerClient[], providers: SchedulerProvider[], weekDates: Record<DayOfWeek, string>
): Map<string, Set<DayOfWeek>> {
  const anchored = new Map<string, Set<DayOfWeek>>();
  const scheduledDays = new Set(Object.keys(weekDates) as DayOfWeek[]);
  const THRESHOLD = 2;
  for (const client of clients) {
    const eligible = providers.filter((p) => {
      const checks = [
        checkRbtLevel(client, p), checkFemaleRequirement(client, p), checkSpanishRequirement(client, p),
        ...(client.preferredLocation === "HOME" ? [checkApprovedForClient(client, p)] : []),
      ];
      return checks.every((c) => c.pass);
    });
    if (eligible.length === 0 || eligible.length > THRESHOLD) continue;
    for (const window of client.availability) {
      const day = window.dayOfWeek;
      if (!scheduledDays.has(day)) continue;
      for (const provider of eligible) {
        if (!provider.availability.some((w) => w.dayOfWeek === day)) continue;
        if (!anchored.has(provider.id)) anchored.set(provider.id, new Set());
        anchored.get(provider.id)!.add(day);
      }
    }
  }
  return anchored;
}

// Copied from matcher.ts (private) — unchanged
function slotIdleSim(
  day: DayOfWeek, slotStart: number, slotEnd: number, _pid: string, clientId: string,
  committed: BookedSlot[], driveMinutes: Record<string, Record<string, number>>
): number {
  let idle = 0;
  for (const booked of committed) {
    if (booked.dayOfWeek !== day) continue;
    if (slotStart >= booked.endMins) {
      const drive = driveMinutes[booked.clientId]?.[clientId] ?? 0;
      idle += Math.max(0, (slotStart - booked.endMins) - drive);
    } else if (slotEnd <= booked.startMins) {
      const drive = driveMinutes[clientId]?.[booked.clientId] ?? 0;
      idle += Math.max(0, (booked.startMins - slotEnd) - drive);
    }
  }
  return idle;
}

// Copied from matcher.ts (private) — modified to also return matchesPreferred (LogicGap 1 support)
function selectBestSlotSim(
  slots: CandidateSlot[], providerId: string, clientId: string,
  committed: BookedSlot[], driveMinutes: Record<string, Record<string, number>>,
  sessionsPerDay?: Map<DayOfWeek, number>,
  anchoredProviderDays?: Map<string, Set<DayOfWeek>>,
  preferredSlots?: Array<{ dayOfWeek: DayOfWeek; startTime: string }>
): { slot: CandidateSlot; idleMinutes: number; matchesPreferred: boolean } {
  let restricted = slots;
  let matchesPreferred = false;
  if (preferredSlots && preferredSlots.length > 0) {
    const pref = slots.filter((s) =>
      preferredSlots.some((p) =>
        p.dayOfWeek === s.dayOfWeek &&
        s.startMins === (parseInt(p.startTime.split(":")[0]) * 60 + parseInt(p.startTime.split(":")[1]))
      )
    );
    if (pref.length > 0) { restricted = pref; matchesPreferred = true; }
  }
  const providerWorkingDays = new Set(committed.map((b) => b.dayOfWeek));
  const isWorkingDay = (d: DayOfWeek) =>
    providerWorkingDays.has(d) || (anchoredProviderDays?.get(providerId)?.has(d) ?? false);

  let best = restricted[0];
  let bestIdle = slotIdleSim(restricted[0].dayOfWeek, restricted[0].startMins, restricted[0].endMins, providerId, clientId, committed, driveMinutes);
  let bestLoad = sessionsPerDay?.get(restricted[0].dayOfWeek) ?? 0;
  let bestWorking = isWorkingDay(restricted[0].dayOfWeek);

  for (let i = 1; i < restricted.length; i++) {
    const idle = slotIdleSim(restricted[i].dayOfWeek, restricted[i].startMins, restricted[i].endMins, providerId, clientId, committed, driveMinutes);
    const load = sessionsPerDay?.get(restricted[i].dayOfWeek) ?? 0;
    const working = isWorkingDay(restricted[i].dayOfWeek);
    const betterW = working && !bestWorking;
    const worseW = !working && bestWorking;
    if (worseW) continue;
    if (betterW || (!worseW && idle < bestIdle) || (!worseW && idle === bestIdle && load < bestLoad)) {
      bestIdle = idle; best = restricted[i]; bestLoad = load; bestWorking = working;
    }
  }
  return { slot: best, idleMinutes: bestIdle, matchesPreferred };
}

// PROPOSED matcher — LogicGap 1: adds preferred-slot match as sort tier #3
// (between historical match and day-consolidation)
function findEligibleProvidersProposed(
  client: SchedulerClient, providers: SchedulerProvider[],
  weekDates: Record<DayOfWeek, string>, driveMinutes: Record<string, Record<string, number>>,
  workingState: WorkingState, relaxDriveTime = false, centerId: string | null = null
): { ranked: Array<{ provider: SchedulerProvider; slot: CandidateSlot; committedHours: number; driveMinutes: number; idleMinutes: number; weeklyHours: number; matchesPreferred: boolean }>; failures: Array<{ providerId: string; reason: string }> } {
  const durationMins = Math.round(client.sessionHours * 60);
  const ranked: Array<{ provider: SchedulerProvider; slot: CandidateSlot; committedHours: number; driveMinutes: number; idleMinutes: number; weeklyHours: number; matchesPreferred: boolean }> = [];
  const failures: Array<{ providerId: string; reason: string }> = [];

  for (const provider of providers) {
    const checks = [
      checkRbtLevel(client, provider), checkFemaleRequirement(client, provider),
      checkSpanishRequirement(client, provider),
      ...(client.preferredLocation === "HOME" ? [checkApprovedForClient(client, provider)] : []),
    ];
    const failed = checks.find((c) => !c.pass);
    if (failed) { failures.push({ providerId: provider.id, reason: failed.reason }); continue; }

    const MAX_DRIVE_MINS = 45;
    if (!relaxDriveTime && client.preferredLocation !== "CENTER") {
      const cap = driveMinutes[provider.id]?.[client.id] ?? 0;
      if (cap > MAX_DRIVE_MINS) { failures.push({ providerId: provider.id, reason: `${cap} min drive exceeds cap` }); continue; }
    }

    const slots = generateSlots(client, provider, weekDates, durationMins, workingState, driveMinutes, relaxDriveTime, centerId);
    if (slots.length === 0) { failures.push({ providerId: provider.id, reason: "No overlapping availability windows" }); continue; }

    const committedHours = workingState.providerHoursCommitted.get(provider.id) ?? 0;
    const drive = client.preferredLocation === "CENTER" ? 0 : (driveMinutes[provider.id]?.[client.id] ?? 0);
    const providerCommitted = workingState.providerBookings.get(provider.id) ?? [];
    const { slot, idleMinutes, matchesPreferred } = selectBestSlotSim(
      slots, provider.id, client.id, providerCommitted, driveMinutes,
      workingState.sessionsPerDay, workingState.anchoredProviderDays, client.preferredSlots
    );
    ranked.push({ provider, slot, committedHours, driveMinutes: drive, idleMinutes,
      weeklyHours: (provider.weeklyHoursAlreadyScheduled ?? 0) + committedHours, matchesPreferred });
  }

  const historyRank = (id: string) => { const i = client.historicalProviderIds.indexOf(id); return i === -1 ? Infinity : i; };

  ranked.sort((a, b) => {
    const aTier = POSITION_TIER[a.provider.position] ?? 0;
    const bTier = POSITION_TIER[b.provider.position] ?? 0;
    if (aTier !== bTier) return aTier - bTier;

    // Historical match (tier 2 — same as baseline)
    const aHist = historyRank(a.provider.id);
    const bHist = historyRank(b.provider.id);
    if (aHist !== bHist) return aHist - bHist;

    // ── LOGICGAP 1 CHANGE: preferred slot match as tier 3 ──────────────────────
    if (a.matchesPreferred !== b.matchesPreferred) return a.matchesPreferred ? -1 : 1;
    // ───────────────────────────────────────────────────────────────────────────

    // Day-consolidation (tier 4)
    const aW = (workingState.providerBookings.get(a.provider.id) ?? []).some((bk) => bk.dayOfWeek === a.slot.dayOfWeek);
    const bW = (workingState.providerBookings.get(b.provider.id) ?? []).some((bk) => bk.dayOfWeek === b.slot.dayOfWeek);
    if (aW !== bW) return aW ? -1 : 1;

    // Constraint anchor (tier 5)
    const aA = workingState.anchoredProviderDays.get(a.provider.id)?.has(a.slot.dayOfWeek) ?? false;
    const bA = workingState.anchoredProviderDays.get(b.provider.id)?.has(b.slot.dayOfWeek) ?? false;
    if (aA !== bA) return aA ? -1 : 1;

    if (a.idleMinutes !== b.idleMinutes) return a.idleMinutes - b.idleMinutes;
    if (a.weeklyHours !== b.weeklyHours) return a.weeklyHours - b.weeklyHours;
    if (a.driveMinutes !== b.driveMinutes) return a.driveMinutes - b.driveMinutes;
    return a.provider.id.localeCompare(b.provider.id);
  });

  return { ranked, failures };
}

// PROPOSED optimizer — Bug 3: constraintScore uses actual eligible provider count
// (not just approvedProviderIds.length). Also calls findEligibleProvidersProposed.
function optimizeProposed(input: SchedulerInput, workingState: WorkingState): SchedulerOutput {
  const allWeekDates = buildWeekDatesSim(input.weekOf, input.timezone);
  const weekDates = input.weekMode
    ? (Object.fromEntries(Object.entries(allWeekDates).filter(([day]) => SCHEDULABLE_DAYS.has(day as DayOfWeek))) as Record<DayOfWeek, string>)
    : (Object.fromEntries(Object.entries(allWeekDates).filter(([, d]) => d === input.targetDate)) as Record<DayOfWeek, string>);

  workingState.anchoredProviderDays = computeAnchoredProviderDaysSim(input.clients, input.providers, weekDates);

  const targetDay = input.weekMode ? null : ((Object.keys(weekDates)[0] ?? null) as DayOfWeek | null);

  // ── BUG 3 CHANGE: constraintScore counts actual eligible providers ───────────
  // Baseline uses approvedProviderIds.length (approved home list only).
  // Proposed runs ALL hard constraint checks (female, Spanish, RBT level) to get
  // the true eligible pool size. Clients with tighter real pools schedule earlier.
  function constraintScoreProposed(c: SchedulerClient): number {
    if (c.preferredLocation === "CENTER") {
      // For CENTER clients, count providers passing non-home constraints
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
  // ───────────────────────────────────────────────────────────────────────────

  function availWindowMins(c: SchedulerClient): number {
    if (input.weekMode) {
      const mins = c.availability.reduce((sum, w) => {
        if (!weekDates[w.dayOfWeek]) return sum;
        return sum + Math.max(0, parseHHMM(w.endTime) - parseHHMM(w.startTime));
      }, 0);
      return mins === 0 ? 9999 : mins;
    }
    if (!targetDay) return 9999;
    const mins = c.availability.filter((w) => w.dayOfWeek === targetDay)
      .reduce((sum, w) => sum + Math.max(0, parseHHMM(w.endTime) - parseHHMM(w.startTime)), 0);
    return mins === 0 ? 9999 : mins;
  }

  const lockedSet = new Set(input.lockedClientIds ?? []);
  const sortedClients = [...input.clients].sort((a, b) => {
    const aL = lockedSet.has(a.id) ? 0 : 1, bL = lockedSet.has(b.id) ? 0 : 1;
    if (aL !== bL) return aL - bL;
    const aS = constraintScoreProposed(a), bS = constraintScoreProposed(b);
    if (aS !== bS) return aS - bS;
    if (b.sessionHours !== a.sessionHours) return b.sessionHours - a.sessionHours;
    const aW = availWindowMins(a), bW = availWindowMins(b);
    if (aW !== bW) return aW - bW;
    const aR = a.approvedWeeklyHours - a.usedHoursThisWeek, bR = b.approvedWeeklyHours - b.usedHoursThisWeek;
    if (aR !== bR) return aR - bR;
    return a.id.localeCompare(b.id);
  });

  const proposals: ProposedSessionOutput[] = [];
  const skipReasons: Record<string, string> = {};
  const warnings: string[] = [];

  function tryScheduleProposed(client: SchedulerClient, relaxDriveTime: boolean): boolean {
    const { ranked, failures } = findEligibleProvidersProposed(
      client, input.providers, weekDates, input.driveMinutes, workingState, relaxDriveTime, input.centerId ?? null
    );
    if (ranked.length === 0) {
      skipReasons[client.id] = failures.length > 0
        ? `No eligible providers: ${[...new Set(failures.map((f) => f.reason))].slice(0, 2).join("; ")}`
        : "No providers available";
      return false;
    }
    const { provider, slot } = ranked[0];
    const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
    const remaining = client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours;
    proposals.push({
      clientId: client.id, providerId: provider.id, authorizationId: client.authorizationId,
      sessionTypeId: input.sessionTypeIds[client.preferredLocation === "HOME" ? "HOME" : "CENTER"],
      locationType: (client.preferredLocation === "HOME" ? "HOME" : "CENTER") as "HOME" | "CENTER", dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime, endTime: slot.endTime,
      reasoning: `Proposed: ${provider.lastName} on ${slot.dayOfWeek} ${slot.startTime}–${slot.endTime}. ${remaining.toFixed(1)}h remaining.`,
    });
    commitAssignmentSim(provider.id, client.id, slot, slot.durationMins / 60, client.preferredLocation, workingState);
    return true;
  }

  if (input.weekMode) {
    const maxRounds = Math.max(...sortedClients.map((c) => c.daysNeeded), 1);
    const partialFailures = new Set<string>();

    for (let round = 0; round < maxRounds; round++) {
      for (const client of sortedClients) {
        const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
        if (daysScheduled >= client.daysNeeded) continue;
        if (!checkHasAuthorization(client).pass) { skipReasons[client.id] = "No active authorization"; continue; }
        if (client.availability.length === 0) { skipReasons[client.id] = "No availability"; continue; }
        const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
        if (client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours < client.sessionHours) continue;
        if (!tryScheduleProposed(client, false)) partialFailures.add(client.id);
      }
    }

    for (const client of sortedClients) {
      const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
      if (daysScheduled >= client.daysNeeded) { delete skipReasons[client.id]; continue; }
      if (!partialFailures.has(client.id) && daysScheduled === 0) continue;
      const inRunHours = workingState.clientHoursCommitted.get(client.id) ?? 0;
      const effRem = client.approvedWeeklyHours - client.usedHoursThisWeek - inRunHours;
      if (effRem < client.sessionHours) continue;
      const remaining2 = client.daysNeeded - daysScheduled;
      for (let i = 0; i < remaining2; i++) {
        const inR2 = workingState.clientHoursCommitted.get(client.id) ?? 0;
        if (client.approvedWeeklyHours - client.usedHoursThisWeek - inR2 < client.sessionHours) break;
        if (!tryScheduleProposed(client, true)) break;
      }
    }

    for (const client of sortedClients) {
      const daysScheduled = workingState.clientScheduledDays.get(client.id)?.size ?? 0;
      if (daysScheduled >= client.daysNeeded) { delete skipReasons[client.id]; }
      else if (daysScheduled > 0) {
        skipReasons[client.id] = `Partially scheduled (${daysScheduled}/${client.daysNeeded} days): ${skipReasons[client.id] ?? "no provider for remaining days"}`;
      }
    }
  }

  const scheduledIds = new Set(proposals.map((p) => p.clientId));
  return {
    proposals, totalClientsScheduled: scheduledIds.size,
    totalClientsUnscheduled: input.clients.length - scheduledIds.size,
    unscheduledClientIds: input.clients.map((c) => c.id).filter((id) => !scheduledIds.has(id)),
    estimatedTotalDriveMinutes: 0, skipReasons, warnings,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const targetArg = process.argv[2];
  const targetDateObj = targetArg ? new Date(`${targetArg}T12:00:00Z`) : new Date();

  const center = await prisma.center.findFirst();
  if (!center) { console.error("No center found."); process.exit(1); }
  const tz = center.timezone;
  const { weekStart, weekEnd } = getWeekBoundaries(targetDateObj, tz);
  const weekOf = new Date(weekStart.getTime() + 86_400_000);

  const mondayDate = toLocalDateStr(weekOf, tz);
  const fridayDate = toLocalDateStr(new Date(weekOf.getTime() + 4 * 86_400_000), tz);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`SIMULATION: BASELINE vs PROPOSED — ${mondayDate} → ${fridayDate}`);
  console.log(`Center: ${center.name}  |  TZ: ${tz}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(70)}\n`);

  // ── Session type ────────────────────────────────────────────────────────────
  const sessionType = await prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } })
    ?? await prisma.sessionType.findFirst({ where: { billable: true } });
  if (!sessionType) { console.error("No session type."); process.exit(1); }

  // ── Load clients ────────────────────────────────────────────────────────────
  const rawClients = await prisma.client.findMany({
    where: {
      AND: [
        { OR: [{ centerId: center.id }, { centerId: null }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
      ],
    },
    include: { availability: true, approvedHomeProviders: { where: { endDate: null } }, preferredSlots: true },
  });
  const clientIds = rawClients.map((c) => c.id);

  // ── Authorizations ──────────────────────────────────────────────────────────
  const allAuths = await prisma.authorization.findMany({
    where: { clientId: { in: clientIds }, startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
    orderBy: { startDate: "desc" },
    select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
  });
  const clientAuthMap: Record<string, { authId: string; weeklyHours: number; endDate: Date }> = {};
  for (const auth of allAuths) {
    if (!clientAuthMap[auth.clientId]) clientAuthMap[auth.clientId] = { authId: auth.id, weeklyHours: auth.approvedHoursPerWeek, endDate: auth.endDate };
  }

  const authorizationIds = Object.values(clientAuthMap).map((a) => a.authId);
  const usedSessions = await prisma.session.findMany({
    where: { authorizationId: { in: authorizationIds }, billable: true, status: { in: ["SCHEDULED","IN_PROGRESS","COMPLETED"] }, startTime: { gte: weekStart, lt: weekEnd } },
    select: { authorizationId: true, startTime: true, endTime: true },
  });
  const usedHoursMap: Record<string, number> = {};
  for (const s of usedSessions) {
    if (!s.authorizationId) continue;
    usedHoursMap[s.authorizationId] = (usedHoursMap[s.authorizationId] ?? 0) + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }

  // ── Historical sessions — load BOTH 4-week (baseline) and 12-week (proposed) ─
  const fourWeeksAgo  = new Date(weekStart.getTime() - 28 * 86_400_000);
  const twelveWeeksAgo = new Date(weekStart.getTime() - 84 * 86_400_000);

  const [sessions4wk, sessions12wk] = await Promise.all([
    prisma.session.findMany({
      where: { clientId: { in: clientIds }, startTime: { gte: fourWeeksAgo, lt: weekStart }, status: { in: ["SCHEDULED","COMPLETED","IN_PROGRESS"] } },
      select: { clientId: true, providerId: true, startTime: true }, orderBy: { startTime: "desc" },
    }),
    prisma.session.findMany({
      where: { clientId: { in: clientIds }, startTime: { gte: twelveWeeksAgo, lt: weekStart }, status: { in: ["SCHEDULED","COMPLETED","IN_PROGRESS"] } },
      select: { clientId: true, providerId: true, startTime: true }, orderBy: { startTime: "desc" },
    }),
  ]);

  function buildHistMap(sessions: typeof sessions4wk): Record<string, string[]> {
    const m: Record<string, string[]> = {};
    for (const s of sessions) {
      if (!s.clientId || !s.providerId) continue;
      if (!m[s.clientId]) m[s.clientId] = [];
      if (!m[s.clientId].includes(s.providerId)) m[s.clientId].push(s.providerId);
    }
    return m;
  }
  const hist4wk  = buildHistMap(sessions4wk);
  const hist12wk = buildHistMap(sessions12wk);

  // ── Providers ───────────────────────────────────────────────────────────────
  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });
  const providerIds = rawProviders.map((p) => p.id);

  const providerBlocks = await prisma.providerBlock.findMany({
    where: { providerId: { in: providerIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { providerId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of providerBlocks) {
    if (!blocksByProvider[b.providerId]) blocksByProvider[b.providerId] = [];
    blocksByProvider[b.providerId].push({ date: toLocalDateStr(b.date, tz), startTime: b.startTime, endTime: b.endTime });
  }

  const clientBlocksRaw = await prisma.clientBlock.findMany({
    where: { clientId: { in: clientIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { clientId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByClient: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of clientBlocksRaw) {
    if (!blocksByClient[b.clientId]) blocksByClient[b.clientId] = [];
    blocksByClient[b.clientId].push({ date: toLocalDateStr(b.date, tz), startTime: b.startTime, endTime: b.endTime });
  }

  // Booked sessions this week
  const [bookedSessions, approvedProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        OR: [
          { status: { in: ["SCHEDULED","IN_PROGRESS"] }, providerId: { in: providerIds } },
          { status: "CANCELLED", cancelledBy: "PROVIDER", providerId: { in: providerIds } },
          { status: "CANCELLED", cancelledBy: "CLIENT", clientId: { in: clientIds } },
        ],
        startTime: { gte: weekStart }, endTime: { lte: weekEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true, status: true, cancelledBy: true },
    }),
    prisma.proposedSession.findMany({
      where: { OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }], status: "APPROVED", startTime: { gte: weekStart }, endTime: { lte: weekEnd } },
      select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true },
    }),
  ]);

  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE" }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  for (const s of [...bookedSessions, ...approvedProposals]) {
    const dow = toLocalDayOfWeek(s.startTime, tz);
    const lst = toLocalTime(s.startTime, tz);
    const let_ = toLocalTime(s.endTime, tz);
    const cancelledBy = "cancelledBy" in s ? s.cancelledBy : null;
    if (cancelledBy !== "CLIENT" && s.providerId) {
      if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
      bookedByProvider[s.providerId].push({ dayOfWeek: dow, startTime: lst, endTime: let_, clientId: s.clientId ?? undefined, locationType: s.locationType ?? undefined });
    }
    if (s.clientId && cancelledBy !== "PROVIDER") {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek: dow, startTime: lst, endTime: let_ });
    }
  }

  // Provider weekly hours already in DB (LogicGap 3 fix uses this; baseline uses 0)
  const providerWeeklyHoursMap: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (s.status === "CANCELLED") continue;
    if (!s.providerId) continue;
    providerWeeklyHoursMap[s.providerId] = (providerWeeklyHoursMap[s.providerId] ?? 0)
      + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }

  // ── Build BASELINE clients ──────────────────────────────────────────────────
  // Current logic: no sessionHours cap, counts weekend availDays, 4wk history, weeklyHours=0

  function buildClients(
    opts: {
      histMap: Record<string, string[]>;
      capSessionHours: boolean;       // Bug 1
      filterSchedulableDays: boolean; // Bug 2
      weeklyHoursFromDB: boolean;     // LogicGap 3 (affects providers, not clients — just for clarity)
    }
  ): SchedulerClient[] {
    return rawClients.map((c) => {
      const auth = clientAuthMap[c.id];
      const weeklyHours = auth?.weeklyHours ?? null;
      const used = auth ? (usedHoursMap[auth.authId] ?? 0) : 0;
      const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;

      const availDaysRaw = c.availability.map((a) => a.dayOfWeek);
      const availDaysFiltered = opts.filterSchedulableDays
        ? availDaysRaw.filter((d) => SCHEDULABLE_DAYS.has(d))
        : availDaysRaw;
      const availDays = new Set(availDaysFiltered).size;

      const daysNeeded = (() => {
        if (remaining === null || remaining <= 0) return 1;
        const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
        return Math.max(1, Math.min(raw, availDays));
      })();

      const sessionHours = (() => {
        if (remaining === null || remaining <= 0) return c.defaultSessionHours ?? center!.defaultSessionHours;
        const rawPerDay = remaining / daysNeeded;
        const snapped = Math.round(rawPerDay * 2) / 2;
        const floored = Math.max(snapped, MIN_SESSION_HOURS);
        return opts.capSessionHours ? Math.min(floored, MAX_SESSION_HOURS) : floored;
      })();

      return {
        id: c.id, firstName: c.firstName, lastName: c.lastName,
        latitude: c.latitude, longitude: c.longitude,
        sessionHours, daysNeeded,
        minimumRbtLevel: c.minimumRbtLevel,
        femaleProviderOnly: c.femaleProviderOnly,
        spanish: c.spanish,
        availability: c.availability.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
        authorizationId: auth?.authId ?? null,
        approvedWeeklyHours: auth?.weeklyHours ?? 0,
        usedHoursThisWeek: used,
        authorizationEndDate: auth?.endDate ? toLocalDateStr(auth.endDate, tz) : null,
        approvedProviderIds: c.approvedHomeProviders.map((ah) => ah.providerId),
        bookedWindows: bookedByClient[c.id] ?? [],
        blocks: blocksByClient[c.id] ?? [],
        historicalProviderIds: opts.histMap[c.id] ?? [],
        hasPriorWeekHistory: (opts.histMap[c.id] ?? []).length > 0,
        preferredLocation: c.preferredLocation,
        preferredSlots: c.preferredSlots.map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime })),
      };
    });
  }

  function buildProviders(weeklyHoursFromDB: boolean): SchedulerProvider[] {
    return rawProviders.map((p) => ({
      id: p.id, firstName: p.firstName, lastName: p.lastName,
      position: p.position as "BCBA" | "BCaBA" | "RBT",
      rbtLevel: p.rbtLevel, gender: p.gender, spanish: p.spanish,
      latitude: p.latitude, longitude: p.longitude,
      availability: p.availability.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      bookedWindows: bookedByProvider[p.id] ?? [],
      blocks: blocksByProvider[p.id] ?? [],
      weeklyHoursAlreadyScheduled: weeklyHoursFromDB ? (providerWeeklyHoursMap[p.id] ?? 0) : 0,
    }));
  }

  const baselineClients  = buildClients({ histMap: hist4wk,  capSessionHours: false, filterSchedulableDays: false, weeklyHoursFromDB: false });
  const proposedClients  = buildClients({ histMap: hist12wk, capSessionHours: true,  filterSchedulableDays: true,  weeklyHoursFromDB: true  });
  const baselineProviders = buildProviders(false);
  const proposedProviders = buildProviders(true);

  const baselineInput: SchedulerInput = {
    weekOf, targetDate: mondayDate, timezone: tz, centerId: null,
    clients: baselineClients, providers: baselineProviders,
    sessionTypeIds: { CENTER: sessionType.id, HOME: sessionType.id, SCHOOL: sessionType.id, DAYCARE: sessionType.id },
    driveTimeSessionTypeId: null, driveMinutes: {}, distanceMeters: {},
    weekMode: true,
  };
  const proposedInput: SchedulerInput = {
    ...baselineInput, clients: proposedClients, providers: proposedProviders,
  };

  // ── Run both optimizers ─────────────────────────────────────────────────────
  console.log(`Running BASELINE optimizer...`);
  const wsBaseline = createWorkingState();
  const baseline = optimize(baselineInput, wsBaseline);

  console.log(`Running PROPOSED optimizer (Bug3 + LogicGap1 active)...`);
  const wsProposed = createWorkingState();
  const proposed = optimizeProposed(proposedInput, wsProposed);

  console.log(`Done.\n`);

  // ─── Compute metrics ───────────────────────────────────────────────────────
  const MAX_SCHED = 5 * MAX_SESSION_HOURS; // 30h cap for coverage denominator

  interface ClientMetrics {
    name: string;
    auth: number;
    baseHours: number; baseDays: number; baseCoverage: number; baseProvider: string;
    propHours: number; propDays: number; propCoverage: number; propProvider: string;
    baseSessionHours: number; propSessionHours: number;
    baseDaysNeeded: number; propDaysNeeded: number;
    prefSlots: number;
    basePrefHit: number; propPrefHit: number;
  }

  const clientMetrics: ClientMetrics[] = [];

  const providerMap = new Map(rawProviders.map((p) => [p.id, `${p.lastName}, ${p.firstName}`]));

  for (const c of baselineClients) {
    const bc = baselineClients.find((x) => x.id === c.id)!;
    const pc = proposedClients.find((x) => x.id === c.id)!;

    const bProps = baseline.proposals.filter((p) => p.clientId === c.id);
    const pProps = proposed.proposals.filter((p) => p.clientId === c.id);

    const bHours = bProps.reduce((s, p) => s + (parseHHMM(p.endTime) - parseHHMM(p.startTime)) / 60, 0);
    const pHours = pProps.reduce((s, p) => s + (parseHHMM(p.endTime) - parseHHMM(p.startTime)) / 60, 0);

    const auth = bc.approvedWeeklyHours;
    const denom = Math.min(auth, MAX_SCHED);
    const bCov = denom > 0 ? Math.round((bHours / denom) * 100) : 0;
    const pCov = denom > 0 ? Math.round((pHours / denom) * 100) : 0;

    const bProviderIds = [...new Set(bProps.map((p) => p.providerId))];
    const pProviderIds = [...new Set(pProps.map((p) => p.providerId))];

    // Preferred slot adherence: how many proposals land on a preferred slot
    const prefSlots = bc.preferredSlots ?? [];
    const countPref = (props: typeof bProps) =>
      props.filter((p) =>
        prefSlots.some((ps) => ps.dayOfWeek === p.dayOfWeek &&
          parseHHMM(ps.startTime) === parseHHMM(p.startTime))
      ).length;

    clientMetrics.push({
      name: `${c.lastName}, ${c.firstName}`,
      auth,
      baseHours: bHours, baseDays: bProps.length, baseCoverage: bCov,
      baseProvider: bProviderIds.map((id) => providerMap.get(id) ?? id.slice(-6)).join(" + "),
      propHours: pHours, propDays: pProps.length, propCoverage: pCov,
      propProvider: pProviderIds.map((id) => providerMap.get(id) ?? id.slice(-6)).join(" + "),
      baseSessionHours: bc.sessionHours, propSessionHours: pc.sessionHours,
      baseDaysNeeded: bc.daysNeeded, propDaysNeeded: pc.daysNeeded,
      prefSlots: prefSlots.length,
      basePrefHit: countPref(bProps), propPrefHit: countPref(pProps),
    });
  }

  // ─── SECTION 1: Input parameter changes (Bugs 1, 2, LogicGap 2) ───────────
  console.log(`SECTION 1 — INPUT PARAMETER CHANGES (Bug1: sessionHours cap, Bug2: weekend days, LogicGap2: 12wk history)`);
  console.log(`${"─".repeat(70)}`);

  const changedInputs = clientMetrics.filter(
    (m) => m.baseSessionHours !== m.propSessionHours || m.baseDaysNeeded !== m.propDaysNeeded
  );

  if (changedInputs.length === 0) {
    console.log(`  No clients affected by input parameter changes (no weekend availability, no over-cap session hours).`);
  } else {
    console.log(`  Client                    Auth   Baseline          Proposed`);
    console.log(`  ${"─".repeat(65)}`);
    for (const m of changedInputs) {
      const bLabel = `${m.baseSessionHours}h × ${m.baseDaysNeeded}d`;
      const pLabel = `${m.propSessionHours}h × ${m.propDaysNeeded}d`;
      console.log(`  ${m.name.padEnd(26)} ${String(m.auth + "h").padEnd(6)} ${bLabel.padEnd(18)} ${pLabel}`);
    }
  }

  // Historical lookback delta
  const histChange = rawClients.filter((c) => {
    const h4 = hist4wk[c.id]?.length ?? 0;
    const h12 = hist12wk[c.id]?.length ?? 0;
    return h12 > h4;
  });
  console.log(`\n  Historical lookback: ${histChange.length} client(s) gained provider history with 12-week window:`);
  for (const c of histChange) {
    const h4 = hist4wk[c.id]?.length ?? 0;
    const h12 = hist12wk[c.id]?.length ?? 0;
    console.log(`    ${c.lastName}, ${c.firstName}: ${h4} provider(s) → ${h12} provider(s) in history`);
  }

  // LogicGap 3: weeklyHoursAlreadyScheduled
  const providersWithDBHours = rawProviders.filter((p) => (providerWeeklyHoursMap[p.id] ?? 0) > 0);
  console.log(`\n  WeeklyHoursAlreadyScheduled (LogicGap3): ${providersWithDBHours.length} provider(s) had DB hours set to 0 in baseline:`);
  for (const p of providersWithDBHours) {
    console.log(`    ${p.lastName}, ${p.firstName}: 0h → ${(providerWeeklyHoursMap[p.id] ?? 0).toFixed(1)}h`);
  }

  // ─── SECTION 2: Client coverage comparison ─────────────────────────────────
  console.log(`\nSECTION 2 — CLIENT COVERAGE`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  ${"Client".padEnd(22)} ${"Auth".padEnd(6)} ${"Baseline".padEnd(20)} ${"Proposed".padEnd(20)} ${"Delta"}`);
  console.log(`  ${"─".repeat(67)}`);

  let baseFullyCovered = 0, propFullyCovered = 0;
  let baseTotalHours = 0, propTotalHours = 0;

  for (const m of clientMetrics.sort((a, b) => a.name.localeCompare(b.name))) {
    const bLabel = `${m.baseHours.toFixed(1)}h (${m.baseCoverage}%)`;
    const pLabel = `${m.propHours.toFixed(1)}h (${m.propCoverage}%)`;
    const hoursDelta = m.propHours - m.baseHours;
    const deltaStr = hoursDelta === 0 ? "—" : (hoursDelta > 0 ? `+${hoursDelta.toFixed(1)}h` : `${hoursDelta.toFixed(1)}h`);
    const flag = m.baseCoverage >= 90 && m.propCoverage < 90 ? " ⬇" : m.propCoverage >= 90 && m.baseCoverage < 90 ? " ⬆" : "";
    console.log(`  ${m.name.padEnd(22)} ${String(m.auth + "h").padEnd(6)} ${bLabel.padEnd(20)} ${pLabel.padEnd(20)} ${deltaStr}${flag}`);
    if (m.baseCoverage >= 90) baseFullyCovered++;
    if (m.propCoverage >= 90) propFullyCovered++;
    baseTotalHours += m.baseHours;
    propTotalHours += m.propHours;
  }

  console.log(`  ${"─".repeat(67)}`);
  const totalDelta = propTotalHours - baseTotalHours;
  console.log(`  ${"TOTAL".padEnd(22)} ${"".padEnd(6)} ${baseTotalHours.toFixed(1)}h (${baseFullyCovered}/${clientMetrics.length} ≥90%)`.padEnd(42) + `${propTotalHours.toFixed(1)}h (${propFullyCovered}/${clientMetrics.length} ≥90%)`.padEnd(20) + `${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)}h`);

  // ─── SECTION 3: Provider assignments changed ───────────────────────────────
  console.log(`\nSECTION 3 — PROVIDER ASSIGNMENTS CHANGED`);
  console.log(`${"─".repeat(70)}`);

  const providerChanged = clientMetrics.filter(
    (m) => m.baseProvider !== m.propProvider && (m.baseDays > 0 || m.propDays > 0)
  );
  if (providerChanged.length === 0) {
    console.log(`  No provider assignment changes.`);
  } else {
    for (const m of providerChanged) {
      console.log(`  ${m.name}`);
      console.log(`    Baseline: ${m.baseProvider || "— none —"}`);
      console.log(`    Proposed: ${m.propProvider || "— none —"}`);
    }
  }

  // ─── SECTION 4: Preferred slot adherence ──────────────────────────────────
  console.log(`\nSECTION 4 — PREFERRED SLOT ADHERENCE (LogicGap1 effect)`);
  console.log(`${"─".repeat(70)}`);

  const withPref = clientMetrics.filter((m) => m.prefSlots > 0);
  if (withPref.length === 0) {
    console.log(`  No clients have preferred slots configured.`);
  } else {
    console.log(`  ${"Client".padEnd(22)} ${"Pref slots".padEnd(12)} ${"Baseline hits".padEnd(16)} ${"Proposed hits".padEnd(16)} ${"Delta"}`);
    console.log(`  ${"─".repeat(67)}`);
    let baseTotalHits = 0, propTotalHits = 0, totalSessions = 0;
    for (const m of withPref) {
      const bRate = m.baseDays > 0 ? Math.round((m.basePrefHit / m.baseDays) * 100) : 0;
      const pRate = m.propDays > 0 ? Math.round((m.propPrefHit / m.propDays) * 100) : 0;
      const delta = pRate - bRate;
      const deltaStr = delta === 0 ? "—" : (delta > 0 ? `+${delta}pp` : `${delta}pp`);
      console.log(`  ${m.name.padEnd(22)} ${String(m.prefSlots).padEnd(12)} ${`${m.basePrefHit}/${m.baseDays} (${bRate}%)`.padEnd(16)} ${`${m.propPrefHit}/${m.propDays} (${pRate}%)`.padEnd(16)} ${deltaStr}`);
      baseTotalHits += m.basePrefHit; propTotalHits += m.propPrefHit;
      totalSessions += Math.max(m.baseDays, m.propDays);
    }
    console.log(`  ${"─".repeat(67)}`);
    const bOverall = totalSessions > 0 ? Math.round((baseTotalHits / totalSessions) * 100) : 0;
    const pOverall = totalSessions > 0 ? Math.round((propTotalHits / totalSessions) * 100) : 0;
    console.log(`  ${"TOTAL".padEnd(22)} ${"".padEnd(12)} ${`${baseTotalHits} hits (${bOverall}%)`.padEnd(16)} ${`${propTotalHits} hits (${pOverall}%)`.padEnd(16)} ${pOverall - bOverall >= 0 ? "+" : ""}${pOverall - bOverall}pp`);
  }

  // ─── SECTION 5: Provider day-fill comparison ──────────────────────────────
  console.log(`\nSECTION 5 — RBT DAY-FILL RATE`);
  console.log(`${"─".repeat(70)}`);

  const DAYS: DayOfWeek[] = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];

  interface RbtFill { name: string; bSched: number; pSched: number; avail: number; }
  const rbtFills: RbtFill[] = [];
  let bTotalSched = 0, pTotalSched = 0, totalAvail = 0;

  for (const p of rawProviders) {
    if (p.position !== "RBT") continue;

    const bProposals = baseline.proposals.filter((pr) => pr.providerId === p.id);
    const pProposals = proposed.proposals.filter((pr) => pr.providerId === p.id);

    const workingDays = new Set([...bProposals.map((pr) => pr.dayOfWeek), ...pProposals.map((pr) => pr.dayOfWeek)]);
    const availMins = p.availability.filter((a) => DAYS.includes(a.dayOfWeek) && workingDays.has(a.dayOfWeek))
      .reduce((s, a) => s + parseHHMM(a.endTime) - parseHHMM(a.startTime), 0);
    if (availMins === 0) continue;

    const bSchedMins = bProposals.reduce((s, pr) => s + parseHHMM(pr.endTime) - parseHHMM(pr.startTime), 0);
    const pSchedMins = pProposals.reduce((s, pr) => s + parseHHMM(pr.endTime) - parseHHMM(pr.startTime), 0);

    rbtFills.push({ name: `${p.lastName}, ${p.firstName}`, bSched: bSchedMins, pSched: pSchedMins, avail: availMins });
    bTotalSched += bSchedMins; pTotalSched += pSchedMins; totalAvail += availMins;
  }

  console.log(`  ${"Provider".padEnd(22)} ${"Avail".padEnd(8)} ${"Baseline".padEnd(18)} ${"Proposed".padEnd(18)} ${"Delta"}`);
  console.log(`  ${"─".repeat(67)}`);
  for (const r of rbtFills) {
    const bFill = Math.round((r.bSched / r.avail) * 100);
    const pFill = Math.round((r.pSched / r.avail) * 100);
    const delta = pFill - bFill;
    const bLabel = `${(r.bSched/60).toFixed(1)}h (${bFill}%)`;
    const pLabel = `${(r.pSched/60).toFixed(1)}h (${pFill}%)`;
    const dStr = delta === 0 ? "—" : (delta > 0 ? `+${delta}pp` : `${delta}pp`);
    console.log(`  ${r.name.padEnd(22)} ${((r.avail/60).toFixed(1)+"h").padEnd(8)} ${bLabel.padEnd(18)} ${pLabel.padEnd(18)} ${dStr}`);
  }
  console.log(`  ${"─".repeat(67)}`);
  const bFillTotal = totalAvail > 0 ? Math.round((bTotalSched / totalAvail) * 100) : 0;
  const pFillTotal = totalAvail > 0 ? Math.round((pTotalSched / totalAvail) * 100) : 0;
  console.log(`  ${"OVERALL".padEnd(22)} ${"".padEnd(8)} ${`${(bTotalSched/60).toFixed(1)}h (${bFillTotal}%)`.padEnd(18)} ${`${(pTotalSched/60).toFixed(1)}h (${pFillTotal}%)`.padEnd(18)} ${pFillTotal - bFillTotal >= 0 ? "+" : ""}${pFillTotal - bFillTotal}pp`);

  // ─── SECTION 6: Provider consistency (historical match) ────────────────────
  console.log(`\nSECTION 6 — PROVIDER CONSISTENCY (historical match rate)`);
  console.log(`${"─".repeat(70)}`);

  const bConsist = baseline.proposals.filter((p) => {
    const c = baselineClients.find((c2) => c2.id === p.clientId);
    return c && c.historicalProviderIds.includes(p.providerId);
  }).length;
  const pConsist = proposed.proposals.filter((p) => {
    const c = proposedClients.find((c2) => c2.id === p.clientId);
    return c && c.historicalProviderIds.includes(p.providerId);
  }).length;

  const bConsistPct = baseline.proposals.length > 0 ? Math.round((bConsist / baseline.proposals.length) * 100) : 0;
  const pConsistPct = proposed.proposals.length > 0 ? Math.round((pConsist / proposed.proposals.length) * 100) : 0;

  console.log(`  Baseline:  ${bConsist}/${baseline.proposals.length} proposals match historical provider (${bConsistPct}%)`);
  console.log(`  Proposed:  ${pConsist}/${proposed.proposals.length} proposals match historical provider (${pConsistPct}%)`);
  console.log(`  Delta:     ${pConsistPct - bConsistPct >= 0 ? "+" : ""}${pConsistPct - bConsistPct}pp`);

  // ─── SECTION 7: Score comparison ──────────────────────────────────────────
  console.log(`\nSECTION 7 — ESTIMATED AUDIT SCORE`);
  console.log(`${"─".repeat(70)}`);

  function computeScore(nProposals: number, consistHits: number, scheduledHours: number,
    fullyCovered: number, totalClients: number, schedMins: number, availMins: number) {
    const compliance = 100;
    const dayFill = availMins > 0 ? Math.round((schedMins / availMins) * 100) : 0;
    const coverage = totalClients > 0 ? Math.round((fullyCovered / totalClients) * 100) : 0;
    const consistency = nProposals > 0 ? Math.round((consistHits / nProposals) * 100) : 100;
    const travel = 100;
    const score = Math.round(compliance * 0.30 + dayFill * 0.30 + coverage * 0.25 + consistency * 0.10 + travel * 0.05);
    return { score, dayFill, coverage, consistency };
  }

  const bFC = clientMetrics.filter((m) => m.baseCoverage >= 90).length;
  const pFC = clientMetrics.filter((m) => m.propCoverage >= 90).length;

  const bScore = computeScore(baseline.proposals.length, bConsist, baseTotalHours, bFC, clientMetrics.length, bTotalSched, totalAvail);
  const pScore = computeScore(proposed.proposals.length, pConsist, propTotalHours, pFC, clientMetrics.length, pFillTotal, totalAvail);
  // pFillTotal already computed above as percentage — adjust for computeScore
  const bScoreCalc = computeScore(baseline.proposals.length, bConsist, baseTotalHours, bFC, clientMetrics.length, bTotalSched, totalAvail);
  const pScoreCalc = computeScore(proposed.proposals.length, pConsist, propTotalHours, pFC, clientMetrics.length, pTotalSched, totalAvail);

  console.log(`  ${"Metric".padEnd(26)} ${"Baseline".padEnd(16)} ${"Proposed".padEnd(16)} Delta`);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  ${"Day-fill Rate".padEnd(26)} ${String(bScoreCalc.dayFill + "%").padEnd(16)} ${String(pScoreCalc.dayFill + "%").padEnd(16)} ${pScoreCalc.dayFill - bScoreCalc.dayFill >= 0 ? "+" : ""}${pScoreCalc.dayFill - bScoreCalc.dayFill}pp`);
  console.log(`  ${"Client Coverage (≥90%)".padEnd(26)} ${String(bFC + "/" + clientMetrics.length).padEnd(16)} ${String(pFC + "/" + clientMetrics.length).padEnd(16)} ${pFC - bFC >= 0 ? "+" : ""}${pFC - bFC} clients`);
  console.log(`  ${"Provider Consistency".padEnd(26)} ${String(bScoreCalc.consistency + "%").padEnd(16)} ${String(pScoreCalc.consistency + "%").padEnd(16)} ${pScoreCalc.consistency - bScoreCalc.consistency >= 0 ? "+" : ""}${pScoreCalc.consistency - bScoreCalc.consistency}pp`);
  console.log(`  ${"─".repeat(60)}`);
  const rating = (s: number) => s >= 90 ? "Excellent" : s >= 75 ? "Good" : s >= 60 ? "Fair" : "Poor";
  console.log(`  ${"AUDIT SCORE (est.)".padEnd(26)} ${String(bScoreCalc.score + "/100").padEnd(16)} ${String(pScoreCalc.score + "/100").padEnd(16)} ${pScoreCalc.score - bScoreCalc.score >= 0 ? "+" : ""}${pScoreCalc.score - bScoreCalc.score} pts`);
  console.log(`  ${" ".padEnd(26)} ${rating(bScoreCalc.score).padEnd(16)} ${rating(pScoreCalc.score)}`);

  console.log(`\n${"═".repeat(70)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
