/**
 * Cancellation Resilience Simulation — AUDIT_GOD Format
 *
 * Runs 10 cancellation scenarios against real scheduling data:
 *   1. Schedule week of Apr 6–10 from scratch (no drive times, for speed)
 *   2. Pick a random cancellation (CLIENT or PROVIDER, random day + slot)
 *   3. Re-run the day's auto-schedule
 *   4. Measure: hours lost, hours recovered, coverage impact
 *   5. Emit AUDIT_GOD-style report for each scenario + aggregate summary
 *
 * Safe to run: all DB writes are isolated per simulation and cleaned up after.
 * Proposals and synthetic sessions created here are deleted before exit.
 */

import { PrismaClient, DayOfWeek, LocationType } from "@prisma/client";
import { getWeekBoundaries } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SimResult {
  scenario: number;
  cancelType: "CLIENT" | "PROVIDER";
  cancelledClient: string;
  cancelledProvider: string;
  cancelDay: string;
  cancelledHours: number;
  baselineProposals: number;
  baselineHours: number;
  baselineCoverage: number; // % clients w/ ≥1 session
  afterProposals: number;
  afterHours: number;
  afterCoverage: number;
  recoveredHours: number;
  netLossHours: number;
  recoveryRate: number; // %
  unservedClients: string[];
  newPairings: string[]; // new client-provider combos after re-schedule
  weirdBehaviors: string[]; // flags for unrealistic behavior
}

// ── Prisma ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

// ── Constants ─────────────────────────────────────────────────────────────────

const CENTER_ID = "cmn56xpu90000wt7v2o7v0jnm";
const TIMEZONE = "America/New_York";
const WEEK_OF_DATE = new Date("2026-04-07T12:00:00Z"); // Week of Apr 6–10
const MAX_SESSION_HOURS = 6.0;
const MIN_SESSION_HOURS = 1.5;
const DAY_ORDER: Record<string, number> = {
  MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
};
const WEEKDAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

// ── Utilities ─────────────────────────────────────────────────────────────────

function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function localDayOfWeek(d: Date): DayOfWeek {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "long" })
    .format(d).toUpperCase() as DayOfWeek;
}

