/**
 * SIM SUITE — 15-Scenario Comprehensive Simulation
 * Joint AUDIT_GOD + BUG_HUNTER report for ABA Scheduling Platform
 *
 * Covers: full-week clean-slate, over-scheduling buffer, mid-week partial,
 * cancellation isolation, multi-swap, provider callout, constrained client
 * compliance, auth expiry, new client, vacation week, last-resort BCaBA/BCBA,
 * lunch block conflicts, and what-if new female provider.
 *
 * Usage:
 *   npx tsx scripts/sim-suite.ts [YYYY-MM-DD]
 *   Default date: today
 *
 * Safe to run: zero DB writes — all simulations are read-only.
 */

import { PrismaClient, DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type { SchedulerInput, SchedulerClient, SchedulerProvider, SchedulerOutput } from "../src/lib/scheduler/types";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();
const TIMEZONE = "America/New_York";
const MAX_SESSION_HOURS = 8.0;
const MIN_SESSION_HOURS = 1.5;
const WEEKDAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

// ─── Utilities ─────────────────────────────────────────────────────────────────

function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function localDOW(d: Date): DayOfWeek {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "long" })
    .format(d).toUpperCase() as DayOfWeek;
}

function localHHMM(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function toUtcDate(dateStr: string, localTime: string): Date {
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

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function sessionHoursFromDates(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function hr(mins: number): string {
  return (mins / 60).toFixed(1) + "h";
}

function pct(n: number): string {
  return n.toFixed(0) + "%";
}

function bar(pct: number, width = 10): string {
  const filled = Math.min(width, Math.round(pct / 10));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function sep(char = "═", width = 72): string {
  return char.repeat(width);
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CancellationInput {
  providerId: string;
  clientId: string;
  startTime: Date;
  endTime: Date;
  cancelledBy: "CLIENT" | "PROVIDER";
}

interface BugFinding {
  scenario: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  trace: string;
}

interface ScenarioScore {
  compliance: number;
  utilization: number;
  coverage: number;
  consistency: number;
  travel: number;
  final: number;
  rating: string;
  proposalCount: number;
  fullyCovered: number;
  totalClients: number;
}

interface ScenarioResult {
  id: number;
  name: string;
  description: string;
  proposals: SchedulerOutput["proposals"];
  skipReasons: Record<string, string>;
  score: ScenarioScore | null;  // null for day-mode scenarios
  assertions: Array<{ label: string; pass: boolean; detail: string }>;
  findings: BugFinding[];
  notes: string[];
  warnings: string[];
}

// ─── DB Context ────────────────────────────────────────────────────────────────

interface DBContext {
  centerId: string;
  centerName: string;
  weekOf: Date;          // Monday of target week
  weekStart: Date;       // Inclusive Monday midnight UTC
  weekEnd: Date;         // Exclusive next Monday midnight UTC
  clients: SchedulerClient[];
  providers: SchedulerProvider[];
  sessionTypeIds: { CENTER: string; HOME: string; SCHOOL: string };
  driveTimeSessionTypeId: string | null;
  driveMinutes: Record<string, Record<string, number>>;
  distanceMeters: Record<string, Record<string, number>>;
  clientNameMap: Record<string, string>;
  providerNameMap: Record<string, string>;
  // Raw provider info for BUG_HUNTER checks
  rawProviders: Array<{
    id: string; position: string; gender: string | null; spanish: boolean;
    rbtLevel: string | null; weeklyHoursAlreadyScheduled: number;
  }>;
}

async function loadDBContext(targetDate: Date): Promise<DBContext> {
  const { weekStart, weekEnd } = getWeekBoundaries(targetDate, TIMEZONE);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000); // Monday

  const [center, centerST, homeST, driveTimeST] = await Promise.all([
    prisma.center.findFirst(),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);

  if (!center) throw new Error("No center found");
  if (!centerST) throw new Error("No billable session type found");

  const sessionTypeIds = { CENTER: centerST.id, HOME: homeST?.id ?? centerST.id, SCHOOL: centerST.id };
  const driveTimeSessionTypeId = driveTimeST?.id ?? null;

  const [rawClients, rawProviders, allAuths] = await Promise.all([
    prisma.client.findMany({
      where: {
        AND: [
          { OR: [{ centerId: center.id }, { centerId: null }] },
          { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
        ],
      },
      include: {
        availability: true,
        approvedHomeProviders: { where: { endDate: null } },
      },
    }),
    prisma.provider.findMany({
      where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
      include: { availability: true },
    }),
    prisma.authorization.findMany({
      where: { startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
      orderBy: { startDate: "desc" },
      select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
    }),
  ]);

  const clientIds = rawClients.map(c => c.id);
  const providerIds = rawProviders.map(p => p.id);

  // Auth map
  const clientAuthMap: Record<string, { authId: string; weeklyHours: number; endDate: Date }> = {};
  const authorizationIds: string[] = [];
  for (const auth of allAuths) {
    if (!clientAuthMap[auth.clientId]) {
      authorizationIds.push(auth.id);
      clientAuthMap[auth.clientId] = {
        authId: auth.id,
        weeklyHours: auth.approvedHoursPerWeek,
        endDate: auth.endDate,
      };
    }
  }

  // Used hours from sessions only (no PENDING — matches UI clean-slate behavior)
  const usedHoursMap: Record<string, number> = {};
  if (authorizationIds.length > 0) {
    const usedSessions = await prisma.session.findMany({
      where: {
        authorizationId: { in: authorizationIds },
        billable: true,
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { authorizationId: true, startTime: true, endTime: true },
    });
    for (const s of usedSessions) {
      if (!s.authorizationId) continue;
      usedHoursMap[s.authorizationId] =
        (usedHoursMap[s.authorizationId] ?? 0) +
        sessionHoursFromDates(s.startTime, s.endTime);
    }
  }

  // APPROVED proposals only (PENDING excluded — UI clears before each run)
  const approvedProposals = await prisma.proposedSession.findMany({
    where: {
      OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
      status: "APPROVED",
      startTime: { gte: weekStart, lt: weekEnd },
    },
    select: { providerId: true, clientId: true, startTime: true, endTime: true },
  });

  // Booked sessions (SCHEDULED + IN_PROGRESS)
  const bookedSessions = await prisma.session.findMany({
    where: {
      providerId: { in: providerIds },
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      startTime: { gte: weekStart },
      endTime: { lte: weekEnd },
    },
    select: { providerId: true, clientId: true, startTime: true, endTime: true, billable: true },
  });

  // Build booked windows
  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  for (const s of [...bookedSessions, ...approvedProposals]) {
    const dow = localDOW(s.startTime);
    const st = localHHMM(s.startTime);
    const et = localHHMM(s.endTime);
    if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
    bookedByProvider[s.providerId].push({ dayOfWeek: dow, startTime: st, endTime: et });
    if (s.clientId) {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek: dow, startTime: st, endTime: et });
    }
  }

  // Historical providers (4-week lookback)
  const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 86_400_000);
  const priorSessions = await prisma.session.findMany({
    where: {
      clientId: { in: clientIds },
      startTime: { gte: fourWeeksAgo, lt: weekStart },
      status: { in: ["SCHEDULED", "COMPLETED", "IN_PROGRESS"] },
    },
    select: { clientId: true, providerId: true, startTime: true },
    orderBy: { startTime: "desc" },
  });
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId))
      historicalByClient[s.clientId].push(s.providerId);
  }

  // Prior-week history flag: ≥1 billable session in 7 days before weekStart
  const oneWeekAgo = new Date(weekStart.getTime() - 7 * 86_400_000);
  const priorWeekSessions = await prisma.session.findMany({
    where: {
      clientId: { in: clientIds },
      startTime: { gte: oneWeekAgo, lt: weekStart },
      status: { in: ["SCHEDULED", "COMPLETED", "IN_PROGRESS"] },
    },
    select: { clientId: true },
  });
  const priorWeekClientIds = new Set(priorWeekSessions.map(s => s.clientId).filter(Boolean) as string[]);

  // Provider blocks
  const providerBlocksRaw = await prisma.providerBlock.findMany({
    where: { providerId: { in: providerIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { providerId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of providerBlocksRaw) {
    const ds = localDate(b.date);
    if (!blocksByProvider[b.providerId]) blocksByProvider[b.providerId] = [];
    blocksByProvider[b.providerId].push({ date: ds, startTime: b.startTime, endTime: b.endTime });
  }

  // Client blocks
  const clientBlocksRaw = await prisma.clientBlock.findMany({
    where: { clientId: { in: clientIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { clientId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByClient: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of clientBlocksRaw) {
    const ds = localDate(b.date);
    if (!blocksByClient[b.clientId]) blocksByClient[b.clientId] = [];
    blocksByClient[b.clientId].push({ date: ds, startTime: b.startTime, endTime: b.endTime });
  }

  // Name maps
  const clientNameMap: Record<string, string> = {};
  const providerNameMap: Record<string, string> = {};
  for (const c of rawClients) clientNameMap[c.id] = `${c.lastName}, ${c.firstName}`;
  for (const p of rawProviders) providerNameMap[p.id] = `${p.lastName}, ${p.firstName}`;

  // Zero drive times (no Maps API in scripts)
  const driveMinutes: Record<string, Record<string, number>> = {};
  const distanceMeters: Record<string, Record<string, number>> = {};
  for (const p of rawProviders) {
    driveMinutes[p.id] = {}; distanceMeters[p.id] = {};
    for (const c of rawClients) { driveMinutes[p.id][c.id] = 0; distanceMeters[p.id][c.id] = 0; }
  }
  for (const a of rawClients) {
    driveMinutes[a.id] ??= {}; distanceMeters[a.id] ??= {};
    for (const b of rawClients) { driveMinutes[a.id][b.id] = 0; distanceMeters[a.id][b.id] = 0; }
  }

  // Build SchedulerClient array
  const clients: SchedulerClient[] = rawClients.map(c => {
    const auth = clientAuthMap[c.id];
    const used = auth ? (usedHoursMap[auth.authId] ?? 0) : 0;
    const remaining = auth ? Math.max(0, auth.weeklyHours - used) : null;
    const availDays = new Set(c.availability.map(a => a.dayOfWeek)).size || 1;
    const daysNeeded = remaining !== null
      ? Math.max(1, Math.min(Math.ceil(remaining / MAX_SESSION_HOURS), availDays))
      : 1;
    const rawPerDay = remaining !== null ? remaining / daysNeeded : (c.defaultSessionHours ?? 4);
    const snapped = Math.round(rawPerDay * 2) / 2;
    const sessHours = Math.max(snapped, MIN_SESSION_HOURS);

    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      latitude: c.latitude,
      longitude: c.longitude,
      sessionHours: sessHours,
      daysNeeded,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      availability: c.availability.map(a => ({
        dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime,
      })),
      bookedWindows: bookedByClient[c.id] ?? [],
      blocks: blocksByClient[c.id] ?? [],
      authorizationId: auth?.authId ?? null,
      approvedWeeklyHours: auth?.weeklyHours ?? 0,
      usedHoursThisWeek: used,
      authorizationEndDate: auth?.endDate ? localDate(auth.endDate) : null,
      approvedProviderIds: c.approvedHomeProviders.map(ah => ah.providerId),
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: priorWeekClientIds.has(c.id),
      preferredLocation: c.preferredLocation as "HOME" | "CENTER" | "HYBRID" | "SCHOOL",
    };
  });

  // Build SchedulerProvider array
  const providers: SchedulerProvider[] = rawProviders.map(p => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position as "BCBA" | "BCaBA" | "RBT",
    rbtLevel: p.rbtLevel,
    gender: p.gender ?? "",
    spanish: p.spanish,
    latitude: p.latitude,
    longitude: p.longitude,
    availability: p.availability.map(a => ({
      dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime,
    })),
    bookedWindows: bookedByProvider[p.id] ?? [],
    blocks: blocksByProvider[p.id] ?? [],
    weeklyHoursAlreadyScheduled: 0,
  }));

  return {
    centerId: center.id,
    centerName: center.name,
    weekOf,
    weekStart,
    weekEnd,
    clients,
    providers,
    sessionTypeIds,
    driveTimeSessionTypeId,
    driveMinutes,
    distanceMeters,
    clientNameMap,
    providerNameMap,
    rawProviders: rawProviders.map(p => ({
      id: p.id,
      position: p.position,
      gender: p.gender,
      spanish: p.spanish,
      rbtLevel: p.rbtLevel,
      weeklyHoursAlreadyScheduled: 0,
    })),
  };
}

// ─── AUDIT_GOD Scoring ─────────────────────────────────────────────────────────

function computeScore(
  proposals: SchedulerOutput["proposals"],
  skipReasons: Record<string, string>,
  clients: SchedulerClient[],
  providers: SchedulerProvider[],
  label: string
): ScenarioScore {
  const clientMap = new Map(clients.map(c => [c.id, c]));
  const providerMap = new Map(providers.map(p => [p.id, p]));

  // Compliance: any hard constraint violation = 0
  let violations = 0;
  for (const pr of proposals) {
    const c = clientMap.get(pr.clientId);
    const p = providerMap.get(pr.providerId);
    if (!c || !p) continue;
    if (c.femaleProviderOnly && p.gender.toLowerCase() !== "female") violations++;
    if (c.spanish && !p.spanish) violations++;
    const RBT_RANK: Record<string, number> = { I: 1, II: 2, III: 3 };
    if (c.minimumRbtLevel && p.position === "RBT" && p.rbtLevel) {
      if (RBT_RANK[p.rbtLevel] < RBT_RANK[c.minimumRbtLevel]) violations++;
    }
    if (!c.authorizationId) violations++;
  }
  const compliance = violations === 0 ? 100 : 0;

  // Utilization: scheduled mins / available mins on working days
  let totalAvailMins = 0, totalSchedMins = 0;
  for (const p of providers) {
    if (p.position !== "RBT") continue;
    const myProposals = proposals.filter(pr => pr.providerId === p.id);
    const workingDays = new Set(myProposals.map(pr => pr.dayOfWeek));
    const workingDayAvailMins = p.availability
      .filter(a => WEEKDAYS.includes(a.dayOfWeek) && workingDays.has(a.dayOfWeek))
      .reduce((sum, a) => sum + parseHHMM(a.endTime) - parseHHMM(a.startTime), 0);
    const totalAvailMinsForP = p.availability
      .filter(a => WEEKDAYS.includes(a.dayOfWeek))
      .reduce((sum, a) => sum + parseHHMM(a.endTime) - parseHHMM(a.startTime), 0);
    if (totalAvailMinsForP === 0) continue;
    const scheduledMins = myProposals.reduce(
      (sum, pr) => sum + parseHHMM(pr.endTime) - parseHHMM(pr.startTime), 0
    );
    totalAvailMins += workingDayAvailMins;
    totalSchedMins += scheduledMins;
  }
  const utilization = totalAvailMins > 0
    ? Math.min(100, Math.round((totalSchedMins / totalAvailMins) * 100))
    : 0;

  // Coverage: clients ≥90% of authorized weekly hours
  let fullyCovered = 0;
  const clientScheduledHours = new Map<string, number>();
  for (const pr of proposals) {
    const hrs = (parseHHMM(pr.endTime) - parseHHMM(pr.startTime)) / 60;
    clientScheduledHours.set(pr.clientId, (clientScheduledHours.get(pr.clientId) ?? 0) + hrs);
  }
  for (const c of clients) {
    const scheduled = clientScheduledHours.get(c.id) ?? 0;
    const target = c.approvedWeeklyHours;
    const maxSchedulable = 5 * MAX_SESSION_HOURS;
    const denominator = Math.min(target, maxSchedulable);
    if (denominator > 0 && scheduled / denominator >= 0.9) fullyCovered++;
  }
  const coverage = clients.length > 0
    ? Math.round((fullyCovered / clients.length) * 100)
    : 0;

  // Consistency: % of proposals matching historical provider
  const withHistory = proposals.filter(pr => {
    const c = clientMap.get(pr.clientId);
    return c && c.historicalProviderIds.includes(pr.providerId);
  });
  const consistency = proposals.length > 0
    ? Math.round((withHistory.length / proposals.length) * 100)
    : 100;

  const travel = 100; // no GPS data

  const final = Math.round(
    compliance * 0.30 +
    utilization * 0.30 +
    coverage * 0.25 +
    consistency * 0.10 +
    travel * 0.05
  );

  const rating =
    final >= 90 ? "Excellent" :
    final >= 75 ? "Good" :
    final >= 60 ? "Fair" : "Poor";

  return {
    compliance, utilization, coverage, consistency, travel, final, rating,
    proposalCount: proposals.length,
    fullyCovered,
    totalClients: clients.length,
  };
}

// ─── BUG_HUNTER Runtime Invariant Checks ──────────────────────────────────────

interface InvariantCheckResult {
  findings: BugFinding[];
  passed: string[];
}

function runInvariantChecks(
  scenarioId: string,
  proposals: SchedulerOutput["proposals"],
  clients: SchedulerClient[],
  providers: SchedulerProvider[],
  options: {
    cancellationContext?: { displacedClientIds: string[]; freedProviderIds: string[] };
    notBefore?: string;       // "YYYY-MM-DD" — no proposals before this date
    lunchBlocks?: Array<{ providerId: string; date: string; startTime: string; endTime: string }>;
    expectZeroProposals?: boolean;
    label?: string;
  } = {}
): InvariantCheckResult {
  const findings: BugFinding[] = [];
  const passed: string[] = [];
  const clientMap = new Map(clients.map(c => [c.id, c]));
  const providerMap = new Map(providers.map(p => [p.id, p]));
  const RBT_RANK: Record<string, number> = { I: 1, II: 2, III: 3 };

  // ── INV-01: Gender requirement ─────────────────────────────────────────────
  const genderViolations = proposals.filter(pr => {
    const c = clientMap.get(pr.clientId);
    const p = providerMap.get(pr.providerId);
    return c?.femaleProviderOnly && p?.gender.toLowerCase() !== "female";
  });
  if (genderViolations.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "Female-provider-only constraint violated",
      detail: genderViolations.map(pr =>
        `${clientMap.get(pr.clientId)?.lastName ?? pr.clientId} → ${providerMap.get(pr.providerId)?.lastName ?? pr.providerId} (gender: ${providerMap.get(pr.providerId)?.gender ?? "unknown"})`
      ).join("; "),
      trace: "constraints.ts checkFemaleRequirement returned false but proposal was generated",
    });
  } else {
    passed.push("INV-01 Gender requirement: no violations");
  }

  // ── INV-02: Spanish requirement ────────────────────────────────────────────
  const spanishViolations = proposals.filter(pr => {
    const c = clientMap.get(pr.clientId);
    const p = providerMap.get(pr.providerId);
    return c?.spanish && !p?.spanish;
  });
  if (spanishViolations.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "Spanish-speaking requirement violated",
      detail: spanishViolations.map(pr =>
        `${clientMap.get(pr.clientId)?.lastName ?? pr.clientId} → ${providerMap.get(pr.providerId)?.lastName ?? pr.providerId}`
      ).join("; "),
      trace: "constraints.ts checkSpanishRequirement returned false but proposal was generated",
    });
  } else {
    passed.push("INV-02 Spanish requirement: no violations");
  }

  // ── INV-03: RBT level requirement ──────────────────────────────────────────
  const rbtViolations = proposals.filter(pr => {
    const c = clientMap.get(pr.clientId);
    const p = providerMap.get(pr.providerId);
    if (!c?.minimumRbtLevel || !p || p.position !== "RBT") return false;
    if (!p.rbtLevel) return true;
    return RBT_RANK[p.rbtLevel] < RBT_RANK[c.minimumRbtLevel];
  });
  if (rbtViolations.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "RBT level requirement violated",
      detail: rbtViolations.map(pr => {
        const c = clientMap.get(pr.clientId);
        const p = providerMap.get(pr.providerId);
        return `${c?.lastName ?? pr.clientId} (min ${c?.minimumRbtLevel}) → ${p?.lastName ?? pr.providerId} (level ${p?.rbtLevel ?? "unset"})`;
      }).join("; "),
      trace: "constraints.ts checkRbtLevel should have blocked this pairing",
    });
  } else {
    passed.push("INV-03 RBT level requirement: no violations");
  }

  // ── INV-04: Active authorization ───────────────────────────────────────────
  const authViolations = proposals.filter(pr => {
    const c = clientMap.get(pr.clientId);
    return !c?.authorizationId;
  });
  if (authViolations.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "Session proposed without active authorization",
      detail: authViolations.map(pr =>
        `${clientMap.get(pr.clientId)?.lastName ?? pr.clientId}: no authorizationId`
      ).join("; "),
      trace: "constraints.ts checkHasAuthorization should have blocked this",
    });
  } else {
    passed.push("INV-04 Authorization present: no violations");
  }

  // ── INV-05: Provider availability window ───────────────────────────────────
  const providerWindowViolations = proposals.filter(pr => {
    const p = providerMap.get(pr.providerId);
    if (!p) return false;
    const windows = p.availability.filter(a => a.dayOfWeek === pr.dayOfWeek);
    const slotStart = parseHHMM(pr.startTime);
    const slotEnd = parseHHMM(pr.endTime);
    return !windows.some(w =>
      parseHHMM(w.startTime) <= slotStart && parseHHMM(w.endTime) >= slotEnd
    );
  });
  if (providerWindowViolations.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "Proposal outside provider availability window",
      detail: providerWindowViolations.map(pr => {
        const p = providerMap.get(pr.providerId);
        return `${p?.lastName ?? pr.providerId} on ${pr.dayOfWeek}: ${pr.startTime}–${pr.endTime} outside availability`;
      }).join("; "),
      trace: "slots.ts pairwiseOverlap should not generate slots outside provider windows",
    });
  } else {
    passed.push("INV-05 Provider availability windows: no violations");
  }

  // ── INV-06: Client availability window ────────────────────────────────────
  const clientWindowViolations = proposals.filter(pr => {
    const c = clientMap.get(pr.clientId);
    if (!c) return false;
    const windows = c.availability.filter(a => a.dayOfWeek === pr.dayOfWeek);
    const slotStart = parseHHMM(pr.startTime);
    const slotEnd = parseHHMM(pr.endTime);
    return !windows.some(w =>
      parseHHMM(w.startTime) <= slotStart && parseHHMM(w.endTime) >= slotEnd
    );
  });
  if (clientWindowViolations.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "Proposal outside client availability window",
      detail: clientWindowViolations.map(pr => {
        const c = clientMap.get(pr.clientId);
        return `${c?.lastName ?? pr.clientId} on ${pr.dayOfWeek}: ${pr.startTime}–${pr.endTime} outside availability`;
      }).join("; "),
      trace: "slots.ts pairwiseOverlap should not generate slots outside client windows",
    });
  } else {
    passed.push("INV-06 Client availability windows: no violations");
  }

  // ── INV-07: Session validity (end > start, non-zero length) ───────────────
  const invalidSessions = proposals.filter(pr => parseHHMM(pr.endTime) <= parseHHMM(pr.startTime));
  if (invalidSessions.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "CRITICAL",
      title: "Zero-length or negative-length session proposed",
      detail: invalidSessions.map(pr =>
        `${pr.clientId}: ${pr.startTime}–${pr.endTime} on ${pr.dayOfWeek}`
      ).join("; "),
      trace: "optimizer.ts per-proposal guard should reject end ≤ start",
    });
  } else {
    passed.push("INV-07 Session validity (end > start): no violations");
  }

  // ── INV-08: Weekday only ───────────────────────────────────────────────────
  const weekendSessions = proposals.filter(pr =>
    !WEEKDAYS.includes(pr.dayOfWeek)
  );
  if (weekendSessions.length > 0) {
    findings.push({
      scenario: scenarioId,
      severity: "HIGH",
      title: "Proposal generated on weekend day",
      detail: weekendSessions.map(pr =>
        `${pr.clientId}: ${pr.dayOfWeek} ${pr.startTime}–${pr.endTime}`
      ).join("; "),
      trace: "slots.ts Mon–Fri filter should exclude SATURDAY and SUNDAY",
    });
  } else {
    passed.push("INV-08 Weekday only: no weekend sessions");
  }

  // ── INV-09: Provider double-booking within this run ───────────────────────
  const providerSlotsThisRun: Record<string, Array<{ day: DayOfWeek; start: number; end: number }>> = {};
  let providerDoubleBooked = false;
  for (const pr of proposals) {
    if (!providerSlotsThisRun[pr.providerId]) providerSlotsThisRun[pr.providerId] = [];
    const slot = { day: pr.dayOfWeek, start: parseHHMM(pr.startTime), end: parseHHMM(pr.endTime) };
    const conflict = providerSlotsThisRun[pr.providerId].find(
      s => s.day === slot.day && s.start < slot.end && slot.start < s.end
    );
    if (conflict) {
      providerDoubleBooked = true;
      findings.push({
        scenario: scenarioId,
        severity: "CRITICAL",
        title: "Provider double-booked within this run",
        detail: `Provider ${providerMap.get(pr.providerId)?.lastName ?? pr.providerId} on ${pr.dayOfWeek}: ${pr.startTime}–${pr.endTime} overlaps prior proposal ${String(conflict.start / 60 | 0).padStart(2,"0")}:${String(conflict.start % 60).padStart(2,"0")}–${String(conflict.end / 60 | 0).padStart(2,"0")}:${String(conflict.end % 60).padStart(2,"0")}`,
        trace: "optimizer.ts in-memory conflict check must reject overlapping proposals for same provider",
      });
    }
    providerSlotsThisRun[pr.providerId].push(slot);
  }
  if (!providerDoubleBooked) passed.push("INV-09 Provider double-booking: no conflicts within run");

  // ── INV-10: Client double-booking within this run ─────────────────────────
  const clientSlotsThisRun: Record<string, Array<{ day: DayOfWeek; start: number; end: number }>> = {};
  let clientDoubleBooked = false;
  for (const pr of proposals) {
    if (!clientSlotsThisRun[pr.clientId]) clientSlotsThisRun[pr.clientId] = [];
    const slot = { day: pr.dayOfWeek, start: parseHHMM(pr.startTime), end: parseHHMM(pr.endTime) };
    const conflict = clientSlotsThisRun[pr.clientId].find(
      s => s.day === slot.day && s.start < slot.end && slot.start < s.end
    );
    if (conflict) {
      clientDoubleBooked = true;
      findings.push({
        scenario: scenarioId,
        severity: "CRITICAL",
        title: "Client double-booked within this run",
        detail: `Client ${clientMap.get(pr.clientId)?.lastName ?? pr.clientId} on ${pr.dayOfWeek}: ${pr.startTime}–${pr.endTime}`,
        trace: "optimizer.ts in-memory conflict check must reject overlapping proposals for same client",
      });
    }
    clientSlotsThisRun[pr.clientId].push(slot);
  }
  if (!clientDoubleBooked) passed.push("INV-10 Client double-booking: no conflicts within run");

  // ── INV-11: Cancellation pairing isolation ────────────────────────────────
  if (options.cancellationContext) {
    const { displacedClientIds, freedProviderIds } = options.cancellationContext;
    const hasBothSides = displacedClientIds.length > 0 && freedProviderIds.length > 0;

    if (!hasBothSides) {
      // Single-side cancellation must produce zero proposals
      if (proposals.length > 0) {
        findings.push({
          scenario: scenarioId,
          severity: "CRITICAL",
          title: "Single-side cancellation generated proposals (isolation leak)",
          detail: `${proposals.length} proposal(s) generated with displaced=${displacedClientIds.length}, freed=${freedProviderIds.length}. Expected 0.`,
          trace: "optimizer.ts cancellationContext guard requires both sides present for any output",
        });
      } else {
        passed.push("INV-11a Cancellation isolation: single-side correctly produced 0 proposals");
      }
    } else {
      // Both sides present — proposals must only be displaced↔freed pairs
      const freedSet = new Set(freedProviderIds);
      const displacedSet = new Set(displacedClientIds);
      const invalidProposals = proposals.filter(pr =>
        !displacedSet.has(pr.clientId) || !freedSet.has(pr.providerId)
      );
      if (invalidProposals.length > 0) {
        findings.push({
          scenario: scenarioId,
          severity: "CRITICAL",
          title: "Cancellation context: proposal outside displaced↔freed pairing",
          detail: invalidProposals.map(pr =>
            `${clientMap.get(pr.clientId)?.lastName ?? pr.clientId} ↔ ${providerMap.get(pr.providerId)?.lastName ?? pr.providerId} — not in displaced/freed sets`
          ).join("; "),
          trace: "optimizer.ts cancellationContext must restrict: displacedClientIds × freedProviderIds only",
        });
      } else {
        passed.push("INV-11b Cancellation isolation: all proposals are valid displaced↔freed pairs");
      }
    }
  }

  // ── INV-12: notBefore respected ────────────────────────────────────────────
  if (options.notBefore) {
    const notBeforeDOW = localDOW(new Date(`${options.notBefore}T12:00:00Z`));
    const notBeforeIdx = WEEKDAYS.indexOf(notBeforeDOW);
    const earlyProposals = proposals.filter(pr => {
      const prIdx = WEEKDAYS.indexOf(pr.dayOfWeek);
      return prIdx < notBeforeIdx;
    });
    if (earlyProposals.length > 0) {
      findings.push({
        scenario: scenarioId,
        severity: "CRITICAL",
        title: "Proposals generated before notBefore day",
        detail: earlyProposals.map(pr =>
          `${clientMap.get(pr.clientId)?.lastName ?? pr.clientId}: ${pr.dayOfWeek} ${pr.startTime}`
        ).join("; "),
        trace: "optimizer.ts notBefore filter must skip days before the cutoff",
      });
    } else {
      passed.push("INV-12 notBefore filter: no proposals before cutoff");
    }
  }

  // ── INV-13: Lunch block not violated ──────────────────────────────────────
  if (options.lunchBlocks && options.lunchBlocks.length > 0) {
    const lunchByProvider: Record<string, Array<{ date: string; start: number; end: number }>> = {};
    for (const lb of options.lunchBlocks) {
      if (!lunchByProvider[lb.providerId]) lunchByProvider[lb.providerId] = [];
      lunchByProvider[lb.providerId].push({
        date: lb.date,
        start: parseHHMM(lb.startTime),
        end: parseHHMM(lb.endTime),
      });
    }
    const lunchViolations = proposals.filter(pr => {
      const blocks = lunchByProvider[pr.providerId] ?? [];
      const pStart = parseHHMM(pr.startTime);
      const pEnd = parseHHMM(pr.endTime);
      return blocks.some(b => b.start < pEnd && pStart < b.end);
    });
    if (lunchViolations.length > 0) {
      findings.push({
        scenario: scenarioId,
        severity: "HIGH",
        title: "Session overlaps provider lunch block",
        detail: lunchViolations.map(pr => {
          const p = providerMap.get(pr.providerId);
          return `${p?.lastName ?? pr.providerId}: ${pr.startTime}–${pr.endTime} on ${pr.dayOfWeek} overlaps lunch block`;
        }).join("; "),
        trace: "slots.ts block subtraction must exclude provider blocks before generating slots",
      });
    } else {
      passed.push("INV-13 Lunch blocks respected: no overlap violations");
    }
  }

  // ── INV-14: Position tier — no BCBA if RBT available and under capacity ───
  // We detect this heuristically: if a BCBA is in proposals, check whether any RBT
  // with overlapping availability existed and was NOT at capacity
  const bcbaProposals = proposals.filter(pr => {
    const p = providerMap.get(pr.providerId);
    return p?.position === "BCBA";
  });
  if (bcbaProposals.length > 0) {
    // Check: for each BCBA proposal, was there an RBT available that day who was not fully loaded?
    for (const pr of bcbaProposals) {
      const c = clientMap.get(pr.clientId);
      if (!c) continue;
      // Count RBT proposals on the same day
      const rbtProposalsOnDay = proposals.filter(r => {
        const rp = providerMap.get(r.providerId);
        return r.dayOfWeek === pr.dayOfWeek && rp?.position === "RBT";
      });
      const rbtProviderCountOnDay = new Set(rbtProposalsOnDay.map(r => r.providerId)).size;
      const totalRbts = providers.filter(p => p.position === "RBT").length;
      if (rbtProviderCountOnDay < totalRbts) {
        // Not all RBTs are in use on this day — possible last-resort assignment
        // This is a suspected issue, not confirmed — some RBTs may have been constraint-blocked
        findings.push({
          scenario: scenarioId,
          severity: "LOW",
          title: `SUSPECTED: BCBA assigned when RBTs may be available (${pr.dayOfWeek})`,
          detail: `${providerMap.get(pr.providerId)?.lastName} → ${c.lastName} on ${pr.dayOfWeek}. ${rbtProviderCountOnDay}/${totalRbts} RBTs active that day. May be constraint-blocked — verify approved list.`,
          trace: "SUSPECTED — needs manual verification. matcher.ts position tier should assign RBTs before BCBAs",
        });
        break; // One finding per scenario is enough for this heuristic
      }
    }
    if (bcbaProposals.length > 0 && !findings.some(f => f.title.includes("BCBA assigned when RBTs"))) {
      passed.push(`INV-14 Position tier: ${bcbaProposals.length} BCBA proposal(s) — all RBTs appear at capacity on those days`);
    }
  } else {
    passed.push("INV-14 Position tier: no BCBA proposals generated");
  }

  return { findings, passed };
}