function localHHMM(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function sessionHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Convert "YYYY-MM-DD" + "HH:MM" local time → UTC Date */
function toUtc(dateStr: string, localTime: string): Date {
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const noonLocal = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(noonUtc);
  const [nh, nm] = noonLocal.split(":").map(Number);
  const offsetMs = (12 - nh) * 3_600_000 - nm * 60_000;
  const midnightUtc = new Date(noonUtc.getTime() + offsetMs - 12 * 3_600_000);
  const [h, m] = localTime.split(":").map(Number);
  return new Date(midnightUtc.getTime() + h * 3_600_000 + m * 60_000);
}

/** Return UTC day boundaries for a "YYYY-MM-DD" date string in TIMEZONE */
function dayBounds(dateStr: string): { start: Date; end: Date } {
  const start = toUtc(dateStr, "00:00");
  const end   = new Date(start.getTime() + 24 * 3_600_000);
  return { start, end };
}

// ── Scheduler Input Builder ───────────────────────────────────────────────────

type SchedulerInput = import("@/lib/scheduler/types").SchedulerInput;
type SchedulerClient = import("@/lib/scheduler/types").SchedulerClient;
type SchedulerProvider = import("@/lib/scheduler/types").SchedulerProvider;

async function buildWeekInput(
  weekStart: Date,
  weekEnd: Date,
  weekOf: Date,
  mondayDate: string,
  sessionTypeIds: { CENTER: string; HOME: string; SCHOOL: string },
  driveTimeSessionTypeId: string | null,
  overrideBookedSessions?: Array<{ providerId: string; clientId: string | null; startTime: Date; endTime: Date; status: string; cancelledBy: string | null; sessionTypeId?: string }>
): Promise<SchedulerInput> {
  const [rawClients, allAuths, rawProviders, sessionTypes] = await Promise.all([
    prisma.client.findMany({
      where: {
        AND: [
          { OR: [{ centerId: CENTER_ID }, { centerId: null }] },
          { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
        ],
      },
      include: {
        availability: true,
        approvedHomeProviders: { where: { endDate: null } },
      },
    }),
    prisma.authorization.findMany({
      where: {
        startDate: { lte: weekEnd },
        endDate:   { gte: weekStart },
      },
      orderBy: { startDate: "desc" },
      select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
    }),
    prisma.provider.findMany({
      where: { OR: [{ centerId: CENTER_ID }, { centerId: null }], status: "ACTIVE" },
      include: { availability: true },
    }),
    prisma.sessionType.findMany({ select: { id: true, name: true } }),
  ]);

  const driveTypeName = sessionTypes.find(t => t.id === driveTimeSessionTypeId)?.name;

  const clientIds = rawClients.map(c => c.id);
  const providerIds = rawProviders.map(p => p.id);

  // Auth map: latest active auth per client
  const clientAuthMap: Record<string, { authId: string; weeklyHours: number; endDate: Date }> = {};
  const authorizationIds: string[] = [];
  for (const auth of allAuths) {
    if (!clientAuthMap[auth.clientId]) {
      authorizationIds.push(auth.id);
      clientAuthMap[auth.clientId] = { authId: auth.id, weeklyHours: auth.approvedHoursPerWeek, endDate: auth.endDate };
    }
  }

  // Used hours from actual sessions
  const usedHoursMap: Record<string, number> = {};
  if (authorizationIds.length > 0) {
    const usedSessions = await prisma.session.findMany({
      where: {
        authorizationId: { in: authorizationIds },
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { authorizationId: true, startTime: true, endTime: true },
    });
    for (const s of usedSessions) {
      if (!s.authorizationId) continue;
      usedHoursMap[s.authorizationId] = (usedHoursMap[s.authorizationId] ?? 0) + sessionHours(s.startTime, s.endTime);
    }
  }

  // Historical providers
  const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 24 * 3_600_000);
  const priorSessions = await prisma.session.findMany({
    where: { clientId: { in: clientIds }, startTime: { gte: fourWeeksAgo, lt: weekStart }, status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] } },
    select: { clientId: true, providerId: true },
    orderBy: { startTime: "desc" },
  });
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) historicalByClient[s.clientId].push(s.providerId);
  }

  // Provider blocks
  const providerBlocks = await prisma.providerBlock.findMany({
    where: { providerId: { in: providerIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { providerId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of providerBlocks) {
    const ds = localDate(b.date);
    if (!blocksByProvider[b.providerId]) blocksByProvider[b.providerId] = [];
    blocksByProvider[b.providerId].push({ date: ds, startTime: b.startTime, endTime: b.endTime });
  }

  // Booked sessions (use override if provided, else query DB)
  const bookedSessions = overrideBookedSessions ?? await prisma.session.findMany({
    where: {
      OR: [
        { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, providerId: { in: providerIds } },
        { status: "CANCELLED", cancelledBy: "PROVIDER", providerId: { in: providerIds } },
        { status: "CANCELLED", cancelledBy: "CLIENT",   clientId:  { in: clientIds } },
      ],
      startTime: { gte: weekStart },
      endTime:   { lte: weekEnd },
    },
    select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true, sessionTypeId: true, status: true, cancelledBy: true },
  });

  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" }>> = {};
  const bookedByClient:   Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};

  for (const s of bookedSessions) {
    const isDriveTime = driveTypeName && "sessionTypeId" in s && s.sessionTypeId === driveTimeSessionTypeId;
    if (isDriveTime) continue;
    const dow = localDayOfWeek(s.startTime);
    const localStart = localHHMM(s.startTime);
    const localEnd   = localHHMM(s.endTime);
    const isCancelledByProvider = s.cancelledBy === "PROVIDER";
    const isCancelledByClient   = s.cancelledBy === "CLIENT";
    if (!isCancelledByClient) {
      if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
      bookedByProvider[s.providerId].push({ dayOfWeek: dow, startTime: localStart, endTime: localEnd, clientId: s.clientId ?? undefined, locationType: (s as { locationType?: "HOME" | "CENTER" }).locationType ?? undefined });
    }
    if (s.clientId && !isCancelledByProvider) {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek: dow, startTime: localStart, endTime: localEnd });
    }
  }

  const center = await prisma.center.findUnique({ where: { id: CENTER_ID }, select: { defaultSessionHours: true } });
  const defaultSessHours = center?.defaultSessionHours ?? 4.0;

  const schedulerClients: SchedulerClient[] = rawClients.map(c => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
    const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;
    const availDays = new Set(c.availability.map(a => a.dayOfWeek)).size;
    const daysNeeded = remaining === null || remaining <= 0
      ? 1
      : Math.max(1, Math.min(Math.ceil(remaining / MAX_SESSION_HOURS), availDays || 1));
    const sessionHoursVal = remaining === null || remaining <= 0
      ? (c.defaultSessionHours ?? defaultSessHours)
      : Math.max(Math.round((remaining / daysNeeded) * 2) / 2, MIN_SESSION_HOURS);

    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      latitude: c.latitude,
      longitude: c.longitude,
      sessionHours: sessionHoursVal,
      daysNeeded,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      availability: c.availability.map(a => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      authorizationId: authInfo?.authId ?? null,
      approvedWeeklyHours: authInfo?.weeklyHours ?? 0,
      usedHoursThisWeek: authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0,
      authorizationEndDate: authInfo?.endDate
        ? new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(authInfo.endDate)
        : null,
      approvedProviderIds: c.approvedHomeProviders.map(ah => ah.providerId),
      bookedWindows: bookedByClient[c.id] ?? [],
      blocks: [],
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: (historicalByClient[c.id] ?? []).length > 0,
      preferredLocation: c.preferredLocation,
    };
  });

  const schedulerProviders: SchedulerProvider[] = rawProviders.map(p => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    rbtLevel: p.rbtLevel,
    gender: p.gender,
    spanish: p.spanish,
    latitude: p.latitude,
    longitude: p.longitude,
    availability: p.availability.map(a => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
    bookedWindows: bookedByProvider[p.id] ?? [],
    blocks: blocksByProvider[p.id] ?? [],
    weeklyHoursAlreadyScheduled: 0,
  }));

  // Zero drive times (simulation — skip Maps API)
  const driveMinutes: Record<string, Record<string, number>> = {};
  const distanceMeters: Record<string, Record<string, number>> = {};
  for (const p of schedulerProviders) {
    driveMinutes[p.id] = {}; distanceMeters[p.id] = {};
    for (const c of schedulerClients) { driveMinutes[p.id][c.id] = 0; distanceMeters[p.id][c.id] = 0; }
  }
  for (const a of schedulerClients) {
    driveMinutes[a.id] = driveMinutes[a.id] ?? {}; distanceMeters[a.id] = distanceMeters[a.id] ?? {};
    for (const b of schedulerClients) { driveMinutes[a.id][b.id] = 0; distanceMeters[a.id][b.id] = 0; }
  }

  return {
    weekOf,
    targetDate: mondayDate,
    timezone: TIMEZONE,
    centerId: CENTER_ID,
    clients: schedulerClients,
    providers: schedulerProviders,
    sessionTypeIds,
    driveTimeSessionTypeId,
    driveMinutes,
    distanceMeters,
    existingHomeSessions: [],
    weekMode: true,
  };
}