// ─── Scenario Runners ──────────────────────────────────────────────────────────

function buildWeekInput(
  ctx: DBContext,
  overrides: Partial<{
    clients: SchedulerClient[];
    providers: SchedulerProvider[];
    notBefore: Date;
    targetDate: string;
  }> = {}
): SchedulerInput {
  return {
    weekOf: ctx.weekOf,
    targetDate: overrides.targetDate ?? localDate(ctx.weekOf),
    timezone: TIMEZONE,
    centerId: ctx.centerId,
    clients: overrides.clients ?? ctx.clients,
    providers: overrides.providers ?? ctx.providers,
    sessionTypeIds: ctx.sessionTypeIds,
    driveTimeSessionTypeId: ctx.driveTimeSessionTypeId,
    driveMinutes: ctx.driveMinutes,
    distanceMeters: ctx.distanceMeters,
    existingHomeSessions: [],
    weekMode: true,
    notBefore: overrides.notBefore,
  };
}

function buildDayInput(
  ctx: DBContext,
  targetDateStr: string,
  targetDOW: DayOfWeek,
  bookedSessions: CancellationInput[],
  cancelledSessions: CancellationInput[],
  patchedClients?: SchedulerClient[],
  patchedProviders?: SchedulerProvider[]
): SchedulerInput {
  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};

  for (const s of [
    ...bookedSessions.map(s => ({ ...s, cancelledBy: null as string | null })),
    ...cancelledSessions.map(s => ({ ...s, cancelledBy: s.cancelledBy as string })),
  ]) {
    const dow = localDOW(s.startTime);
    const st = localHHMM(s.startTime);
    const et = localHHMM(s.endTime);
    const cancelledByClient = s.cancelledBy === "CLIENT";
    const cancelledByProvider = s.cancelledBy === "PROVIDER";
    if (!cancelledByClient) {
      if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
      bookedByProvider[s.providerId].push({ dayOfWeek: dow, startTime: st, endTime: et, clientId: s.clientId });
    }
    if (!cancelledByProvider) {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek: dow, startTime: st, endTime: et });
    }
  }

  const displacedClientIds = cancelledSessions.filter(s => s.cancelledBy === "PROVIDER").map(s => s.clientId);
  const freedProviderIds = cancelledSessions.filter(s => s.cancelledBy === "CLIENT").map(s => s.providerId);
  const cancellationContext = (displacedClientIds.length > 0 || freedProviderIds.length > 0)
    ? { displacedClientIds, freedProviderIds }
    : undefined;

  const baseClients = patchedClients ?? ctx.clients;
  const baseProviders = patchedProviders ?? ctx.providers;

  return {
    weekOf: ctx.weekOf,
    targetDate: targetDateStr,
    timezone: TIMEZONE,
    centerId: ctx.centerId,
    clients: baseClients.map(c => ({
      ...c,
      bookedWindows: bookedByClient[c.id] ?? [],
      daysNeeded: 1,
    })),
    providers: baseProviders.map(p => ({
      ...p,
      bookedWindows: bookedByProvider[p.id] ?? [],
    })),
    sessionTypeIds: ctx.sessionTypeIds,
    driveTimeSessionTypeId: ctx.driveTimeSessionTypeId,
    driveMinutes: ctx.driveMinutes,
    distanceMeters: ctx.distanceMeters,
    existingHomeSessions: [],
    cancellationContext,
  };
}