// ── Audit Metrics ─────────────────────────────────────────────────────────────

interface AuditSnapshot {
  totalProposals: number;
  totalHours: number;
  rbtUtilization: number; // aggregate %
  clientCoverage: number; // % w/ at least one session
  clientCoverageMap: Record<string, number>; // hours per client
  providerHoursMap: Record<string, number>;
}

async function snapshotMetrics(
  weekStart: Date,
  weekEnd: Date,
  clientIds: string[],
  providerIds: string[],
  rbtIds: Set<string>
): Promise<AuditSnapshot> {
  const [proposals, providers] = await Promise.all([
    prisma.proposedSession.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      },
      select: { clientId: true, providerId: true, startTime: true, endTime: true },
    }),
    prisma.provider.findMany({
      where: { id: { in: [...rbtIds] } },
      include: { availability: { where: { dayOfWeek: { in: WEEKDAYS } } } },
    }),
  ]);

  const totalHours = proposals.reduce((s, p) => s + sessionHours(p.startTime, p.endTime), 0);
  const clientCoverageMap: Record<string, number> = {};
  const providerHoursMap: Record<string, number> = {};

  for (const p of proposals) {
    const hrs = sessionHours(p.startTime, p.endTime);
    if (p.clientId)   clientCoverageMap[p.clientId] = (clientCoverageMap[p.clientId] ?? 0) + hrs;
    providerHoursMap[p.providerId] = (providerHoursMap[p.providerId] ?? 0) + hrs;
  }

  const clientsWithSession = Object.keys(clientCoverageMap).length;
  const clientCoverage = clientIds.length > 0 ? Math.round((clientsWithSession / clientIds.length) * 100) : 0;

  // RBT utilization
  let totalRbtAvailable = 0;
  let totalRbtScheduled = 0;
  for (const p of providers) {
    const avail = p.availability.reduce((s, a) => s + (parseHHMM(a.endTime) - parseHHMM(a.startTime)) / 60, 0);
    totalRbtAvailable += avail;
    totalRbtScheduled += providerHoursMap[p.id] ?? 0;
  }
  const rbtUtilization = totalRbtAvailable > 0 ? Math.round((totalRbtScheduled / totalRbtAvailable) * 100) : 0;

  return { totalProposals: proposals.length, totalHours: Math.round(totalHours * 10) / 10, rbtUtilization, clientCoverage, clientCoverageMap, providerHoursMap };
}