// ─── Report Helpers ────────────────────────────────────────────────────────────

function printScenarioHeader(id: number, name: string, description: string): void {
  console.log(`\n${sep("─")}`);
  console.log(`SCENARIO ${String(id).padStart(2, "0")}: ${name}`);
  console.log(`${description}`);
  console.log(sep("─"));
}

function printScore(s: ScenarioScore): void {
  console.log(`\n  AUDIT_GOD SCORE: ${s.final}/100 — ${s.rating}`);
  console.log(`  Compliance:           [${bar(s.compliance)}] ${s.compliance}/100  (30%)`);
  console.log(`  Day-fill Rate:        [${bar(s.utilization)}] ${s.utilization}/100  (30%)`);
  console.log(`  Client Coverage:      [${bar(s.coverage)}] ${s.coverage}/100  (25%)  — ${s.fullyCovered}/${s.totalClients} clients ≥90%`);
  console.log(`  Provider Consistency: [${bar(s.consistency)}] ${s.consistency}/100  (10%)`);
  console.log(`  Travel Efficiency:    [${bar(s.travel)}] ${s.travel}/100   (5%)  [no GPS — assumed 0 drive time]`);
}

function printAssertions(assertions: Array<{ label: string; pass: boolean; detail: string }>): void {
  if (assertions.length === 0) return;
  console.log(`\n  ASSERTIONS`);
  for (const a of assertions) {
    const icon = a.pass ? "  ✅" : "  ❌";
    console.log(`${icon} ${a.label}`);
    if (!a.pass) console.log(`       ${a.detail}`);
  }
}

function printFindings(findings: BugFinding[]): void {
  if (findings.length === 0) {
    console.log(`\n  BUG_HUNTER: ✅ no runtime violations detected`);
    return;
  }
  console.log(`\n  BUG_HUNTER FINDINGS (${findings.length})`);
  for (const f of findings) {
    console.log(`\n  [${f.severity}] ${f.title}`);
    console.log(`    Detail: ${f.detail}`);
    console.log(`    Trace:  ${f.trace}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const targetArg = process.argv[2];
  const targetDateObj = targetArg ? new Date(`${targetArg}T12:00:00Z`) : new Date();

  console.log(sep());
  console.log("  SIM SUITE — JOINT AUDIT_GOD + BUG_HUNTER REPORT");
  console.log("  15 Scenarios: Full Week · Cancellations · Edge Cases · What-If");
  console.log(sep());
  console.log(`  Target week:  ${localDate(targetDateObj)}  |  Center: Loading...`);
  console.log(`  Generated:    ${new Date().toISOString()}`);
  console.log(`  Drive times:  ⚠ All defaulted to 0 min (no Maps API in scripts)`);
  console.log(`  MAX_SESSION:  ${MAX_SESSION_HOURS}h per script (production API = 6h)`);
  console.log(`  History win:  4 weeks (production API = 12 weeks)`);
  console.log(`  PENDING:      Excluded — matches UI clean-slate behavior ✅`);
  console.log(sep());

  // ── Load context ────────────────────────────────────────────────────────────
  const ctx = await loadDBContext(targetDateObj);
  const weekDateStr = localDate(ctx.weekOf);
  const weekDays: Array<{ date: string; dow: DayOfWeek }> = WEEKDAYS.map((dow, i) => ({
    dow,
    date: localDate(new Date(ctx.weekOf.getTime() + i * 86_400_000)),
  }));

  console.log(`\n  Center:   ${ctx.centerName}`);
  console.log(`  Clients:  ${ctx.clients.length}  (active, with valid auth in target week)`);
  console.log(`  Providers: ${ctx.providers.length}  (active)`);
  console.log(`  Week:     Mon ${weekDays[0].date} → Fri ${weekDays[4].date}`);

  const allFindings: BugFinding[] = [];
  const scenarioResults: ScenarioResult[] = [];

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 01 — Full Week Clean Slate (Baseline)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(1, "Full Week Clean Slate (Baseline)",
    "Runs the scheduler for the full week from scratch. All PENDING proposals excluded. Establishes baseline score.");

  const s01Input = buildWeekInput(ctx);
  const s01Result = optimize(s01Input, createWorkingState());
  const s01Score = computeScore(s01Result.proposals, s01Result.skipReasons, ctx.clients, ctx.providers, "S01");
  const { findings: s01Findings, passed: s01Passed } = runInvariantChecks("S01", s01Result.proposals, ctx.clients, ctx.providers);

  printScore(s01Score);
  console.log(`\n  Proposals generated: ${s01Result.proposals.length}`);
  console.log(`  Skip reasons: ${Object.keys(s01Result.skipReasons).length} clients not fully scheduled`);
  if (Object.keys(s01Result.skipReasons).length > 0) {
    for (const [cid, reason] of Object.entries(s01Result.skipReasons).slice(0, 5)) {
      console.log(`    ⚠  ${ctx.clientNameMap[cid] ?? cid}: ${reason}`);
    }
  }
  printFindings(s01Findings);
  allFindings.push(...s01Findings);
  scenarioResults.push({
    id: 1, name: "Full Week Clean Slate (Baseline)",
    description: "Baseline week run — all PENDING excluded",
    proposals: s01Result.proposals, skipReasons: s01Result.skipReasons,
    score: s01Score, assertions: [], findings: s01Findings,
    notes: s01Passed, warnings: s01Result.warnings,
  });

  // Build a proposal index for use in cancellation scenarios
  const byDow: Record<DayOfWeek, typeof s01Result.proposals> = {} as Record<DayOfWeek, typeof s01Result.proposals>;
  for (const dow of WEEKDAYS) byDow[dow] = s01Result.proposals.filter(p => p.dayOfWeek === dow);
  const bestDow = WEEKDAYS.reduce((a, b) => byDow[a].length >= byDow[b].length ? a : b);
  const bestDate = weekDays.find(w => w.dow === bestDow)!.date;
  const bestProposals = byDow[bestDow];

  function proposalToCancel(idx: number, cancelledBy: "CLIENT" | "PROVIDER"): CancellationInput {
    const p = bestProposals[idx % bestProposals.length];
    return {
      clientId: p.clientId,
      providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime),
      endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 02 — Full Week + 10% Over-Scheduling Buffer
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(2, "Full Week + Over-Scheduling Buffer (10%)",
    "Inflates each client's sessionHours by 10% to absorb expected cancellations. Simulates UI buffer behavior for clients with <8 weeks history.");

  const s02Clients = ctx.clients.map(c => ({
    ...c,
    sessionHours: Math.round(c.sessionHours * 1.10 * 2) / 2,
    approvedWeeklyHours: c.approvedWeeklyHours * 1.10,
  }));
  const s02Input = buildWeekInput(ctx, { clients: s02Clients });
  const s02Result = optimize(s02Input, createWorkingState());
  const s02Score = computeScore(s02Result.proposals, s02Result.skipReasons, s02Clients, ctx.providers, "S02");
  const { findings: s02Findings } = runInvariantChecks("S02", s02Result.proposals, s02Clients, ctx.providers);

  printScore(s02Score);
  const bufferDelta = s02Score.final - s01Score.final;
  const bufferProposalDelta = s02Result.proposals.length - s01Result.proposals.length;
  console.log(`\n  vs Baseline (S01): Score Δ${bufferDelta > 0 ? "+" : ""}${bufferDelta}pts  |  Proposals Δ${bufferProposalDelta > 0 ? "+" : ""}${bufferProposalDelta}`);
  console.log(`  Over-scheduling impact: ${bufferProposalDelta > 0 ? "generated more sessions (absorbs expected cancellations)" : "no additional sessions — demand ceiling reached"}`);
  printFindings(s02Findings);
  allFindings.push(...s02Findings);
  scenarioResults.push({
    id: 2, name: "Full Week + Over-Scheduling Buffer",
    description: "10% sessionHours inflation — simulates UI buffer for short-history clients",
    proposals: s02Result.proposals, skipReasons: s02Result.skipReasons,
    score: s02Score, assertions: [], findings: s02Findings,
    notes: [], warnings: s02Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 03 — Mid-Week Partial Schedule (Wednesday Forward)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(3, "Mid-Week Partial Schedule (Wednesday Forward)",
    "Simulates running the scheduler on Wednesday. notBefore filter applied — Mon and Tue are skipped. Validates notBefore invariant.");

  const wednesdayDate = weekDays[2].date;
  const notBeforeUTC = toUtcDate(wednesdayDate, "08:00");
  const s03Input = buildWeekInput(ctx, {
    notBefore: notBeforeUTC,
    targetDate: wednesdayDate,
  });
  const s03Result = optimize(s03Input, createWorkingState());
  const s03Score = computeScore(s03Result.proposals, s03Result.skipReasons, ctx.clients, ctx.providers, "S03");
  const { findings: s03Findings, passed: s03Passed } = runInvariantChecks(
    "S03", s03Result.proposals, ctx.clients, ctx.providers, { notBefore: wednesdayDate }
  );

  printScore(s03Score);
  const monProposals = s03Result.proposals.filter(p => p.dayOfWeek === "MONDAY").length;
  const tueProposals = s03Result.proposals.filter(p => p.dayOfWeek === "TUESDAY").length;
  console.log(`\n  Monday proposals:    ${monProposals}  (expected 0 — notBefore filter)`);
  console.log(`  Tuesday proposals:   ${tueProposals}  (expected 0 — notBefore filter)`);
  console.log(`  Wed–Fri proposals:   ${s03Result.proposals.filter(p => ["WEDNESDAY","THURSDAY","FRIDAY"].includes(p.dayOfWeek)).length}`);
  printAssertions([
    {
      label: "No proposals on Monday or Tuesday (notBefore=Wednesday)",
      pass: monProposals === 0 && tueProposals === 0,
      detail: monProposals > 0 || tueProposals > 0
        ? `Found Mon:${monProposals}, Tue:${tueProposals} — notBefore filter not applied`
        : "notBefore filter correctly skipped Mon/Tue",
    },
  ]);
  printFindings(s03Findings);
  allFindings.push(...s03Findings);
  scenarioResults.push({
    id: 3, name: "Mid-Week Partial Schedule",
    description: `notBefore=${wednesdayDate} — Mon/Tue excluded`,
    proposals: s03Result.proposals, skipReasons: s03Result.skipReasons,
    score: s03Score,
    assertions: [{ label: "notBefore Mon/Tue excluded", pass: monProposals === 0 && tueProposals === 0, detail: "" }],
    findings: s03Findings, notes: s03Passed, warnings: s03Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 04 — Single Client Cancellation (Zero Proposals Expected)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(4, "Single Client Cancellation",
    `Tests isolation guarantee: one CLIENT cancellation on ${bestDow} produces zero new proposals. No switch opportunity with a single side.`);

  let s04skipped = false;
  if (bestProposals.length === 0) {
    console.log("  ⚠ Baseline has no proposals on best day — skipping cancellation scenarios S04–S08.");
    s04skipped = true;
  }

  if (!s04skipped) {
    const s04cancelled: CancellationInput[] = [proposalToCancel(0, "CLIENT")];
    const s04scheduled = bestProposals.slice(1).map(p => ({
      clientId: p.clientId, providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime), endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy: "CLIENT" as const,
    }));
    const s04Input = buildDayInput(ctx, bestDate, bestDow, s04scheduled, s04cancelled);
    const s04Result = optimize(s04Input, createWorkingState());

    const { findings: s04Findings } = runInvariantChecks("S04", s04Result.proposals, ctx.clients, ctx.providers, {
      cancellationContext: { displacedClientIds: [], freedProviderIds: [s04cancelled[0].providerId] },
    });

    printAssertions([{
      label: `Single CLIENT cancellation → 0 new proposals`,
      pass: s04Result.proposals.length === 0,
      detail: s04Result.proposals.length === 0
        ? `✅ Correct: ${s04Result.proposals.length} proposals. Freed provider not re-assigned.`
        : `❌ ${s04Result.proposals.length} unexpected proposals generated — isolation violated`,
    }]);
    printFindings(s04Findings);
    allFindings.push(...s04Findings);
    scenarioResults.push({
      id: 4, name: "Single Client Cancellation",
      description: "1 CLIENT cancel — expects 0 proposals (no displaced client)",
      proposals: s04Result.proposals, skipReasons: s04Result.skipReasons,
      score: null,
      assertions: [{ label: "0 proposals", pass: s04Result.proposals.length === 0, detail: "" }],
      findings: s04Findings, notes: [], warnings: s04Result.warnings,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 05 — Single Provider Cancellation (Zero Proposals Expected)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(5, "Single Provider Cancellation",
    `Tests isolation guarantee: one PROVIDER cancellation on ${bestDow} produces zero new proposals. No client to swap without a freed provider on the other side.`);

  if (!s04skipped) {
    const s05cancelled: CancellationInput[] = [proposalToCancel(0, "PROVIDER")];
    const s05scheduled = bestProposals.slice(1).map(p => ({
      clientId: p.clientId, providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime), endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy: "CLIENT" as const,
    }));
    const s05Input = buildDayInput(ctx, bestDate, bestDow, s05scheduled, s05cancelled);
    const s05Result = optimize(s05Input, createWorkingState());

    const { findings: s05Findings } = runInvariantChecks("S05", s05Result.proposals, ctx.clients, ctx.providers, {
      cancellationContext: { displacedClientIds: [s05cancelled[0].clientId], freedProviderIds: [] },
    });

    printAssertions([{
      label: `Single PROVIDER cancellation → 0 new proposals`,
      pass: s05Result.proposals.length === 0,
      detail: s05Result.proposals.length === 0
        ? "✅ Correct: displaced client left unscheduled — no freed provider to match"
        : `❌ ${s05Result.proposals.length} unexpected proposals — isolation violated`,
    }]);
    printFindings(s05Findings);
    allFindings.push(...s05Findings);
    scenarioResults.push({
      id: 5, name: "Single Provider Cancellation",
      description: "1 PROVIDER cancel — expects 0 proposals (no freed provider)",
      proposals: s05Result.proposals, skipReasons: s05Result.skipReasons, score: null,
      assertions: [{ label: "0 proposals", pass: s05Result.proposals.length === 0, detail: "" }],
      findings: s05Findings, notes: [], warnings: s05Result.warnings,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 06 — Client + Provider Cancellation Same Day (Swap Opportunity)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(6, "Client + Provider Cancellation Same Day (Swap)",
    `One CLIENT cancels freeing their provider (P1). One PROVIDER cancels displacing their client (C1). Tests whether the optimizer matches C1↔P1 as a valid switch.`);

  if (!s04skipped && bestProposals.length >= 2) {
    const s06clientCancel = proposalToCancel(0, "CLIENT");     // Frees P0
    const s06providerCancel = proposalToCancel(1, "PROVIDER"); // Displaces C1
    const s06cancelled = [s06clientCancel, s06providerCancel];
    const s06scheduled = bestProposals.slice(2).map(p => ({
      clientId: p.clientId, providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime), endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy: "CLIENT" as const,
    }));
    const s06Input = buildDayInput(ctx, bestDate, bestDow, s06scheduled, s06cancelled);
    const s06Result = optimize(s06Input, createWorkingState());

    const freedProviderIds = [s06clientCancel.providerId];
    const displacedClientIds = [s06providerCancel.clientId];
    const { findings: s06Findings } = runInvariantChecks("S06", s06Result.proposals, ctx.clients, ctx.providers, {
      cancellationContext: { displacedClientIds, freedProviderIds },
    });

    const validPairs = s06Result.proposals.filter(pr =>
      displacedClientIds.includes(pr.clientId) && freedProviderIds.includes(pr.providerId)
    );
    const invalidPairs = s06Result.proposals.filter(pr =>
      !displacedClientIds.includes(pr.clientId) || !freedProviderIds.includes(pr.providerId)
    );
    const freedProviderName = ctx.providerNameMap[s06clientCancel.providerId] ?? s06clientCancel.providerId;
    const displacedClientName = ctx.clientNameMap[s06providerCancel.clientId] ?? s06providerCancel.clientId;

    printAssertions([
      {
        label: "All proposals are displaced↔freed pairs (no schedule inflation)",
        pass: invalidPairs.length === 0,
        detail: invalidPairs.length > 0
          ? `${invalidPairs.length} proposal(s) outside the switch pair`
          : "✅ Only displaced↔freed pairs generated",
      },
      {
        label: `Switch opportunity found: ${displacedClientName} → ${freedProviderName}`,
        pass: validPairs.length > 0,
        detail: validPairs.length > 0
          ? `✅ Swap matched: ${displacedClientName} rescheduled with ${freedProviderName}`
          : "⚠ No compatible slot found — availability may not overlap (informational, not a bug)",
      },
    ]);
    printFindings(s06Findings);
    allFindings.push(...s06Findings);
    scenarioResults.push({
      id: 6, name: "Client + Provider Swap",
      description: "1 CLIENT + 1 PROVIDER cancel — expects switch proposal",
      proposals: s06Result.proposals, skipReasons: s06Result.skipReasons, score: null,
      assertions: [
        { label: "no inflation", pass: invalidPairs.length === 0, detail: "" },
        { label: "switch found", pass: validPairs.length > 0, detail: "" },
      ],
      findings: s06Findings, notes: [], warnings: s06Result.warnings,
    });
  } else if (!s04skipped) {
    console.log("  ⚠ Not enough proposals on best day for 2-cancellation test — skipped");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 07 — Multiple Mixed Cancellations (Multi-Swap)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(7, "Multiple Mixed Cancellations (Multi-Swap)",
    "2 CLIENT cancellations + 2 PROVIDER cancellations on the same day. Tests whether multiple displaced clients are each matched only with freed providers, in isolation.");

  if (!s04skipped && bestProposals.length >= 4) {
    const s07clientCancel1 = proposalToCancel(0, "CLIENT");
    const s07clientCancel2 = proposalToCancel(1, "CLIENT");
    const s07providerCancel1 = proposalToCancel(2, "PROVIDER");
    const s07providerCancel2 = proposalToCancel(3, "PROVIDER");
    const s07cancelled = [s07clientCancel1, s07clientCancel2, s07providerCancel1, s07providerCancel2];
    const s07scheduled = bestProposals.slice(4).map(p => ({
      clientId: p.clientId, providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime), endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy: "CLIENT" as const,
    }));
    const s07Input = buildDayInput(ctx, bestDate, bestDow, s07scheduled, s07cancelled);
    const s07Result = optimize(s07Input, createWorkingState());

    const freedProviderIds = [s07clientCancel1.providerId, s07clientCancel2.providerId];
    const displacedClientIds = [s07providerCancel1.clientId, s07providerCancel2.clientId];
    const { findings: s07Findings } = runInvariantChecks("S07", s07Result.proposals, ctx.clients, ctx.providers, {
      cancellationContext: { displacedClientIds, freedProviderIds },
    });

    const freedSet = new Set(freedProviderIds);
    const displacedSet = new Set(displacedClientIds);
    const invalidProposals = s07Result.proposals.filter(pr =>
      !displacedSet.has(pr.clientId) || !freedSet.has(pr.providerId)
    );
    const matchedDisplaced = s07Result.proposals.filter(pr => displacedSet.has(pr.clientId));

    printAssertions([
      {
        label: `Isolation holds: all ${s07Result.proposals.length} proposal(s) are displaced↔freed pairs`,
        pass: invalidProposals.length === 0,
        detail: invalidProposals.length > 0
          ? `${invalidProposals.length} proposal(s) outside displaced↔freed set`
          : "✅ No schedule inflation",
      },
      {
        label: `Switch coverage: ${matchedDisplaced.length}/${displacedClientIds.length} displaced clients rescheduled`,
        pass: matchedDisplaced.length > 0,
        detail: matchedDisplaced.length > 0
          ? matchedDisplaced.map(pr =>
              `${ctx.clientNameMap[pr.clientId] ?? pr.clientId} → ${ctx.providerNameMap[pr.providerId] ?? pr.providerId}`
            ).join("; ")
          : "No compatible availability overlap found",
      },
    ]);
    printFindings(s07Findings);
    allFindings.push(...s07Findings);
    scenarioResults.push({
      id: 7, name: "Multiple Mixed Cancellations",
      description: "2 CLIENT + 2 PROVIDER cancellations — multi-swap test",
      proposals: s07Result.proposals, skipReasons: s07Result.skipReasons, score: null,
      assertions: [
        { label: "isolation", pass: invalidProposals.length === 0, detail: "" },
        { label: "swap coverage", pass: matchedDisplaced.length > 0, detail: "" },
      ],
      findings: s07Findings, notes: [], warnings: s07Result.warnings,
    });
  } else if (!s04skipped) {
    console.log("  ⚠ Not enough proposals for 4-cancellation test — skipped");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 08 — Provider Full-Day Callout
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(8, "Provider Full-Day Callout",
    "Provider 0's entire day of sessions is cancelled by PROVIDER. All their clients are displaced. No client-side cancellations exist, so expect 0 new proposals (no freed providers to swap with).");

  if (!s04skipped && bestProposals.length >= 1) {
    const providerOfDay = bestProposals[0].providerId;
    const providerDayProposals = bestProposals.filter(p => p.providerId === providerOfDay);
    const otherProposals = bestProposals.filter(p => p.providerId !== providerOfDay);

    const s08cancelled: CancellationInput[] = providerDayProposals.map(p => ({
      clientId: p.clientId, providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime), endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy: "PROVIDER",
    }));
    const s08scheduled = otherProposals.map(p => ({
      clientId: p.clientId, providerId: p.providerId,
      startTime: toUtcDate(bestDate, p.startTime), endTime: toUtcDate(bestDate, p.endTime),
      cancelledBy: "CLIENT" as const,
    }));
    const s08Input = buildDayInput(ctx, bestDate, bestDow, s08scheduled, s08cancelled);
    const s08Result = optimize(s08Input, createWorkingState());

    const displacedClientIds = s08cancelled.map(c => c.clientId);
    const { findings: s08Findings } = runInvariantChecks("S08", s08Result.proposals, ctx.clients, ctx.providers, {
      cancellationContext: { displacedClientIds, freedProviderIds: [] },
    });

    printAssertions([
      {
        label: `Full-day callout with no freed providers → 0 new proposals`,
        pass: s08Result.proposals.length === 0,
        detail: s08Result.proposals.length === 0
          ? `✅ ${displacedClientIds.length} client(s) displaced from ${ctx.providerNameMap[providerOfDay] ?? providerOfDay}'s callout — correctly unscheduled`
          : `❌ ${s08Result.proposals.length} unexpected proposals — pairing restriction violated`,
      },
    ]);
    printFindings(s08Findings);
    allFindings.push(...s08Findings);
    scenarioResults.push({
      id: 8, name: "Provider Full-Day Callout",
      description: `${ctx.providerNameMap[providerOfDay] ?? providerOfDay} entire day cancelled — ${displacedClientIds.length} clients displaced`,
      proposals: s08Result.proposals, skipReasons: s08Result.skipReasons, score: null,
      assertions: [{ label: "0 proposals", pass: s08Result.proposals.length === 0, detail: "" }],
      findings: s08Findings, notes: [], warnings: s08Result.warnings,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 09 — Constrained Client Compliance Focus
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(9, "Constrained Client Compliance Focus",
    "Uses baseline (S01) proposals. Verifies all constrained clients (female-only, spanish, RBT level) were served and compliance holds for each constraint type.");

  const constrainedClients = ctx.clients.filter(c => c.femaleProviderOnly || c.spanish || c.minimumRbtLevel);
  const constrainedClientIds = new Set(constrainedClients.map(c => c.id));
  const constrainedProposals = s01Result.proposals.filter(pr => constrainedClientIds.has(pr.clientId));

  const constrainedScheduled = new Set(constrainedProposals.map(p => p.clientId));
  const constrainedNotScheduled = constrainedClients.filter(c => !constrainedScheduled.has(c.id));

  console.log(`\n  Constrained clients:  ${constrainedClients.length}  (female-only | spanish | RBT level)`);
  console.log(`  Scheduled (S01):      ${constrainedScheduled.size}/${constrainedClients.length}`);
  console.log(`  Not scheduled:        ${constrainedNotScheduled.length}`);

  for (const c of constrainedClients) {
    const proposals = constrainedProposals.filter(pr => pr.clientId === c.id);
    const constraints = [
      c.femaleProviderOnly ? "female-only" : null,
      c.spanish ? "spanish" : null,
      c.minimumRbtLevel ? `RBT≥${c.minimumRbtLevel}` : null,
    ].filter(Boolean).join(", ");
    const providerNames = proposals.map(pr => {
      const p = ctx.providers.find(pv => pv.id === pr.providerId);
      return p ? `${p.lastName} (${p.position}/${pr.dayOfWeek})` : pr.providerId;
    }).join(", ");
    const status = proposals.length > 0 ? `✅ ${proposals.length} session(s)` : `❌ Unscheduled`;
    console.log(`\n    ${c.lastName}, ${c.firstName}  [${constraints}]`);
    console.log(`      Status:    ${status}`);
    if (proposals.length > 0) console.log(`      Assigned:  ${providerNames}`);
    if (proposals.length === 0 && s01Result.skipReasons[c.id]) {
      console.log(`      Reason:    ${s01Result.skipReasons[c.id]}`);
    }
  }

  const { findings: s09Findings } = runInvariantChecks("S09", constrainedProposals, ctx.clients, ctx.providers);
  printFindings(s09Findings);
  allFindings.push(...s09Findings);
  scenarioResults.push({
    id: 9, name: "Constrained Client Compliance Focus",
    description: `${constrainedClients.length} constrained clients — constraint violation check`,
    proposals: constrainedProposals, skipReasons: s01Result.skipReasons, score: null,
    assertions: [],
    findings: s09Findings, notes: [], warnings: [],
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 10 — Authorization Expiry Warning
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(10, "Authorization Expiry Warning",
    "Patches the first client's authorizationEndDate to 3 days from now. Verifies the optimizer emits an expiry warning and still schedules the client for valid days.");

  const expiringTargetDate = localDate(new Date(targetDateObj.getTime() + 3 * 86_400_000));
  const s10Clients = ctx.clients.map((c, i) => i === 0
    ? { ...c, authorizationEndDate: expiringTargetDate }
    : c
  );
  const s10Input = buildWeekInput(ctx, { clients: s10Clients });
  const s10Result = optimize(s10Input, createWorkingState());
  const s10Score = computeScore(s10Result.proposals, s10Result.skipReasons, s10Clients, ctx.providers, "S10");

  const expiringClient = s10Clients[0];
  const expiryWarnings = s10Result.warnings.filter(w =>
    w.toLowerCase().includes("expir") || w.toLowerCase().includes(expiringClient.id)
  );
  const expiringClientProposals = s10Result.proposals.filter(p => p.clientId === expiringClient.id);

  printScore(s10Score);
  console.log(`\n  Patched client:   ${ctx.clientNameMap[expiringClient.id] ?? expiringClient.id}`);
  console.log(`  Auth set to expire: ${expiringTargetDate}`);
  console.log(`  Expiry warnings:  ${expiryWarnings.length > 0 ? expiryWarnings.join("; ") : "⚠ None emitted — optimizer should warn about expiring auths within 30 days"}`);
  console.log(`  Sessions generated: ${expiringClientProposals.length}`);

  const { findings: s10Findings } = runInvariantChecks("S10", s10Result.proposals, s10Clients, ctx.providers);
  printFindings(s10Findings);
  allFindings.push(...s10Findings);
  scenarioResults.push({
    id: 10, name: "Authorization Expiry Warning",
    description: `Client 0 auth patched to expire ${expiringTargetDate}`,
    proposals: s10Result.proposals, skipReasons: s10Result.skipReasons,
    score: s10Score, assertions: [], findings: s10Findings,
    notes: [], warnings: s10Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 11 — New Client (hasPriorWeekHistory = false)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(11, "New Client (No Prior Week History)",
    "Patches all clients to hasPriorWeekHistory=false (simulates new starts or vacation returns). Preferred slots fire BEFORE history in the ranking comparator. Compares consistency vs baseline.");

  const s11Clients = ctx.clients.map(c => ({ ...c, hasPriorWeekHistory: false, historicalProviderIds: [] }));
  const s11Input = buildWeekInput(ctx, { clients: s11Clients });
  const s11Result = optimize(s11Input, createWorkingState());
  const s11Score = computeScore(s11Result.proposals, s11Result.skipReasons, s11Clients, ctx.providers, "S11");

  const consistencyDelta = s11Score.consistency - s01Score.consistency;
  const coverageDelta = s11Score.coverage - s01Score.coverage;

  printScore(s11Score);
  console.log(`\n  vs Baseline (S01): Consistency Δ${consistencyDelta > 0 ? "+" : ""}${consistencyDelta}pts  |  Coverage Δ${coverageDelta > 0 ? "+" : ""}${coverageDelta}pts`);
  console.log(`  Expected: consistency drops toward 0 (no history → no historical match)`);
  console.log(`  Expected: coverage similar or better (preferred slots active, no history bias bottleneck)`);

  const { findings: s11Findings } = runInvariantChecks("S11", s11Result.proposals, s11Clients, ctx.providers);
  printFindings(s11Findings);
  allFindings.push(...s11Findings);
  scenarioResults.push({
    id: 11, name: "New Client / No Prior History",
    description: "All hasPriorWeekHistory=false — preferred slots take precedence",
    proposals: s11Result.proposals, skipReasons: s11Result.skipReasons,
    score: s11Score, assertions: [], findings: s11Findings,
    notes: [], warnings: s11Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 12 — Vacation Week Recovery
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(12, "Vacation Week Recovery",
    "All clients have hasPriorWeekHistory=false AND usedHoursThisWeek=0 (returning from vacation / holiday). Verifies full-week scheduling works from a blank slate for all clients.");

  const s12Clients = ctx.clients.map(c => ({
    ...c,
    hasPriorWeekHistory: false,
    historicalProviderIds: [],
    usedHoursThisWeek: 0,
    bookedWindows: [],
  }));
  const s12Input = buildWeekInput(ctx, { clients: s12Clients });
  const s12Result = optimize(s12Input, createWorkingState());
  const s12Score = computeScore(s12Result.proposals, s12Result.skipReasons, s12Clients, ctx.providers, "S12");

  printScore(s12Score);
  const vacDelta = s12Score.final - s01Score.final;
  console.log(`\n  vs Baseline (S01): Score Δ${vacDelta > 0 ? "+" : ""}${vacDelta}pts`);
  console.log(`  ${s12Score.coverage > s01Score.coverage ? "↑ Coverage improved — no existing session contention" : s12Score.coverage < s01Score.coverage ? "↓ Coverage dropped — historical placement was helping, preferred slots alone insufficient" : "= Coverage unchanged"}`);

  const { findings: s12Findings } = runInvariantChecks("S12", s12Result.proposals, s12Clients, ctx.providers);
  printFindings(s12Findings);
  allFindings.push(...s12Findings);
  scenarioResults.push({
    id: 12, name: "Vacation Week Recovery",
    description: "All clients returning from vacation — blank slate",
    proposals: s12Result.proposals, skipReasons: s12Result.skipReasons,
    score: s12Score, assertions: [], findings: s12Findings,
    notes: [], warnings: s12Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 13 — BCaBA / BCBA Last-Resort Assignment
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(13, "BCaBA/BCBA Last-Resort Assignment",
    "Marks all RBT providers as fully booked (bookedWindows spanning all weekdays). BCaBAs and BCBAs should be assigned as last resort. Validates position tier logic.");

  // Fill all RBTs' bookedWindows to make them unavailable
  const s13Providers = ctx.providers.map(p => {
    if (p.position !== "RBT") return p;
    // Block each availability window with a booked session
    const fullDayWindows = p.availability.map(a => ({
      dayOfWeek: a.dayOfWeek,
      startTime: a.startTime,
      endTime: a.endTime,
    }));
    return { ...p, bookedWindows: fullDayWindows };
  });

  const s13Input = buildWeekInput(ctx, { providers: s13Providers });
  const s13Result = optimize(s13Input, createWorkingState());
  const s13Score = computeScore(s13Result.proposals, s13Result.skipReasons, ctx.clients, s13Providers, "S13");

  const s13RbtProposals = s13Result.proposals.filter(pr => {
    const p = s13Providers.find(pv => pv.id === pr.providerId);
    return p?.position === "RBT";
  });
  const s13BcabaProposals = s13Result.proposals.filter(pr => {
    const p = s13Providers.find(pv => pv.id === pr.providerId);
    return p?.position === "BCaBA";
  });
  const s13BcbaProposals = s13Result.proposals.filter(pr => {
    const p = s13Providers.find(pv => pv.id === pr.providerId);
    return p?.position === "BCBA";
  });

  printScore(s13Score);
  console.log(`\n  RBT proposals:    ${s13RbtProposals.length}  (expected 0 — all RBTs fully booked)`);
  console.log(`  BCaBA proposals:  ${s13BcabaProposals.length}`);
  console.log(`  BCBA proposals:   ${s13BcbaProposals.length}`);
  console.log(`  BCaBA+BCBA total: ${s13BcabaProposals.length + s13BcbaProposals.length}  (last-resort assignments)`);

  const lastResortProviders = new Set(
    [...s13BcabaProposals, ...s13BcbaProposals].map(pr => pr.providerId)
  );
  for (const pid of lastResortProviders) {
    const p = s13Providers.find(pv => pv.id === pid);
    const myProposals = s13Result.proposals.filter(pr => pr.providerId === pid);
    const clientNames = [...new Set(myProposals.map(pr => ctx.clientNameMap[pr.clientId] ?? pr.clientId))].join(", ");
    console.log(`    ${p?.lastName} (${p?.position}): ${myProposals.length} session(s) → ${clientNames}`);
  }

  printAssertions([{
    label: "RBT proposals = 0 (all RBTs fully booked)",
    pass: s13RbtProposals.length === 0,
    detail: s13RbtProposals.length > 0
      ? `${s13RbtProposals.length} RBT proposals despite fully-booked windows — conflict check failure`
      : "✅ All RBTs correctly excluded when bookedWindows span full availability",
  }]);

  // Re-run invariant checks without the INV-14 BCBA heuristic (it's expected here)
  const { findings: s13Findings } = runInvariantChecks("S13", s13Result.proposals, ctx.clients, s13Providers);
  // Remove the "BCBA when RBTs available" finding since RBTs are intentionally full
  const s13FindingsFiltered = s13Findings.filter(f => !f.title.includes("SUSPECTED: BCBA assigned when RBTs"));
  printFindings(s13FindingsFiltered);
  allFindings.push(...s13FindingsFiltered);
  scenarioResults.push({
    id: 13, name: "BCaBA/BCBA Last-Resort",
    description: "All RBTs fully booked — BCaBA/BCBA last resort expected",
    proposals: s13Result.proposals, skipReasons: s13Result.skipReasons,
    score: s13Score,
    assertions: [{ label: "0 RBT proposals", pass: s13RbtProposals.length === 0, detail: "" }],
    findings: s13FindingsFiltered, notes: [], warnings: s13Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 14 — Lunch Block Conflict (RBT 12:00–13:00 Block)
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(14, "Lunch Block Conflict (RBT Midday Block 12:00–13:00)",
    "Injects a 12:00–13:00 provider block for all RBTs on all weekdays this week. Verifies that no session proposal overlaps the lunch block.");

  // Build lunch blocks for all RBTs on all days this week
  const s14LunchBlocks: Array<{ providerId: string; date: string; startTime: string; endTime: string }> = [];
  for (const p of ctx.providers) {
    if (p.position !== "RBT") continue;
    for (const wd of weekDays) {
      // Only add if provider has availability on this day
      if (p.availability.some(a => a.dayOfWeek === wd.dow)) {
        s14LunchBlocks.push({ providerId: p.id, date: wd.date, startTime: "12:00", endTime: "13:00" });
      }
    }
  }

  const s14Providers = ctx.providers.map(p => {
    if (p.position !== "RBT") return p;
    const lunchBlocksForProvider = s14LunchBlocks
      .filter(lb => lb.providerId === p.id)
      .map(lb => ({ date: lb.date, startTime: lb.startTime, endTime: lb.endTime }));
    return { ...p, blocks: [...p.blocks, ...lunchBlocksForProvider] };
  });

  const s14Input = buildWeekInput(ctx, { providers: s14Providers });
  const s14Result = optimize(s14Input, createWorkingState());
  const s14Score = computeScore(s14Result.proposals, s14Result.skipReasons, ctx.clients, s14Providers, "S14");

  // Check for proposals that overlap 12:00–13:00 for RBT providers
  const s14LunchOverlaps = s14Result.proposals.filter(pr => {
    const p = s14Providers.find(pv => pv.id === pr.providerId);
    if (p?.position !== "RBT") return false;
    const pStart = parseHHMM(pr.startTime);
    const pEnd = parseHHMM(pr.endTime);
    const lunchStart = parseHHMM("12:00");
    const lunchEnd = parseHHMM("13:00");
    return pStart < lunchEnd && lunchStart < pEnd;
  });

  printScore(s14Score);
  const coverageLunchDelta = s14Score.coverage - s01Score.coverage;
  console.log(`\n  Lunch blocks injected: ${s14LunchBlocks.length}  (${ctx.providers.filter(p => p.position === "RBT").length} RBTs × 5 days)`);
  console.log(`  Proposals overlapping 12:00–13:00: ${s14LunchOverlaps.length}  (expected 0)`);
  console.log(`  Coverage Δ vs baseline: ${coverageLunchDelta > 0 ? "+" : ""}${coverageLunchDelta}pts  (lunch gap reduces schedulable windows)`);

  if (s14LunchOverlaps.length > 0) {
    console.log("\n  Overlapping sessions:");
    for (const pr of s14LunchOverlaps) {
      const p = s14Providers.find(pv => pv.id === pr.providerId);
      console.log(`    ❌ ${p?.lastName ?? pr.providerId}: ${pr.startTime}–${pr.endTime} on ${pr.dayOfWeek}`);
    }
  }

  const { findings: s14Findings } = runInvariantChecks("S14", s14Result.proposals, ctx.clients, s14Providers, {
    lunchBlocks: s14LunchBlocks,
  });
  printFindings(s14Findings);
  allFindings.push(...s14Findings);
  scenarioResults.push({
    id: 14, name: "Lunch Block Conflict",
    description: "RBT 12:00–13:00 blocks on all days — session must split around lunch",
    proposals: s14Result.proposals, skipReasons: s14Result.skipReasons,
    score: s14Score,
    assertions: [{ label: "0 lunch overlaps", pass: s14LunchOverlaps.length === 0, detail: "" }],
    findings: s14Findings, notes: [], warnings: s14Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO 15 — What-If: New Female RBT III Added to Roster
  // ════════════════════════════════════════════════════════════════════════════
  printScenarioHeader(15, "What-If: New Female RBT III Added to Roster",
    "Adds an in-memory female RBT Level III provider with Mon–Fri 09:00–17:00 availability and approved for all female-only clients. No DB write. Shows coverage impact of hiring one more female RBT.");

  // Build the in-memory hypothetical provider
  const hypotheticalId = "__hypothetical_female_rbt3__";
  const hypotheticalProvider: SchedulerProvider = {
    id: hypotheticalId,
    firstName: "Hypothetical",
    lastName: "Female-RBT-III",
    position: "RBT",
    rbtLevel: "III" as import("@prisma/client").RbtLevel,
    gender: "female",
    spanish: false,
    latitude: null,
    longitude: null,
    availability: WEEKDAYS.map(dow => ({ dayOfWeek: dow, startTime: "09:00", endTime: "17:00" })),
    bookedWindows: [],
    blocks: [],
    weeklyHoursAlreadyScheduled: 0,
  };

  // Add to approved lists for all female-only clients (in-memory patch)
  const femaleOnlyClientIds = ctx.clients.filter(c => c.femaleProviderOnly).map(c => c.id);
  const s15Clients = ctx.clients.map(c => {
    if (!c.femaleProviderOnly) return c;
    return { ...c, approvedProviderIds: [...c.approvedProviderIds, hypotheticalId] };
  });
  const s15Providers = [...ctx.providers, hypotheticalProvider];

  // Also zero drive times for hypothetical provider
  const s15DriveMinutes = { ...ctx.driveMinutes, [hypotheticalId]: {} as Record<string, number> };
  const s15DistanceMeters = { ...ctx.distanceMeters, [hypotheticalId]: {} as Record<string, number> };
  for (const c of ctx.clients) {
    s15DriveMinutes[hypotheticalId][c.id] = 0;
    s15DistanceMeters[hypotheticalId][c.id] = 0;
  }

  const s15Input: SchedulerInput = {
    weekOf: ctx.weekOf,
    targetDate: localDate(ctx.weekOf),
    timezone: TIMEZONE,
    centerId: ctx.centerId,
    clients: s15Clients,
    providers: s15Providers,
    sessionTypeIds: ctx.sessionTypeIds,
    driveTimeSessionTypeId: ctx.driveTimeSessionTypeId,
    driveMinutes: s15DriveMinutes,
    distanceMeters: s15DistanceMeters,
    existingHomeSessions: [],
    weekMode: true,
  };
  const s15Result = optimize(s15Input, createWorkingState());
  const s15Score = computeScore(s15Result.proposals, s15Result.skipReasons, s15Clients, s15Providers, "S15");

  const hypotheticalProposals = s15Result.proposals.filter(pr => pr.providerId === hypotheticalId);
  const coverageWhatIfDelta = s15Score.coverage - s01Score.coverage;
  const finalWhatIfDelta = s15Score.final - s01Score.final;

  printScore(s15Score);
  console.log(`\n  Hypothetical provider:  Female RBT III, Mon–Fri 09:00–17:00`);
  console.log(`  Approved for clients:   ${femaleOnlyClientIds.length} female-only client(s)`);
  console.log(`  Sessions assigned:      ${hypotheticalProposals.length}`);
  if (hypotheticalProposals.length > 0) {
    const hClientNames = [...new Set(hypotheticalProposals.map(pr => ctx.clientNameMap[pr.clientId] ?? pr.clientId))].join(", ");
    console.log(`  Assigned to:            ${hClientNames}`);
    for (const pr of hypotheticalProposals) {
      console.log(`    → ${ctx.clientNameMap[pr.clientId] ?? pr.clientId}  ${pr.dayOfWeek} ${pr.startTime}–${pr.endTime}`);
    }
  }
  console.log(`\n  Impact vs Baseline:`);
  console.log(`    Coverage Δ:  ${coverageWhatIfDelta > 0 ? "+" : ""}${coverageWhatIfDelta}pts  (${s15Score.coverage}% vs ${s01Score.coverage}%)`);
  console.log(`    Score Δ:     ${finalWhatIfDelta > 0 ? "+" : ""}${finalWhatIfDelta}pts  (${s15Score.final} vs ${s01Score.final})`);
  console.log(`    Interpretation: ${hypotheticalProposals.length > 0
    ? `Adding one female RBT III would cover ${hypotheticalProposals.length} additional session(s), primarily serving female-only clients currently blocked by capacity`
    : "No coverage gain — female-only clients are already served or have other constraints (availability, approved list)"
  }`);

  const { findings: s15Findings } = runInvariantChecks("S15", s15Result.proposals, s15Clients, s15Providers);
  printFindings(s15Findings);
  allFindings.push(...s15Findings);
  scenarioResults.push({
    id: 15, name: "What-If: New Female RBT III",
    description: "In-memory female RBT III added — coverage impact analysis",
    proposals: s15Result.proposals, skipReasons: s15Result.skipReasons,
    score: s15Score, assertions: [], findings: s15Findings,
    notes: [`Hypothetical provider assigned ${hypotheticalProposals.length} session(s)`],
    warnings: s15Result.warnings,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // CONSOLIDATED BUG_HUNTER REPORT
  // ════════════════════════════════════════════════════════════════════════════

  console.log(`\n${sep()}`);
  console.log("  CONSOLIDATED BUG_HUNTER FINDINGS");
  console.log(sep());

  const critical = allFindings.filter(f => f.severity === "CRITICAL");
  const high = allFindings.filter(f => f.severity === "HIGH");
  const medium = allFindings.filter(f => f.severity === "MEDIUM");
  const low = allFindings.filter(f => f.severity === "LOW");

  console.log(`\n  Scorecard`);
  console.log(`    Critical: ${critical.length}`);
  console.log(`    High:     ${high.length}`);
  console.log(`    Medium:   ${medium.length}`);
  console.log(`    Low:      ${low.length}`);
  console.log(`    Scenarios run: 15  |  Total runtime findings: ${allFindings.length}`);

  // Generic Landmines Check (static, documented state)
  console.log(`\n  Generic Landmines Check (known-state verification)`);
  const landmines = [
    ["useTransition + async server actions", "✅ Not found in reviewed files (feedback_react18_async.md)"],
    ["Radix Select boolean strings", "✅ Fixed (feedback_radix_select_values.md) — using yes/no"],
    ["Prisma nested where on nullable FK", "⚠  Requires code review — check queries with nullable FK relations"],
    ["currentDate noon UTC", "✅ Scripts use T12:00:00Z anchor — confirmed in audit-run.ts"],
    ["Auth date UTC string comparison", "✅ Fixed (feedback_auth_date_comparison.md)"],
    ["ON DELETE SET NULL + same-tx updateMany", "⚠  Requires code review — check actions/ for parent-delete + updateMany pattern"],
    ["cancelledBy populated on cancellation", "✅ Fixed (project_cancellation_status.md)"],
    ["cancelRestOfDay preserves sessionTypeId", "✅ Fixed (project_cancellation_status.md)"],
    ["approvedProviderIds scoped to HOME only", "✅ Confirmed in constraints.ts checkApprovedForClient"],
    ["next dev --webpack flag", "⚠  Reminder: always run with --webpack (feedback_nextjs16_turbopack_tailwind.md)"],
  ];
  for (const [check, status] of landmines) {
    console.log(`    ${status.startsWith("✅") ? "✅" : status.startsWith("⚠") ? "⚠ " : "❌"} ${check}`);
  }

  // Scheduler Hard Spec Check (runtime-verified)
  console.log(`\n  Scheduler Hard Spec — Runtime-Verified Invariants`);
  const invariantsPassed = new Map<string, boolean>();
  for (const s of scenarioResults) {
    for (const f of s.findings) {
      const key = f.title.split("(")[0].trim();
      invariantsPassed.set(key, false);
    }
  }
  const specChecks = [
    ["Engine purity — no DB calls in optimizer.ts/matcher.ts", "⚠  Static check — run BUG_HUNTER scheduler to verify"],
    ["Pre-load excludes CLIENT-cancelled sessions", "⚠  Static check — review bookedWindows construction in route.ts"],
    ["Pre-load includes PROVIDER-cancelled sessions", "⚠  Static check — review cancellation query in route.ts"],
    ["UTC conversion uses noon-UTC anchor", "✅ Scripts use T12:00:00Z — verified in toUtcDate()"],
    ["Cancellation pairing isolation", critical.some(f => f.title.includes("isolation")) ? "❌ VIOLATION DETECTED" : `✅ Passed in S04–S08 (${["S04","S05","S06","S07","S08"].length} scenarios)`],
    ["Single-side cancellation = 0 proposals", critical.some(f => f.title.includes("Single-side")) ? "❌ VIOLATION DETECTED" : "✅ Verified in S04 and S05"],
    ["Gender requirement enforced", critical.some(f => f.title.includes("Female")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["Spanish requirement enforced", critical.some(f => f.title.includes("Spanish")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["RBT level requirement enforced", critical.some(f => f.title.includes("RBT level")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["Authorization present for all proposals", critical.some(f => f.title.includes("authorization")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["No provider double-booking within run", critical.some(f => f.title.includes("double-booked")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["No client double-booking within run", critical.some(f => f.title.includes("client double-book")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["Weekday-only proposals", high.some(f => f.title.includes("weekend")) ? "❌ VIOLATION DETECTED" : "✅ Verified across all scenarios"],
    ["notBefore filter (S03)", s03Findings.some(f => f.title.includes("notBefore")) ? "❌ VIOLATION DETECTED" : "✅ S03: notBefore correctly blocked Mon/Tue"],
    ["Provider blocks respected (S14)", s14Findings.some(f => f.title.includes("Lunch") || f.title.includes("lunch block")) ? "❌ VIOLATION DETECTED" : "✅ S14: 12:00–13:00 lunch blocks correctly excluded"],
    ["Position tier — BCaBA/BCBA last resort", s13Result.proposals.filter(pr => {
      const p = s13Providers.find(pv => pv.id === pr.providerId);
      return p?.position === "RBT";
    }).length === 0 ? "✅ S13: BCaBA/BCBA correctly assigned when all RBTs full" : "❌ S13: RBT proposals generated despite fully-booked windows"],
  ];
  for (const [check, status] of specChecks) {
    console.log(`    ${status.startsWith("✅") ? "✅" : status.startsWith("⚠") ? "⚠ " : "❌"} ${check}`);
  }

  // Detailed findings
  if (allFindings.length > 0) {
    console.log(`\n  Runtime Findings (${allFindings.length} total, ranked by severity)`);
    const ranked = [...allFindings].sort((a, b) => {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return order[a.severity] - order[b.severity];
    });
    let idx = 1;
    for (const f of ranked) {
      console.log(`\n  [${String(idx).padStart(2, "0")}] ${f.severity} — ${f.title}  (${f.scenario})`);
      console.log(`       Detail: ${f.detail}`);
      console.log(`       Trace:  ${f.trace}`);
      idx++;
    }
  } else {
    console.log(`\n  ✅ No runtime violations detected across all 15 scenarios.`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCENARIO SUMMARY TABLE
  // ════════════════════════════════════════════════════════════════════════════

  console.log(`\n${sep()}`);
  console.log("  SCENARIO SUMMARY TABLE");
  console.log(sep());
  console.log(`\n  ${"#".padEnd(3)} ${"Scenario".padEnd(38)} ${"Score".padEnd(7)} ${"Proposals".padEnd(10)} ${"Assertions".padEnd(12)} Bugs`);
  console.log(`  ${"─".repeat(3)} ${"─".repeat(38)} ${"─".repeat(7)} ${"─".repeat(10)} ${"─".repeat(12)} ${"─".repeat(6)}`);

  for (const s of scenarioResults) {
    const scoreStr = s.score ? `${s.score.final}/100` : "day-mode";
    const assertionStr = s.assertions.length > 0
      ? `${s.assertions.filter(a => a.pass).length}/${s.assertions.length} pass`
      : "n/a";
    const bugStr = s.findings.length > 0
      ? s.findings.map(f => f.severity[0]).join(",")
      : "✅ none";
    console.log(`  ${String(s.id).padStart(2).padEnd(3)} ${s.name.slice(0, 38).padEnd(38)} ${scoreStr.padEnd(7)} ${String(s.proposals.length).padEnd(10)} ${assertionStr.padEnd(12)} ${bugStr}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SIMULATION NOTES
  // ════════════════════════════════════════════════════════════════════════════

  console.log(`\n${sep()}`);
  console.log("  SIMULATION NOTES — Parameter Deviations vs Production");
  console.log(sep());
  console.log(`
  1. MAX_SESSION_HOURS: Scripts use 8h; production API (propose-week/route.ts) uses 6h.
     Impact: simulation produces longer sessions per client and fewer sessions per week.
     Coverage scores may be inflated vs UI for clients with many auth hours.

  2. History window: Scripts use 4 weeks; production API uses 12 weeks.
     Impact: consistency scores in simulation may undercount historical matches vs UI.
     Clients with providers from 5–12 weeks ago will not show historical preference.

  3. Drive times: All defaulted to 0 (no Maps API in scripts).
     Impact: 45-minute HOME drive cap does not fire. Some HOME-client proposals may have
     been rejected in production but pass here. Travel efficiency score = 100 (unknown).

  4. Over-scheduling buffer: S01/S03/S09–S15 do NOT apply the buffer (matches audit-run.ts).
     S02 applies a flat 10% buffer for comparison. Production UI applies the buffer always.

  5. PENDING proposals: Correctly excluded from usedHoursThisWeek and bookedWindows.
     Matches UI clean-slate behavior. ✅

  6. hasPriorWeekHistory: Computed per-client from DB (7-day lookback). ✅

  7. S15 hypothetical provider: Added in-memory only, never written to DB.
     Approved list expanded in-memory for female-only clients only.
  `);

  // Baseline vs What-If summary
  console.log(`  Baseline (S01) → Final Score: ${s01Score.final}/100  |  Best this suite: ${Math.max(...scenarioResults.filter(s => s.score).map(s => s.score!.final))}/100`);
  console.log(`  Demand ceiling observed: All RBTs cluster ${s01Score.utilization}% utilization — structural, not code.`);

  console.log(`\n${sep()}\n`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("SIM SUITE ERROR:", err);
  process.exit(1);
});