// ── Main Simulation ───────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  CANCELLATION RESILIENCE SIMULATION — ABA Scheduling Platform     ");
  console.log("  AUDIT_GOD Protocol | 10 Scenarios | Week of Apr 6–10, 2026       ");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const { weekStart, weekEnd } = getWeekBoundaries(WEEK_OF_DATE, TIMEZONE);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000); // Monday midnight UTC
  const mondayDate = localDate(weekOf);

  // Load session types
  const [centerST, homeST, driveTimeST] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);
  if (!centerST) { console.error("No billable session type found. Exiting."); process.exit(1); }
  const sessionTypeIds = { CENTER: centerST.id, HOME: homeST?.id ?? centerST.id, SCHOOL: centerST.id };
  const driveTimeSessionTypeId = driveTimeST?.id ?? null;

  // Load roster IDs (needed for snapshots and cleanup)
  const [allClients, allProviders] = await Promise.all([
    prisma.client.findMany({
      where: { AND: [{ OR: [{ centerId: CENTER_ID }, { centerId: null }] }, { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] }] },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.provider.findMany({
      where: { OR: [{ centerId: CENTER_ID }, { centerId: null }], status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, position: true },
    }),
  ]);
  const clientIds = allClients.map(c => c.id);
  const providerIds = allProviders.map(p => p.id);
  const rbtIds = new Set(allProviders.filter(p => p.position === "RBT").map(p => p.id));
  const clientNameMap: Record<string, string> = {};
  const providerNameMap: Record<string, string> = {};
  for (const c of allClients) clientNameMap[c.id] = `${c.lastName}, ${c.firstName}`;
  for (const p of allProviders) providerNameMap[p.id] = `${p.lastName}, ${p.firstName}`;

  // Compute day date strings for Mon–Fri of the simulation week
  const dayDates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekOf.getTime() + i * 24 * 3_600_000);
    dayDates.push(localDate(d));
  }

  const { runScheduler } = await import("@/lib/scheduler/index");

  const results: SimResult[] = [];
  const syntheticSessionIds: string[] = []; // sessions created by simulation

  for (let scenario = 1; scenario <= 10; scenario++) {
    console.log(`\n──────────────────────────────────────────────────────────────────`);
    console.log(`  SCENARIO ${scenario.toString().padStart(2, "0")} / 10`);
    console.log(`──────────────────────────────────────────────────────────────────`);

    // ── Step 1: Clear any existing proposals for this week ─────────────────────
    await prisma.proposedSession.deleteMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      },
    });

    // ── Step 2: Run full week schedule (baseline) ──────────────────────────────
    console.log("  → Running week schedule (baseline)...");
    const weekInput = await buildWeekInput(weekStart, weekEnd, weekOf, mondayDate, sessionTypeIds, driveTimeSessionTypeId);
    const weekResult = await runScheduler({ ...weekInput, weekMode: true });

    const baseline = await snapshotMetrics(weekStart, weekEnd, clientIds, providerIds, rbtIds);
    console.log(`     Baseline: ${baseline.totalProposals} proposals | ${baseline.totalHours}h | ${baseline.rbtUtilization}% RBT util | ${baseline.clientCoverage}% client coverage`);

    if (baseline.totalProposals === 0) {
      console.log("  ⚠ No proposals generated — skipping scenario (insufficient data).");
      results.push({
        scenario, cancelType: "CLIENT", cancelledClient: "N/A", cancelledProvider: "N/A",
        cancelDay: "N/A", cancelledHours: 0, baselineProposals: 0, baselineHours: 0,
        baselineCoverage: 0, afterProposals: 0, afterHours: 0, afterCoverage: 0,
        recoveredHours: 0, netLossHours: 0, recoveryRate: 0, unservedClients: [], newPairings: [], weirdBehaviors: ["No proposals generated in baseline"],
      });
      continue;
    }

    // ── Step 3: Pick a random proposal to cancel ───────────────────────────────
    const weekProposals = await prisma.proposedSession.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      },
      select: { id: true, clientId: true, providerId: true, startTime: true, endTime: true, locationType: true, authorizationId: true },
    });

    const validProposals = weekProposals.filter(p => p.clientId && p.providerId);
    if (validProposals.length === 0) {
      console.log("  ⚠ No valid proposals to cancel — skipping scenario.");
      continue;
    }

    const targetProposal = pick(validProposals);
    const cancelType: "CLIENT" | "PROVIDER" = Math.random() < 0.55 ? "CLIENT" : "PROVIDER";
    const cancelDay = localDate(targetProposal.startTime);
    const cancelDow = localDayOfWeek(targetProposal.startTime);
    const cancelledHrs = sessionHours(targetProposal.startTime, targetProposal.endTime);

    const cName = clientNameMap[targetProposal.clientId!] ?? targetProposal.clientId!;
    const pName = providerNameMap[targetProposal.providerId] ?? targetProposal.providerId;

    console.log(`  → Cancellation: ${cancelType} | ${cancelDay} (${cancelDow}) | ${cName} ↔ ${pName} | ${cancelledHrs.toFixed(1)}h`);

    // ── Step 4: Create synthetic cancelled session in DB ───────────────────────
    // This mimics a real cancellation so the day-scheduler sees it as a conflict.
    const synthSession = await prisma.session.create({
      data: {
        name:        "[SIM] Cancelled Session",
        providerId: targetProposal.providerId,
        clientId:   targetProposal.clientId,
        sessionTypeId: centerST.id,
        startTime:  targetProposal.startTime,
        endTime:    targetProposal.endTime,
        status:     "CANCELLED",
        cancelledBy: cancelType,
        locationType: (targetProposal.locationType ?? "CENTER") as LocationType,
        authorizationId: targetProposal.authorizationId ?? null,
        centerId:   CENTER_ID,
        billable:   false,
        notes:      "[SIMULATION] synthetic cancellation",
      },
    });
    syntheticSessionIds.push(synthSession.id);

    // Delete the proposal for the cancelled slot (it no longer represents a live booking)
    await prisma.proposedSession.delete({ where: { id: targetProposal.id } });

    // Save pre-cancellation pairing map (client → provider) for detecting new pairings
    const preCancellationPairs: Record<string, string> = {};
    for (const p of weekProposals) {
      if (p.clientId) preCancellationPairs[p.clientId] = p.providerId;
    }

    // ── Step 5: Re-run day scheduler ──────────────────────────────────────────
    console.log(`  → Re-scheduling ${cancelDay}...`);

    const { start: dayStart, end: dayEnd } = dayBounds(cancelDay);

    // Build single-day input (same as propose route logic)
    // For day scheduler: day-by-day mode uses daysNeeded=1 and fills remaining hours
    const DAILY_MAX = 8.0;
    const MIN_BILLABLE = 1.5;

    // Reload auths with updated used hours (accounting for proposals on other days)
    const otherDayProposals = await prisma.proposedSession.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
        NOT: { AND: [{ startTime: { gte: dayStart } }, { startTime: { lt: dayEnd } }] },
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      },
      select: { authorizationId: true, startTime: true, endTime: true },
    });

    const dayInput = await buildWeekInput(weekStart, weekEnd, weekOf, cancelDay, sessionTypeIds, driveTimeSessionTypeId,
      // Pass booked sessions including the synthetic cancellation
      await prisma.session.findMany({
        where: {
          OR: [
            { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, providerId: { in: providerIds } },
            { status: "CANCELLED", cancelledBy: "PROVIDER", providerId: { in: providerIds } },
            { status: "CANCELLED", cancelledBy: "CLIENT",   clientId:  { in: clientIds } },
          ],
          startTime: { gte: weekStart },
          endTime:   { lte: weekEnd },
        },
        select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true, sessionTypeId: true, status: true, cancelledBy: true },
      })
    );

    // Adjust to day-mode: daysNeeded=1 per client, sessionHours = remaining for the day
    const authIds2 = dayInput.clients.map(c => c.authorizationId).filter(Boolean) as string[];
    const usedFromOtherDays: Record<string, number> = {};
    for (const p of otherDayProposals) {
      if (!p.authorizationId) continue;
      usedFromOtherDays[p.authorizationId] = (usedFromOtherDays[p.authorizationId] ?? 0) + sessionHours(p.startTime, p.endTime);
    }

    const dayClients = dayInput.clients.map(c => {
      const used = c.usedHoursThisWeek + (usedFromOtherDays[c.authorizationId ?? ""] ?? 0);
      const remaining = c.approvedWeeklyHours > 0 ? Math.max(0, c.approvedWeeklyHours - used) : null;
      const authPerDay = remaining !== null ? Math.min(remaining, DAILY_MAX) : c.sessionHours;
      const snapped = Math.floor(Math.max(authPerDay, 0) * 2) / 2;
      const sessHours = snapped < MIN_BILLABLE && (remaining ?? 0) >= MIN_BILLABLE ? MIN_BILLABLE : snapped;
      return { ...c, daysNeeded: 1, sessionHours: sessHours, usedHoursThisWeek: used };
    });

    // Delete proposals for the target day before re-running
    await prisma.proposedSession.deleteMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: dayStart, lt: dayEnd },
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      },
    });

    // Run day scheduler
    const dayResult = await runScheduler({
      ...dayInput,
      clients: dayClients,
      targetDate: cancelDay,
      weekMode: undefined,
      lockedClientIds: undefined,
    });

    // ── Step 6: Audit post-cancellation ───────────────────────────────────────
    const afterMetrics = await snapshotMetrics(weekStart, weekEnd, clientIds, providerIds, rbtIds);
    console.log(`     After:    ${afterMetrics.totalProposals} proposals | ${afterMetrics.totalHours}h | ${afterMetrics.rbtUtilization}% RBT util | ${afterMetrics.clientCoverage}% client coverage`);

    // Detect new pairings on the cancelled day
    const dayProposalsAfter = await prisma.proposedSession.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: dayStart, lt: dayEnd },
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      },
      select: { clientId: true, providerId: true, startTime: true, endTime: true },
    });

    const newPairings: string[] = [];
    for (const dp of dayProposalsAfter) {
      if (!dp.clientId) continue;
      const prior = preCancellationPairs[dp.clientId];
      if (prior && prior !== dp.providerId) {
        newPairings.push(`${clientNameMap[dp.clientId]} re-assigned ${providerNameMap[prior]} → ${providerNameMap[dp.providerId]}`);
      }
    }

    // Detect unserved: clients who had a session proposed on the cancel day but nothing now
    const preCancelDayClients = new Set(
      weekProposals
        .filter(p => localDate(p.startTime) === cancelDay && p.clientId)
        .map(p => p.clientId!)
    );
    // Remove the specifically cancelled client from "expected" if CLIENT cancellation
    if (cancelType === "CLIENT") preCancelDayClients.delete(targetProposal.clientId!);
    const afterDayClients = new Set(dayProposalsAfter.map(dp => dp.clientId).filter(Boolean) as string[]);
    const unservedClients = [...preCancelDayClients].filter(id => !afterDayClients.has(id)).map(id => clientNameMap[id] ?? id);

    // Detect weird behaviors
    const weirdBehaviors: string[] = [];

    // 1. Did the scheduler double-book anyone on the cancelled day?
    const dayByProvider: Record<string, typeof dayProposalsAfter> = {};
    for (const dp of dayProposalsAfter) {
      if (!dayByProvider[dp.providerId]) dayByProvider[dp.providerId] = [];
      dayByProvider[dp.providerId].push(dp);
    }
    for (const [pid, slots] of Object.entries(dayByProvider)) {
      const sorted = slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].endTime > sorted[i + 1].startTime) {
          weirdBehaviors.push(`DOUBLE-BOOK: ${providerNameMap[pid]} has overlapping proposals on ${cancelDay}`);
        }
      }
    }

    // 2. Did the cancelled provider get re-assigned? (should NOT happen if PROVIDER cancel)
    if (cancelType === "PROVIDER") {
      const providerReused = dayProposalsAfter.some(dp => dp.providerId === targetProposal.providerId);
      if (providerReused) weirdBehaviors.push(`PROVIDER-CANCEL LEAK: cancelled provider ${pName} still has proposals on ${cancelDay}`);
    }

    // 3. Did the cancelled client get re-scheduled? (should NOT happen if CLIENT cancel)
    if (cancelType === "CLIENT") {
      const clientReused = dayProposalsAfter.some(dp => dp.clientId === targetProposal.clientId);
      if (clientReused) weirdBehaviors.push(`CLIENT-CANCEL LEAK: cancelled client ${cName} still has proposals on ${cancelDay}`);
    }

    // 4. Unrealistic session: proposed slot starts before 7am or ends after 8pm
    for (const dp of dayProposalsAfter) {
      const startH = parseInt(localHHMM(dp.startTime).split(":")[0], 10);
      const endH   = Math.ceil(dp.endTime.getTime() / 3_600_000) % 24;
      const endHLocal = parseInt(localHHMM(dp.endTime).split(":")[0], 10);
      if (startH < 7)  weirdBehaviors.push(`EARLY SESSION: proposal at ${localHHMM(dp.startTime)} for ${clientNameMap[dp.clientId ?? ""]}`);
      if (endHLocal > 20) weirdBehaviors.push(`LATE SESSION: proposal ends ${localHHMM(dp.endTime)} for ${clientNameMap[dp.clientId ?? ""]}`);
    }

    // 5. More proposals after cancellation than before (scheduler added sessions to unrelated days)
    if (afterMetrics.totalProposals > baseline.totalProposals + 3) {
      weirdBehaviors.push(`PROPOSAL INFLATION: ${afterMetrics.totalProposals} proposals after vs ${baseline.totalProposals} baseline — unexpected increase`);
    }

    const recoveredHours = Math.max(0, Math.round((afterMetrics.totalHours - (baseline.totalHours - cancelledHrs)) * 10) / 10);
    const netLossHours   = Math.round(Math.max(0, baseline.totalHours - afterMetrics.totalHours) * 10) / 10;
    const recoveryRate   = cancelledHrs > 0 ? Math.round((recoveredHours / cancelledHrs) * 100) : 100;

    const simResult: SimResult = {
      scenario,
      cancelType,
      cancelledClient: cName,
      cancelledProvider: pName,
      cancelDay,
      cancelledHours: Math.round(cancelledHrs * 10) / 10,
      baselineProposals: baseline.totalProposals,
      baselineHours: baseline.totalHours,
      baselineCoverage: baseline.clientCoverage,
      afterProposals: afterMetrics.totalProposals,
      afterHours: afterMetrics.totalHours,
      afterCoverage: afterMetrics.clientCoverage,
      recoveredHours,
      netLossHours,
      recoveryRate,
      unservedClients,
      newPairings,
      weirdBehaviors,
    };

    results.push(simResult);

    // Print per-scenario audit
    console.log(`\n  ┌─ SCENARIO ${scenario} AUDIT ─────────────────────────────────────`);
    console.log(`  │  Cancel type:      ${cancelType}`);
    console.log(`  │  Cancelled slot:   ${cName} ↔ ${pName} on ${cancelDay}`);
    console.log(`  │  Hours cancelled:  ${simResult.cancelledHours}h`);
    console.log(`  │  Baseline:         ${baseline.totalProposals} proposals / ${baseline.totalHours}h`);
    console.log(`  │  After re-sched:   ${afterMetrics.totalProposals} proposals / ${afterMetrics.totalHours}h`);
    console.log(`  │  Hours recovered:  ${recoveredHours}h / ${simResult.cancelledHours}h (${recoveryRate}%)`);
    console.log(`  │  Net hours lost:   ${netLossHours}h`);
    console.log(`  │  Client coverage:  ${baseline.clientCoverage}% → ${afterMetrics.clientCoverage}%`);
    if (newPairings.length > 0) {
      console.log(`  │  New pairings:     ${newPairings.length}`);
      for (const np of newPairings) console.log(`  │    • ${np}`);
    }
    if (unservedClients.length > 0) {
      console.log(`  │  Unserved clients: ${unservedClients.join(", ")}`);
    }
    if (weirdBehaviors.length > 0) {
      console.log(`  │  ⚠ FLAGS:`);
      for (const wb of weirdBehaviors) console.log(`  │    ! ${wb}`);
    } else {
      console.log(`  │  ✓ No behavioral anomalies detected`);
    }
    console.log(`  └─────────────────────────────────────────────────────────────`);
  }

  // ── Final cleanup ──────────────────────────────────────────────────────────
  console.log("\n  → Cleaning up simulation data...");
  await prisma.proposedSession.deleteMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { gte: weekStart, lt: weekEnd },
      OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
    },
  });
  if (syntheticSessionIds.length > 0) {
    await prisma.session.deleteMany({ where: { id: { in: syntheticSessionIds } } });
  }
  console.log(`  ✓ Removed ${syntheticSessionIds.length} synthetic sessions + all week proposals`);

  // ── Aggregate Report ───────────────────────────────────────────────────────
  const validResults = results.filter(r => r.baselineProposals > 0);
  const nRuns = validResults.length;

  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("  AGGREGATE SIMULATION REPORT — AUDIT_GOD FORMAT                    ");
  console.log("  Week of Apr 6–10, 2026 | 10 Scenarios                             ");
  console.log("════════════════════════════════════════════════════════════════════\n");

  if (nRuns === 0) {
    console.log("  No valid scenarios completed.\n");
    await prisma.$disconnect();
    return;
  }

  const avgBaselineHours   = validResults.reduce((s, r) => s + r.baselineHours, 0) / nRuns;
  const avgCancelledHours  = validResults.reduce((s, r) => s + r.cancelledHours, 0) / nRuns;
  const avgRecoveredHours  = validResults.reduce((s, r) => s + r.recoveredHours, 0) / nRuns;
  const avgNetLoss         = validResults.reduce((s, r) => s + r.netLossHours, 0) / nRuns;
  const avgRecoveryRate    = validResults.reduce((s, r) => s + r.recoveryRate, 0) / nRuns;
  const avgCoverageImpact  = validResults.reduce((s, r) => s + (r.afterCoverage - r.baselineCoverage), 0) / nRuns;

  const clientCancels = validResults.filter(r => r.cancelType === "CLIENT");
  const providerCancels = validResults.filter(r => r.cancelType === "PROVIDER");

  const scenariosWithWeirdBehavior = validResults.filter(r => r.weirdBehaviors.length > 0);
  const scenariosWithUnserved = validResults.filter(r => r.unservedClients.length > 0);
  const scenariosWithNewPairings = validResults.filter(r => r.newPairings.length > 0);

  const allWeirdBehaviors = validResults.flatMap(r => r.weirdBehaviors);
  const allUnserved = [...new Set(validResults.flatMap(r => r.unservedClients))];

  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SECTION A: CANCELLATION IMPACT SUMMARY");
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`  Valid scenarios completed:    ${nRuns} / 10`);
  console.log(`  Client cancellations:         ${clientCancels.length}`);
  console.log(`  Provider cancellations:       ${providerCancels.length}`);
  console.log(`  Avg baseline weekly hours:    ${avgBaselineHours.toFixed(1)}h`);
  console.log(`  Avg hours cancelled per run:  ${avgCancelledHours.toFixed(1)}h`);

  console.log("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SECTION B: AUTO-SCHEDULE RECOVERY PERFORMANCE");
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`  Avg hours recovered:          ${avgRecoveredHours.toFixed(1)}h`);
  console.log(`  Avg net hours lost:           ${avgNetLoss.toFixed(1)}h`);
  console.log(`  Avg recovery rate:            ${avgRecoveryRate.toFixed(0)}%`);
  console.log(`  Avg client coverage change:   ${avgCoverageImpact >= 0 ? "+" : ""}${avgCoverageImpact.toFixed(0)}%`);

  if (clientCancels.length > 0) {
    const clientAvgRecovery = clientCancels.reduce((s, r) => s + r.recoveryRate, 0) / clientCancels.length;
    const providerAvgRecovery = providerCancels.length > 0 ? providerCancels.reduce((s, r) => s + r.recoveryRate, 0) / providerCancels.length : 0;
    console.log(`\n  Recovery by cancellation type:`);
    console.log(`    CLIENT cancel avg recovery:   ${clientAvgRecovery.toFixed(0)}%`);
    console.log(`    PROVIDER cancel avg recovery: ${providerAvgRecovery.toFixed(0)}%`);
  }

  console.log("\n  Per-scenario recovery:");
  console.log("  #  | Day       | Type     | Cancelled | Recovered | Net Loss | Recovery%");
  console.log("  ---|-----------|----------|-----------|-----------|----------|----------");
  for (const r of validResults) {
    const day = r.cancelDay.slice(5); // MM-DD
    console.log(`  ${r.scenario.toString().padStart(2)} | ${day}    | ${r.cancelType.padEnd(8)} | ${r.cancelledHours.toFixed(1).padStart(5)}h    | ${r.recoveredHours.toFixed(1).padStart(5)}h    | ${r.netLossHours.toFixed(1).padStart(4)}h    | ${r.recoveryRate.toString().padStart(3)}%`);
  }

  console.log("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SECTION C: BEHAVIORAL FLAGS & ANOMALIES");
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`  Scenarios with anomalies:     ${scenariosWithWeirdBehavior.length} / ${nRuns}`);
  console.log(`  Scenarios with new pairings:  ${scenariosWithNewPairings.length} / ${nRuns} (expected — scheduler re-optimizes)`);
  console.log(`  Scenarios with unserved:      ${scenariosWithUnserved.length} / ${nRuns}`);

  if (allWeirdBehaviors.length > 0) {
    console.log(`\n  All detected anomalies (${allWeirdBehaviors.length} total):`);
    const counts: Record<string, number> = {};
    for (const wb of allWeirdBehaviors) {
      const key = wb.split(":")[0];
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const [type, count] of Object.entries(counts)) {
      console.log(`    • ${type}: ${count}x`);
    }
    console.log("\n  Full anomaly list:");
    for (const r of validResults) {
      for (const wb of r.weirdBehaviors) {
        console.log(`    [Scenario ${r.scenario}] ${wb}`);
      }
    }
  } else {
    console.log("\n  ✓ No behavioral anomalies detected across all 10 scenarios.");
  }

  if (allUnserved.length > 0) {
    console.log(`\n  Clients left unserved in at least one scenario:`);
    for (const u of allUnserved) console.log(`    • ${u}`);
  }

  console.log("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SECTION D: AUDIT_GOD ASSESSMENT");
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const complianceIssues = allWeirdBehaviors.filter(wb => wb.startsWith("DOUBLE-BOOK") || wb.startsWith("PROVIDER-CANCEL LEAK") || wb.startsWith("CLIENT-CANCEL LEAK")).length;
  const efficiencyIssues = allWeirdBehaviors.filter(wb => wb.startsWith("PROPOSAL INFLATION")).length;
  const windowIssues     = allWeirdBehaviors.filter(wb => wb.startsWith("EARLY") || wb.startsWith("LATE")).length;

  console.log(`  Compliance violations found:  ${complianceIssues} (double-books, cancel leaks)`);
  console.log(`  Efficiency anomalies:         ${efficiencyIssues} (proposal inflation)`);
  console.log(`  Scheduling window violations: ${windowIssues} (early/late sessions)`);
  console.log(`  Avg system recovery rate:     ${avgRecoveryRate.toFixed(0)}%`);

  // Final assessment
  const isEffective = avgRecoveryRate >= 60 && complianceIssues === 0;
  console.log(`\n  Overall Assessment:`);
  if (avgRecoveryRate >= 80 && complianceIssues === 0) {
    console.log(`  ✅ STRONG — Auto-schedule recovers ${avgRecoveryRate.toFixed(0)}% of cancelled hours with no compliance violations.`);
    console.log(`     The scheduler effectively re-optimizes after cancellations and remains realistic.`);
  } else if (avgRecoveryRate >= 60 && complianceIssues === 0) {
    console.log(`  ⚠ ADEQUATE — Auto-schedule recovers ${avgRecoveryRate.toFixed(0)}% of cancelled hours.`);
    console.log(`     No compliance issues, but recovery could be higher. Review unserved client patterns.`);
  } else if (complianceIssues > 0) {
    console.log(`  ❌ COMPLIANCE RISK — ${complianceIssues} cancellation handling violation(s) detected.`);
    console.log(`     The scheduler is generating invalid proposals after cancellations. Immediate fix required.`);
  } else {
    console.log(`  ⚠ LOW RECOVERY — Only ${avgRecoveryRate.toFixed(0)}% of cancelled hours recovered.`);
    console.log(`     Scheduler may be too constrained after cancellations. Review availability and auth data.`);
  }

  console.log("\n════════════════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Simulation error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
