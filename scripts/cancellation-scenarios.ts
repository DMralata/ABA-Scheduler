/**
 * Cancellation Scenario Validation — AUDIT_GOD Protocol
 *
 * Tests the 4 cancellation scenario types against real scheduling data:
 *
 *   Type A (3 runs) — Single CLIENT cancellation
 *       Guarantee: 0 new proposals generated. Nothing else changes.
 *
 *   Type B (3 runs) — Single PROVIDER cancellation
 *       Guarantee: 0 new proposals generated. Nothing else changes.
 *
 *   Type C (3 runs) — Switch opportunity: same provider (Client A cancels on P, P cancels on B)
 *       Guarantee: B gets scheduled with P. No other new proposals.
 *
 *   Type D (3 runs) — Switch opportunity: different providers (Client cancels on P1, P2 cancels on Client B)
 *       Guarantee: B gets scheduled with P1 (if compatible). No other new proposals.
 *
 *   Type E (bonus) — Multiple mixed cancellations (≥2 displaced, ≥2 freed)
 *       Guarantee: All displaced clients matched only with freed providers. No inflation.
 *
 * Safe to run: uses the pure optimize() function, zero DB writes.
 * All assertions are checked and surfaced in a structured AUDIT_GOD report.
 *
 * Usage:
 *   npx tsx scripts/cancellation-scenarios.ts [YYYY-MM-DD]
 */

import { PrismaClient, DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type { SchedulerInput, SchedulerClient, SchedulerProvider } from "../src/lib/scheduler/types";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();
const CENTER_ID = "cmn56xpu90000wt7v2o7v0jnm";
const TIMEZONE = "America/New_York";
const WEEKDAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DAILY_MAX_HOURS = 8.0;
const MIN_BILLABLE_HOURS = 1.5;

// ─── Utilities ─────────────────────────────────────────────────────────────────

function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function localDayOfWeek(d: Date): DayOfWeek {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "long" })
    .format(d).toUpperCase() as DayOfWeek;
}

function localHHMM(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function sessionHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type ScenarioType = "A_CLIENT_ONLY" | "B_PROVIDER_ONLY" | "C_SAME_PROVIDER_SWITCH" | "D_DIFF_PROVIDER_SWITCH" | "E_MULTI_MIXED" | "F_SYSTEMATIC";

interface CancellationInput {
  providerId: string;
  clientId: string;
  startTime: Date;
  endTime: Date;
  cancelledBy: "CLIENT" | "PROVIDER";
}

interface ScenarioResult {
  runIndex: number;
  type: ScenarioType;
  targetDay: string;
  dayOfWeek: DayOfWeek;
  cancellations: Array<{ who: string; clientName: string; providerName: string; hours: number }>;
  cancellationContext: { freedProviderIds: string[]; displacedClientIds: string[] };
  baselineProposalCount: number;
  outputProposals: Array<{ clientId: string; providerId: string; startTime: string; endTime: string }>;
  assertions: Array<{ label: string; pass: boolean; detail: string }>;
  pass: boolean;
  notes: string[];
}

// ─── DB Loader ─────────────────────────────────────────────────────────────────

interface DBContext {
  clients: Array<{
    id: string; firstName: string; lastName: string;
    latitude: number | null; longitude: number | null;
    minimumRbtLevel: string | null; femaleProviderOnly: boolean; spanish: boolean;
    preferredLocation: string; defaultSessionHours: number | null;
    sessionHours: number;
    daysNeeded: number;
    availability: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>;
    approvedProviderIds: string[];
    authorizationId: string | null; approvedWeeklyHours: number; usedHoursThisWeek: number;
    authorizationEndDate: string | null;
    historicalProviderIds: string[];
    hasPriorWeekHistory: boolean;
    blocks: Array<{ date: string; startTime: string; endTime: string }>;
    bookedWindows: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string }>;
  }>;
  providers: Array<{
    id: string; firstName: string; lastName: string;
    position: string; rbtLevel: string | null; gender: string | null; spanish: boolean;
    latitude: number | null; longitude: number | null;
    availability: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>;
    blocks: Array<{ date: string; startTime: string; endTime: string }>;
    weeklyHoursAlreadyScheduled: number;
    bookedWindows: Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string }>;
  }>;
  sessionTypeIds: { CENTER: string; HOME: string; SCHOOL: string };
  driveTimeSessionTypeId: string | null;
  weekOf: Date;
  weekStart: Date;
  weekEnd: Date;
  driveMinutes: Record<string, Record<string, number>>;
  distanceMeters: Record<string, Record<string, number>>;
  clientNameMap: Record<string, string>;
  providerNameMap: Record<string, string>;
}

async function loadDBContext(targetDate: Date): Promise<DBContext> {
  const { weekStart, weekEnd } = getWeekBoundaries(targetDate, TIMEZONE);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000);

  const [centerST, homeST, driveTimeST, center] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
    prisma.center.findUnique({ where: { id: CENTER_ID } }),
  ]);

  if (!centerST) throw new Error("No billable session type found");
  const sessionTypeIds = { CENTER: centerST.id, HOME: homeST?.id ?? centerST.id, SCHOOL: centerST.id };
  const driveTimeSessionTypeId = driveTimeST?.id ?? null;
  const defaultSessHours = center?.defaultSessionHours ?? 4.0;

  const [rawClients, allAuths, rawProviders, priorSessionsRaw] = await Promise.all([
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
      where: { startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
      orderBy: { startDate: "desc" },
      select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
    }),
    prisma.provider.findMany({
      where: { OR: [{ centerId: CENTER_ID }, { centerId: null }], status: "ACTIVE" },
      include: { availability: true },
    }),
    prisma.session.findMany({
      where: {
        startTime: { gte: new Date(weekStart.getTime() - 28 * 24 * 3_600_000), lt: weekStart },
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
      },
      select: { clientId: true, providerId: true },
      orderBy: { startTime: "desc" },
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
      clientAuthMap[auth.clientId] = { authId: auth.id, weeklyHours: auth.approvedHoursPerWeek, endDate: auth.endDate };
    }
  }

  // Used hours from actual sessions this week
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
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessionsRaw) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) historicalByClient[s.clientId].push(s.providerId);
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

  const clientNameMap: Record<string, string> = {};
  const providerNameMap: Record<string, string> = {};
  for (const c of rawClients) clientNameMap[c.id] = `${c.lastName}, ${c.firstName}`;
  for (const p of rawProviders) providerNameMap[p.id] = `${p.lastName}, ${p.firstName}`;

  // Zero drive times — skip Maps API
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

  const clients = rawClients.map(c => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
    const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;
    const authPerDay = remaining !== null ? Math.min(remaining, DAILY_MAX_HOURS) : (c.defaultSessionHours ?? defaultSessHours);
    const snapped = Math.floor(Math.max(authPerDay, 0) * 2) / 2;
    const sessHours = snapped < MIN_BILLABLE_HOURS && (remaining ?? 0) >= MIN_BILLABLE_HOURS ? MIN_BILLABLE_HOURS : snapped;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      latitude: c.latitude,
      longitude: c.longitude,
      sessionHours: sessHours,
      daysNeeded: 1,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      preferredLocation: c.preferredLocation,
      defaultSessionHours: c.defaultSessionHours,
      availability: c.availability.map(a => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      authorizationId: authInfo?.authId ?? null,
      approvedWeeklyHours: authInfo?.weeklyHours ?? 0,
      usedHoursThisWeek: used,
      authorizationEndDate: authInfo?.endDate ? new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(authInfo.endDate) : null,
      approvedProviderIds: c.approvedHomeProviders.map(ah => ah.providerId),
      bookedWindows: [] as Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>,
      blocks: blocksByClient[c.id] ?? [],
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: (historicalByClient[c.id] ?? []).length > 0,
    };
  });

  const providers = rawProviders.map(p => ({
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
    bookedWindows: [] as Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string }>,
    blocks: blocksByProvider[p.id] ?? [],
    weeklyHoursAlreadyScheduled: 0,
  }));

  return { clients, providers, sessionTypeIds, driveTimeSessionTypeId, weekOf, weekStart, weekEnd, driveMinutes, distanceMeters, clientNameMap, providerNameMap };
}

// ─── Run Baseline Optimizer ─────────────────────────────────────────────────

/**
 * Run the day-mode optimizer for a target date, returning the proposed sessions.
 * bookedSessions is the list of SCHEDULED sessions (not cancelled) that block time.
 * cancelledSessions is the list of CANCELLED sessions (with cancelledBy set).
 */
function runDayOptimizer(
  ctx: DBContext,
  targetDate: string,
  dayOfWeek: DayOfWeek,
  bookedSessions: CancellationInput[],   // SCHEDULED sessions (blocks both parties)
  cancelledSessions: CancellationInput[] // CANCELLED sessions (directional blocks)
): ReturnType<typeof optimize> {
  // Build per-entity window maps from booked + cancelled sessions
  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};

  const allSessions = [
    ...bookedSessions.map(s => ({ ...s, status: "SCHEDULED", cancelledBy: null as string | null })),
    ...cancelledSessions.map(s => ({ ...s, status: "CANCELLED", cancelledBy: s.cancelledBy as string })),
  ];

  for (const s of allSessions) {
    const dow = localDayOfWeek(s.startTime);
    const localStart = localHHMM(s.startTime);
    const localEnd = localHHMM(s.endTime);
    const cancelledByClient = s.cancelledBy === "CLIENT";
    const cancelledByProvider = s.cancelledBy === "PROVIDER";

    // Block provider time unless the CLIENT cancelled (client-cancelled frees the provider)
    if (!cancelledByClient) {
      if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
      bookedByProvider[s.providerId].push({ dayOfWeek: dow, startTime: localStart, endTime: localEnd, clientId: s.clientId });
    }

    // Block client time unless the PROVIDER cancelled (provider-cancelled frees the client)
    if (!cancelledByProvider) {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek: dow, startTime: localStart, endTime: localEnd });
    }
  }

  // Build cancellationContext from the cancelled sessions
  const displacedClientIds = cancelledSessions
    .filter(s => s.cancelledBy === "PROVIDER")
    .map(s => s.clientId);
  const freedProviderIds = cancelledSessions
    .filter(s => s.cancelledBy === "CLIENT")
    .map(s => s.providerId);

  const cancellationContext = (displacedClientIds.length > 0 || freedProviderIds.length > 0)
    ? { displacedClientIds, freedProviderIds }
    : undefined;

  // Patch bookedWindows into clients/providers (day-specific)
  const patchedClients: SchedulerClient[] = ctx.clients.map(c => ({
    ...c,
    minimumRbtLevel: c.minimumRbtLevel as import("@prisma/client").RbtLevel | null,
    preferredLocation: c.preferredLocation as "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE",
    bookedWindows: bookedByClient[c.id] ?? [],
    daysNeeded: 1,
  }));
  const patchedProviders: SchedulerProvider[] = ctx.providers.map(p => ({
    ...p,
    position: p.position as "BCBA" | "BCaBA" | "RBT",
    rbtLevel: p.rbtLevel as import("@prisma/client").RbtLevel | null,
    gender: p.gender ?? "",
    bookedWindows: bookedByProvider[p.id] ?? [],
  }));

  const input: SchedulerInput = {
    weekOf: ctx.weekOf,
    targetDate,
    timezone: TIMEZONE,
    centerId: CENTER_ID,
    clients: patchedClients,
    providers: patchedProviders,
    sessionTypeIds: ctx.sessionTypeIds,
    driveTimeSessionTypeId: ctx.driveTimeSessionTypeId,
    driveMinutes: ctx.driveMinutes,
    distanceMeters: ctx.distanceMeters,
    existingHomeSessions: [],
    cancellationContext,
  };

  return optimize(input, createWorkingState());
}

// ─── Scenario Runners ─────────────────────────────────────────────────────────

/**
 * Find the best candidate day: most baseline proposals, fewest existing cancellations.
 */
function pickTargetDay(
  baselineByDay: Record<string, Array<{ clientId: string; providerId: string; start: string; end: string; startDate: Date; endDate: Date }>>
): { date: string; dow: DayOfWeek; proposals: typeof baselineByDay[string] } | null {
  let best: { date: string; dow: DayOfWeek; count: number } | null = null;
  for (const [date, proposals] of Object.entries(baselineByDay)) {
    if (!best || proposals.length > best.count) {
      best = { date, dow: localDayOfWeek(new Date(`${date}T12:00:00Z`)), count: proposals.length };
    }
  }
  if (!best) return null;
  return { date: best.date, dow: best.dow, proposals: baselineByDay[best.date] };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const targetDateArg = process.argv[2];
  const targetDateObj = targetDateArg
    ? new Date(`${targetDateArg}T12:00:00Z`)
    : new Date(); // today

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("  CANCELLATION SCENARIO VALIDATION — AUDIT_GOD PROTOCOL               ");
  console.log(`  Target week: ${localDate(targetDateObj)} | Center: ${CENTER_ID.slice(-8)}   `);
  console.log("  Testing 4 scenario types × 3 runs = 12 simulations (+ bonus)        ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const ctx = await loadDBContext(targetDateObj);
  const { clients, providers, clientNameMap, providerNameMap, weekStart, weekEnd } = ctx;

  console.log(`  Loaded: ${clients.length} clients, ${providers.length} providers`);
  console.log(`  Week: ${localDate(weekStart)} → ${localDate(new Date(weekEnd.getTime() - 1))}\n`);

  // ── Run baseline week optimizer to find which days have proposals ─────────────
  // We run the WEEK optimizer once to discover a realistic baseline.
  // This tells us which client-provider pairings are likely on each day.
  // We then use those pairings as the "sessions to cancel" in each scenario.

  console.log("  → Running baseline week optimizer (in-memory, no DB writes)...");

  const weekInput: SchedulerInput = {
    weekOf: ctx.weekOf,
    targetDate: localDate(ctx.weekOf), // not used in week mode
    timezone: TIMEZONE,
    centerId: CENTER_ID,
    clients: ctx.clients.map(c => ({ ...c, minimumRbtLevel: c.minimumRbtLevel as import("@prisma/client").RbtLevel | null, preferredLocation: c.preferredLocation as "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE", daysNeeded: Math.max(1, Math.ceil(c.approvedWeeklyHours / DAILY_MAX_HOURS)), bookedWindows: [] as never[] })),
    providers: ctx.providers.map(p => ({ ...p, position: p.position as "BCBA" | "BCaBA" | "RBT", rbtLevel: p.rbtLevel as import("@prisma/client").RbtLevel | null, gender: p.gender ?? "", bookedWindows: [] as never[] })),
    sessionTypeIds: ctx.sessionTypeIds,
    driveTimeSessionTypeId: ctx.driveTimeSessionTypeId,
    driveMinutes: ctx.driveMinutes,
    distanceMeters: ctx.distanceMeters,
    existingHomeSessions: [],
    weekMode: true,
  };

  const weekResult = optimize(weekInput, createWorkingState());

  if (weekResult.proposals.length === 0) {
    console.log("  ⚠ Baseline optimizer produced 0 proposals. Cannot run scenarios.");
    console.log("    Possible causes: no authorizations, no availability, no providers.");
    await prisma.$disconnect();
    return;
  }

  // Group proposals by day
  const byDay: Record<string, Array<{ clientId: string; providerId: string; dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  for (const p of weekResult.proposals) {
    if (!byDay[p.dayOfWeek]) byDay[p.dayOfWeek] = [];
    byDay[p.dayOfWeek].push(p);
  }

  // Convert DayOfWeek → YYYY-MM-DD
  const dowToDate: Record<DayOfWeek, string> = {} as Record<DayOfWeek, string>;
  const days: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
  for (let i = 0; i < 5; i++) {
    const d = new Date(ctx.weekOf.getTime() + i * 24 * 3_600_000);
    dowToDate[days[i]] = localDate(d);
  }

  // Build day proposal lists with dates for scheduling
  const byDateList: Record<string, Array<{ clientId: string; providerId: string; dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  for (const [dow, proposals] of Object.entries(byDay)) {
    const dateStr = dowToDate[dow as DayOfWeek];
    if (dateStr) byDateList[dateStr] = proposals;
  }

  // Find the best-populated day
  const bestDayEntry = Object.entries(byDateList).sort((a, b) => b[1].length - a[1].length)[0];
  if (!bestDayEntry) {
    console.log("  ⚠ No weekday proposals found. Cannot run scenarios.");
    await prisma.$disconnect();
    return;
  }

  const [primaryDateStr, primaryDayProposals] = bestDayEntry;
  const primaryDow = localDayOfWeek(new Date(`${primaryDateStr}T12:00:00Z`));

  console.log(`  Best-populated day: ${primaryDateStr} (${primaryDow}) — ${primaryDayProposals.length} baseline proposals\n`);

  // Convert optimizer proposals into CancellationInput (need UTC times from local HH:MM + date)
  function proposalToInput(p: typeof primaryDayProposals[0], dateStr: string, cancelledBy: "CLIENT" | "PROVIDER"): CancellationInput {
    return {
      providerId: p.providerId,
      clientId: p.clientId,
      startTime: toUtcDate(dateStr, p.startTime),
      endTime: toUtcDate(dateStr, p.endTime),
      cancelledBy,
    };
  }

  // Build baseline sessions (all proposals for the primary day = "scheduled sessions")
  const baselineSessions: CancellationInput[] = primaryDayProposals.map(p =>
    proposalToInput(p, primaryDateStr, "CLIENT") // cancelledBy doesn't matter here — overridden per scenario
  );

  // ─── Scenario definitions ──────────────────────────────────────────────────
  // Each scenario picks from baselineSessions and assigns cancelledBy per type.

  const results: ScenarioResult[] = [];
  let runIndex = 1;

  function buildSession(idx: number, cancelledBy: "CLIENT" | "PROVIDER"): CancellationInput {
    const p = primaryDayProposals[idx % primaryDayProposals.length];
    return proposalToInput(p, primaryDateStr, cancelledBy);
  }

  function runScenario(
    type: ScenarioType,
    scheduled: CancellationInput[],   // sessions that remain scheduled (booked windows)
    cancelled: CancellationInput[],   // sessions being cancelled
    extraAssertions?: (proposals: ReturnType<typeof optimize>["proposals"]) => Array<{ label: string; pass: boolean; detail: string }>
  ): ScenarioResult {
    const result = runDayOptimizer(ctx, primaryDateStr, primaryDow, scheduled, cancelled);
    const proposals = result.proposals;

    const freedProviderIds = cancelled.filter(c => c.cancelledBy === "CLIENT").map(c => c.providerId);
    const displacedClientIds = cancelled.filter(c => c.cancelledBy === "PROVIDER").map(c => c.clientId);

    // Standard assertions
    const assertions: Array<{ label: string; pass: boolean; detail: string }> = [];

    if (type === "A_CLIENT_ONLY" || type === "B_PROVIDER_ONLY") {
      // Core guarantee: 0 new proposals
      assertions.push({
        label: "Zero new proposals generated",
        pass: proposals.length === 0,
        detail: proposals.length === 0
          ? "✓ No proposals created — correct. Single-side cancellation blocks all scheduling."
          : `✗ ${proposals.length} unexpected proposals created: ${proposals.map(p => `${clientNameMap[p.clientId] ?? p.clientId} w/ ${providerNameMap[p.providerId] ?? p.providerId}`).join("; ")}`,
      });

      if (type === "A_CLIENT_ONLY") {
        // Freed provider should NOT appear in any proposals
        const leakedProvider = proposals.find(p => freedProviderIds.includes(p.providerId));
        assertions.push({
          label: "Freed provider not re-assigned to new client",
          pass: !leakedProvider,
          detail: leakedProvider
            ? `✗ Provider ${providerNameMap[leakedProvider.providerId]} was freed but got assigned to ${clientNameMap[leakedProvider.clientId ?? ""] ?? "unknown"}`
            : "✓ Freed provider correctly left unassigned",
        });
      }

      if (type === "B_PROVIDER_ONLY") {
        // Displaced client should NOT appear in any proposals
        const leakedClient = proposals.find(p => displacedClientIds.includes(p.clientId ?? ""));
        assertions.push({
          label: "Displaced client not matched with random provider",
          pass: !leakedClient,
          detail: leakedClient
            ? `✗ Client ${clientNameMap[leakedClient.clientId ?? ""] ?? "unknown"} was displaced but got scheduled with ${providerNameMap[leakedClient.providerId] ?? "unknown"}`
            : "✓ Displaced client correctly left unscheduled",
        });
      }
    }

    if (type === "C_SAME_PROVIDER_SWITCH" || type === "D_DIFF_PROVIDER_SWITCH") {
      // Core guarantee: displaced client is matched with freed provider
      const freedSet = new Set(freedProviderIds);
      const displacedSet = new Set(displacedClientIds);

      // All proposals must be displaced-client ↔ freed-provider pairs
      const invalidProposals = proposals.filter(p =>
        !displacedSet.has(p.clientId ?? "") || !freedSet.has(p.providerId)
      );
      assertions.push({
        label: "All proposals are displaced-client ↔ freed-provider pairs",
        pass: invalidProposals.length === 0,
        detail: invalidProposals.length === 0
          ? "✓ Optimizer only generated proposals between displaced clients and freed providers"
          : `✗ ${invalidProposals.length} proposal(s) outside the switch pair: ${invalidProposals.map(p => `${clientNameMap[p.clientId ?? ""] ?? p.clientId} ↔ ${providerNameMap[p.providerId] ?? p.providerId}`).join("; ")}`,
      });

      // At least one displaced client got matched
      const matchedDisplaced = proposals.filter(p => displacedSet.has(p.clientId ?? ""));
      assertions.push({
        label: "At least one displaced client was matched (switch opportunity found)",
        pass: matchedDisplaced.length > 0,
        detail: matchedDisplaced.length > 0
          ? `✓ ${matchedDisplaced.length}/${displacedClientIds.length} displaced client(s) rescheduled: ${matchedDisplaced.map(p => `${clientNameMap[p.clientId ?? ""] ?? p.clientId} → ${providerNameMap[p.providerId] ?? p.providerId}`).join("; ")}`
          : `✗ No displaced client could be matched — freedProviders=[${freedProviderIds.map(id => providerNameMap[id] ?? id).join(", ")}] but no compatible availability overlap`,
      });

      // Non-cancelled clients should NOT have proposals (no new additions)
      const cancelledClientIds = new Set(cancelled.map(c => c.clientId));
      const cancelledProviderIds = new Set(cancelled.map(c => c.providerId));
      const uncancelledClientProposals = proposals.filter(p =>
        !displacedSet.has(p.clientId ?? "") && !cancelledClientIds.has(p.clientId ?? "")
      );
      assertions.push({
        label: "No proposals for non-displaced clients (no schedule inflation)",
        pass: uncancelledClientProposals.length === 0,
        detail: uncancelledClientProposals.length === 0
          ? "✓ No new sessions created for clients not involved in the cancellation"
          : `✗ ${uncancelledClientProposals.length} unexpected proposal(s) for uninvolved clients`,
      });
    }

    if (type === "F_SYSTEMATIC") {
      const freedSet = new Set(freedProviderIds);
      const displacedSet = new Set(displacedClientIds);
      const isSingleSide = freedProviderIds.length === 0 || displacedClientIds.length === 0;

      if (isSingleSide) {
        // Pure CLIENT-only or PROVIDER-only cancellation: zero proposals expected.
        assertions.push({
          label: "Single-side cancellation produces zero new proposals",
          pass: proposals.length === 0,
          detail: proposals.length === 0
            ? `✓ ${cancelled.length} ${freedProviderIds.length > 0 ? "CLIENT" : "PROVIDER"}-only cancellation(s) → 0 proposals (correct)`
            : `✗ ${proposals.length} unexpected proposal(s): ${proposals.map(p => `${clientNameMap[p.clientId ?? ""] ?? p.clientId} ↔ ${providerNameMap[p.providerId] ?? p.providerId}`).join("; ")}`,
        });
      } else {
        // Mixed: every proposal must be a displaced↔freed pair.
        const invalidProposals = proposals.filter(p =>
          !displacedSet.has(p.clientId ?? "") || !freedSet.has(p.providerId)
        );
        assertions.push({
          label: "All proposals are displaced↔freed pairs",
          pass: invalidProposals.length === 0,
          detail: invalidProposals.length === 0
            ? `✓ ${proposals.length} proposal(s) all valid switch pair(s)`
            : `✗ ${invalidProposals.length} non-pair proposal(s) leaked through`,
        });

        // No proposals for clients not displaced (no schedule inflation).
        const uninvolvedProposals = proposals.filter(p => !displacedSet.has(p.clientId ?? ""));
        assertions.push({
          label: "No proposals for non-displaced clients (no inflation)",
          pass: uninvolvedProposals.length === 0,
          detail: uninvolvedProposals.length === 0
            ? "✓ Schedule unchanged for non-cancelled parties"
            : `✗ ${uninvolvedProposals.length} unexpected proposal(s) for uninvolved clients`,
        });

        // Proposal count should not exceed min(displaced, freed).
        const maxExpected = Math.min(displacedClientIds.length, freedProviderIds.length);
        assertions.push({
          label: `Proposal count ≤ min(displaced=${displacedClientIds.length}, freed=${freedProviderIds.length}) = ${maxExpected}`,
          pass: proposals.length <= maxExpected,
          detail: proposals.length <= maxExpected
            ? `✓ ${proposals.length} proposal(s) ≤ ${maxExpected} max possible swap pairs`
            : `✗ ${proposals.length} proposal(s) exceeds the ${maxExpected} possible swap pair ceiling`,
        });

        // Provider double-booking check.
        const byProvider: Record<string, typeof proposals> = {};
        for (const p of proposals) {
          if (!byProvider[p.providerId]) byProvider[p.providerId] = [];
          byProvider[p.providerId].push(p);
        }
        let doubleBookCount = 0;
        for (const pSlots of Object.values(byProvider)) {
          const sorted = [...pSlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
          for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].endTime > sorted[i + 1].startTime) doubleBookCount++;
          }
        }
        assertions.push({
          label: "No provider double-booking in switch proposals",
          pass: doubleBookCount === 0,
          detail: doubleBookCount === 0 ? "✓ All switch proposals have non-overlapping slots" : `✗ ${doubleBookCount} double-booking(s) detected`,
        });
      }
    }

    if (type === "E_MULTI_MIXED") {
      const freedSet = new Set(freedProviderIds);
      const displacedSet = new Set(displacedClientIds);

      // All proposals must be switch pairs only
      const invalidProposals = proposals.filter(p =>
        !displacedSet.has(p.clientId ?? "") || !freedSet.has(p.providerId)
      );
      assertions.push({
        label: "All multi-cancel proposals are valid switch pairs",
        pass: invalidProposals.length === 0,
        detail: invalidProposals.length === 0
          ? `✓ ${proposals.length} proposal(s) all matched displaced ↔ freed pairs`
          : `✗ ${invalidProposals.length} proposal(s) outside expected switch pairs`,
      });

      // No proposals for uninvolved clients
      const uninvolvedProposals = proposals.filter(p =>
        !displacedSet.has(p.clientId ?? "")
      );
      assertions.push({
        label: "No proposals for uninvolved clients",
        pass: uninvolvedProposals.length === 0,
        detail: uninvolvedProposals.length === 0
          ? "✓ Schedule correctly unchanged for non-cancelled parties"
          : `✗ ${uninvolvedProposals.length} unexpected proposals for uninvolved clients`,
      });

      // Double-booking check
      const byProvider: Record<string, typeof proposals> = {};
      for (const p of proposals) {
        if (!byProvider[p.providerId]) byProvider[p.providerId] = [];
        byProvider[p.providerId].push(p);
      }
      let doubleBookCount = 0;
      for (const [, pSlots] of Object.entries(byProvider)) {
        const sorted = [...pSlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].endTime > sorted[i + 1].startTime) doubleBookCount++;
        }
      }
      assertions.push({
        label: "No provider double-booking in switch proposals",
        pass: doubleBookCount === 0,
        detail: doubleBookCount === 0 ? "✓ All switch proposals have non-overlapping slots" : `✗ ${doubleBookCount} double-booking(s) detected`,
      });
    }

    // Extra scenario-specific assertions
    if (extraAssertions) {
      assertions.push(...extraAssertions(proposals));
    }

    const cancellationDisplay = cancelled.map(c => ({
      who: c.cancelledBy,
      clientName: clientNameMap[c.clientId] ?? c.clientId,
      providerName: providerNameMap[c.providerId] ?? c.providerId,
      hours: sessionHours(c.startTime, c.endTime),
    }));

    const pass = assertions.every(a => a.pass);
    const notes: string[] = [];
    if (result.skipReasons) {
      const skippedDisplaced = displacedClientIds.filter(id => result.skipReasons[id]);
      for (const id of skippedDisplaced) {
        notes.push(`Displaced client ${clientNameMap[id] ?? id} skipped: ${result.skipReasons[id]}`);
      }
    }

    const outputProposals = proposals.map(p => ({
      clientId: p.clientId,
      providerId: p.providerId,
      startTime: p.startTime,
      endTime: p.endTime,
    }));

    return {
      runIndex: runIndex++,
      type,
      targetDay: primaryDateStr,
      dayOfWeek: primaryDow,
      cancellations: cancellationDisplay,
      cancellationContext: { freedProviderIds, displacedClientIds },
      baselineProposalCount: primaryDayProposals.length,
      outputProposals,
      assertions,
      pass,
      notes,
    };
  }

  // ─── Execute All Scenarios ─────────────────────────────────────────────────
  // Need at least 4 proposals for Switch and Multi scenarios
  const propCount = primaryDayProposals.length;
  const canRunSwitch = propCount >= 2;
  const canRunMulti = propCount >= 4;

  // ── TYPE A: Single CLIENT cancel (3 runs) ───────────────────────────────────
  console.log("  ── TYPE A: Single CLIENT cancellation (expect: 0 proposals) ──────");
  for (let i = 0; i < 3; i++) {
    const cancelIdx = i % propCount;
    const target = primaryDayProposals[cancelIdx];
    const remaining = primaryDayProposals.filter((_, j) => j !== cancelIdx);

    const scheduled = remaining.map(p => proposalToInput(p, primaryDateStr, "CLIENT")); // status doesn't matter for non-cancelled
    const cancelled = [proposalToInput(target, primaryDateStr, "CLIENT")];

    const r = runScenario("A_CLIENT_ONLY", scheduled, cancelled);
    results.push(r);
    const icon = r.pass ? "✓" : "✗";
    console.log(`    Run ${r.runIndex}: ${icon} CLIENT cancel — ${clientNameMap[target.clientId] ?? target.clientId} on ${providerNameMap[target.providerId] ?? target.providerId} | ${r.outputProposals.length} proposals`);
    if (!r.pass) for (const a of r.assertions.filter(a => !a.pass)) console.log(`       ✗ ${a.label}: ${a.detail}`);
  }

  // ── TYPE B: Single PROVIDER cancel (3 runs) ─────────────────────────────────
  console.log("\n  ── TYPE B: Single PROVIDER cancellation (expect: 0 proposals) ────");
  for (let i = 0; i < 3; i++) {
    const cancelIdx = i % propCount;
    const target = primaryDayProposals[cancelIdx];
    const remaining = primaryDayProposals.filter((_, j) => j !== cancelIdx);

    const scheduled = remaining.map(p => proposalToInput(p, primaryDateStr, "CLIENT"));
    const cancelled = [proposalToInput(target, primaryDateStr, "PROVIDER")];

    const r = runScenario("B_PROVIDER_ONLY", scheduled, cancelled);
    results.push(r);
    const icon = r.pass ? "✓" : "✗";
    console.log(`    Run ${r.runIndex}: ${icon} PROVIDER cancel — ${providerNameMap[target.providerId] ?? target.providerId} on ${clientNameMap[target.clientId] ?? target.clientId} | ${r.outputProposals.length} proposals`);
    if (!r.pass) for (const a of r.assertions.filter(a => !a.pass)) console.log(`       ✗ ${a.label}: ${a.detail}`);
  }

  // ── TYPE C: Same-provider switch (3 runs) ───────────────────────────────────
  console.log("\n  ── TYPE C: Same-provider switch (expect: displaced client matched) ──");
  if (!canRunSwitch) {
    console.log("    ⚠ Skipped — need ≥2 proposals for same-provider switch test");
  } else {
    // Find pairs where the same provider appears twice (ideal) or just use 2 different proposals
    // by any 2 providers: cancel slot i as CLIENT (frees provider A), cancel slot j as PROVIDER (provider B cancels on client B)
    // For Type C "same provider": we need provider A to appear in both.
    // If only one proposal per provider, we'll simulate it differently:
    //   Option: Cancel proposal[0] as CLIENT (frees P0). Also cancel proposal[0] as PROVIDER on a different client.
    //   Not possible with a single proposal. Instead, find any 2 proposals by the same provider.
    // If no provider has 2 proposals, use 2 different providers (still tests the switch logic).

    const providerToDayProposals: Record<string, typeof primaryDayProposals> = {};
    for (const p of primaryDayProposals) {
      if (!providerToDayProposals[p.providerId]) providerToDayProposals[p.providerId] = [];
      providerToDayProposals[p.providerId].push(p);
    }
    const providerWithTwoSlots = Object.entries(providerToDayProposals).find(([, ps]) => ps.length >= 2);

    for (let i = 0; i < 3; i++) {
      let cancelA: CancellationInput;
      let cancelB: CancellationInput;

      if (providerWithTwoSlots) {
        // True same-provider scenario: provider has 2 sessions
        const [providerId, pSlots] = providerWithTwoSlots;
        // Client A cancels on provider P (P freed), P cancels on client B (B displaced)
        const slotA = pSlots[0];
        const slotB = pSlots[1 % pSlots.length];
        cancelA = proposalToInput(slotA, primaryDateStr, "CLIENT");   // Client A cancels → P freed
        cancelB = proposalToInput(slotB, primaryDateStr, "PROVIDER"); // P cancels on B → B displaced
        const remaining = primaryDayProposals.filter(p => p !== slotA && p !== slotB);
        const scheduled = remaining.map(p => proposalToInput(p, primaryDateStr, "CLIENT"));
        const r = runScenario("C_SAME_PROVIDER_SWITCH", scheduled, [cancelA, cancelB], (proposals) => {
          // Extra: displaced client B should be matched with freed provider P (same one)
          const switchMatch = proposals.find(p =>
            p.clientId === cancelB.clientId && p.providerId === cancelA.providerId
          );
          return [{
            label: "Displaced client matched with the SAME freed provider",
            pass: !!switchMatch,
            detail: switchMatch
              ? `✓ ${clientNameMap[cancelB.clientId] ?? cancelB.clientId} correctly re-matched with freed ${providerNameMap[cancelA.providerId] ?? cancelA.providerId}`
              : `✗ Displaced ${clientNameMap[cancelB.clientId] ?? cancelB.clientId} was NOT matched with ${providerNameMap[cancelA.providerId] ?? cancelA.providerId} — incompatible availability or constraints`,
          }];
        });
        results.push(r);
        const icon = r.pass ? "✓" : "✗";
        const freeP = providerNameMap[cancelA.providerId] ?? cancelA.providerId;
        const dispC = clientNameMap[cancelB.clientId] ?? cancelB.clientId;
        console.log(`    Run ${r.runIndex}: ${icon} Same-provider switch — freed ${freeP}, displaced ${dispC} | ${r.outputProposals.length} proposal(s)`);
        if (!r.pass) for (const a of r.assertions.filter(a => !a.pass)) console.log(`       ✗ ${a.label}: ${a.detail}`);
        for (const n of r.notes) console.log(`       ℹ ${n}`);
      } else {
        // No provider has 2 slots — use 2 different providers: still tests the switch mechanism
        const idxA = i % propCount;
        const idxB = (i + 1) % propCount;
        if (idxA === idxB) {
          console.log(`    Run ${runIndex}: SKIP — only 1 proposal on this day, can't form a switch pair`);
          runIndex++;
          continue;
        }
        const slotA = primaryDayProposals[idxA];
        const slotB = primaryDayProposals[idxB];
        cancelA = proposalToInput(slotA, primaryDateStr, "CLIENT");   // A's client cancels → A freed
        cancelB = proposalToInput(slotB, primaryDateStr, "PROVIDER"); // B cancels on their client → client displaced
        const remaining = primaryDayProposals.filter((_, j) => j !== idxA && j !== idxB);
        const scheduled = remaining.map(p => proposalToInput(p, primaryDateStr, "CLIENT"));
        const r = runScenario("C_SAME_PROVIDER_SWITCH", scheduled, [cancelA, cancelB]);
        r.notes.push(`Note: No provider had 2 sessions on ${primaryDateStr} — used different-provider switch as Type C equivalent`);
        results.push(r);
        const icon = r.pass ? "✓" : "✗";
        const freeP = providerNameMap[cancelA.providerId] ?? cancelA.providerId;
        const dispC = clientNameMap[cancelB.clientId] ?? cancelB.clientId;
        console.log(`    Run ${r.runIndex}: ${icon} Switch — freed ${freeP}, displaced ${dispC} | ${r.outputProposals.length} proposal(s)`);
        if (!r.pass) for (const a of r.assertions.filter(a => !a.pass)) console.log(`       ✗ ${a.label}: ${a.detail}`);
        for (const n of r.notes) console.log(`       ℹ ${n}`);
      }
    }
  }

  // ── TYPE D: Different-provider switch (3 runs) ──────────────────────────────
  console.log("\n  ── TYPE D: Different-provider switch (expect: displaced → freed) ───");
  if (!canRunSwitch || propCount < 2) {
    console.log("    ⚠ Skipped — need ≥2 proposals for different-provider switch test");
  } else {
    for (let i = 0; i < 3; i++) {
      // Pick two DIFFERENT providers
      const idxA = i % propCount;
      const idxB = (i + Math.ceil(propCount / 2)) % propCount;
      if (idxA === idxB) {
        console.log(`    Run ${runIndex}: SKIP — only 1 provider available`);
        runIndex++;
        continue;
      }
      const slotA = primaryDayProposals[idxA]; // Client of slotA cancels → Provider A freed
      const slotB = primaryDayProposals[idxB]; // Provider B cancels on their client → client B displaced

      if (slotA.providerId === slotB.providerId) {
        // Same provider — swap to get different
        const altIdx = (idxB + 1) % propCount;
        if (altIdx === idxA) {
          console.log(`    Run ${runIndex}: SKIP — all proposals share one provider`);
          runIndex++;
          continue;
        }
      }

      const cancelA = proposalToInput(slotA, primaryDateStr, "CLIENT");   // Client cancels on P_A → P_A freed
      const cancelB = proposalToInput(slotB, primaryDateStr, "PROVIDER"); // P_B cancels on Client_B → Client_B displaced
      const remaining = primaryDayProposals.filter((_, j) => j !== idxA && j !== idxB);
      const scheduled = remaining.map(p => proposalToInput(p, primaryDateStr, "CLIENT"));

      const freeProvName = providerNameMap[cancelA.providerId] ?? cancelA.providerId;
      const dispClientName = clientNameMap[cancelB.clientId] ?? cancelB.clientId;

      const r = runScenario("D_DIFF_PROVIDER_SWITCH", scheduled, [cancelA, cancelB], (proposals) => {
        // Extra: the displaced client should be matched with the freed provider (different provider)
        const switchMatch = proposals.find(p =>
          p.clientId === cancelB.clientId && p.providerId === cancelA.providerId
        );
        return [{
          label: "Displaced client matched with DIFFERENT freed provider",
          pass: !!switchMatch,
          detail: switchMatch
            ? `✓ ${dispClientName} successfully matched with freed ${freeProvName} (cross-provider switch)`
            : `✗ No match found — ${dispClientName} could not be matched with ${freeProvName} (check availability overlap and constraints)`,
        }];
      });
      results.push(r);
      const icon = r.pass ? "✓" : "✗";
      console.log(`    Run ${r.runIndex}: ${icon} Different-provider switch — freed ${freeProvName}, displaced ${dispClientName} | ${r.outputProposals.length} proposal(s)`);
      if (!r.pass) for (const a of r.assertions.filter(a => !a.pass)) console.log(`       ✗ ${a.label}: ${a.detail}`);
      for (const n of r.notes) console.log(`       ℹ ${n}`);
    }
  }

  // ── TYPE E: Multiple mixed cancellations (bonus 1 run) ──────────────────────
  console.log("\n  ── TYPE E: Multiple mixed cancellations (expect: efficient multi-pair) ──");
  if (!canRunMulti) {
    console.log(`    ⚠ Skipped — need ≥4 proposals, have ${propCount}`);
  } else {
    // Cancel 2 as CLIENT, 2 as PROVIDER
    const clientCancels = [0, 2].map(i => proposalToInput(primaryDayProposals[i], primaryDateStr, "CLIENT"));
    const providerCancels = [1, 3].map(i => proposalToInput(primaryDayProposals[i], primaryDateStr, "PROVIDER"));
    const remaining = primaryDayProposals.slice(4);
    const scheduled = remaining.map(p => proposalToInput(p, primaryDateStr, "CLIENT"));
    const cancelled = [...clientCancels, ...providerCancels];

    const r = runScenario("E_MULTI_MIXED", scheduled, cancelled);
    results.push(r);
    const icon = r.pass ? "✓" : "✗";
    console.log(`    Run ${r.runIndex}: ${icon} Multi-cancel — ${clientCancels.length} CLIENT + ${providerCancels.length} PROVIDER | ${r.outputProposals.length} proposal(s)`);
    if (!r.pass) for (const a of r.assertions.filter(a => !a.pass)) console.log(`       ✗ ${a.label}: ${a.detail}`);
    for (const n of r.notes) console.log(`       ℹ ${n}`);
    if (r.outputProposals.length > 0) {
      for (const p of r.outputProposals) {
        console.log(`       → ${clientNameMap[p.clientId] ?? p.clientId} ↔ ${providerNameMap[p.providerId] ?? p.providerId} (${p.startTime}–${p.endTime})`);
      }
    }
  }

  // ── TYPE F: Systematic N=2..5 cancellation sweep ───────────────────────────
  // For each total cancellation count N in [2,3,4,5], iterate over all
  // (clientCancelCount, providerCancelCount) splits where C+P=N and run one
  // trial. Single-side splits (C=0 or P=0) must produce zero proposals;
  // mixed splits must produce only displaced↔freed swap pairs, capped at
  // min(C, P). Each scenario gets the same AUDIT_GOD invariant battery.
  console.log("\n  ── TYPE F: Systematic N=2..5 cancellation sweep ────────────────────");
  const fSummary: Array<{ runIndex: number; n: number; c: number; p: number; pass: boolean; proposals: number; assertionsPassed: number; assertionsTotal: number }> = [];
  for (const N of [2, 3, 4, 5]) {
    if (propCount < N) {
      console.log(`    N=${N}: ⚠ Skipped — need ≥${N} proposals on the day, have ${propCount}`);
      continue;
    }
    console.log(`\n    ─ N=${N} cancellations ${"─".repeat(40)}`);
    for (let c = 0; c <= N; c++) {
      const p = N - c;
      // Pick the first N proposals; first c are CLIENT cancels, next p are PROVIDER cancels.
      const cancelTargets = primaryDayProposals.slice(0, N);
      const remaining = primaryDayProposals.slice(N);

      const clientCancels = cancelTargets.slice(0, c).map(prop => proposalToInput(prop, primaryDateStr, "CLIENT"));
      const providerCancels = cancelTargets.slice(c, N).map(prop => proposalToInput(prop, primaryDateStr, "PROVIDER"));
      const scheduled = remaining.map(prop => proposalToInput(prop, primaryDateStr, "CLIENT"));
      const cancelled = [...clientCancels, ...providerCancels];

      const r = runScenario("F_SYSTEMATIC", scheduled, cancelled);
      results.push(r);
      const passedAssertions = r.assertions.filter(a => a.pass).length;
      fSummary.push({
        runIndex: r.runIndex,
        n: N,
        c,
        p,
        pass: r.pass,
        proposals: r.outputProposals.length,
        assertionsPassed: passedAssertions,
        assertionsTotal: r.assertions.length,
      });
      const icon = r.pass ? "✓" : "✗";
      const splitLabel = `${c}C / ${p}P`;
      console.log(`      Run ${String(r.runIndex).padStart(2)}: ${icon} ${splitLabel.padEnd(8)} → ${r.outputProposals.length} proposal(s)  [${passedAssertions}/${r.assertions.length} assertions]`);
      if (!r.pass) {
        for (const a of r.assertions.filter(a => !a.pass)) {
          console.log(`          ✗ ${a.label}`);
          console.log(`            ${a.detail}`);
        }
      }
    }
  }

  // ─── AUDIT_GOD REPORT ────────────────────────────────────────────────────────
  console.log("\n\n════════════════════════════════════════════════════════════════════════");
  console.log("  SCHEDULE AUDIT REPORT — CANCELLATION SCENARIO VALIDATION            ");
  console.log(`  Week of: ${localDate(ctx.weekStart)} – ${localDate(new Date(ctx.weekEnd.getTime() - 1))}       `);
  console.log(`  Generated: ${new Date().toISOString()}                              `);
  console.log("════════════════════════════════════════════════════════════════════════\n");

  const totalRuns = results.length;
  const passedRuns = results.filter(r => r.pass).length;
  const failedRuns = totalRuns - passedRuns;
  const overallScore = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;

  console.log(`  OVERALL SCORE: ${overallScore}/100 — ${passedRuns}/${totalRuns} scenarios passed\n`);

  // ── PASS 1: Compliance Validation ──────────────────────────────────────────
  console.log("  ════ PASS 1: COMPLIANCE VALIDATION ════════════════════════════════\n");

  const typeAResults = results.filter(r => r.type === "A_CLIENT_ONLY");
  const typeBResults = results.filter(r => r.type === "B_PROVIDER_ONLY");
  const typeCResults = results.filter(r => r.type === "C_SAME_PROVIDER_SWITCH" || r.type === "D_DIFF_PROVIDER_SWITCH");
  const typeEResults = results.filter(r => r.type === "E_MULTI_MIXED");

  const singleCancelCompliant = [...typeAResults, ...typeBResults].every(r =>
    r.assertions.find(a => a.label === "Zero new proposals generated")?.pass === true
  );
  const switchCompliant = typeCResults.every(r =>
    r.assertions.find(a => a.label === "All proposals are displaced-client ↔ freed-provider pairs")?.pass !== false
  );

  console.log(`  Single-cancel zero-proposal rule:`);
  for (const r of [...typeAResults, ...typeBResults]) {
    const a = r.assertions.find(a => a.label === "Zero new proposals generated");
    const icon = a?.pass ? "✓" : "✗";
    console.log(`    Run ${String(r.runIndex).padStart(2)}: ${icon} [${r.type}] ${r.cancellations.map(c => `${c.who}: ${c.clientName} ↔ ${c.providerName}`).join("; ")} → ${r.outputProposals.length} proposals`);
  }

  console.log(`\n  Switch accuracy rule (displaced ↔ freed only):`);
  for (const r of [...typeCResults, ...typeEResults]) {
    const switchPasses = r.assertions.filter(a => a.pass).length;
    const switchTotal = r.assertions.length;
    const icon = r.pass ? "✓" : "✗";
    console.log(`    Run ${String(r.runIndex).padStart(2)}: ${icon} [${r.type}] ${switchPasses}/${switchTotal} assertions pass | ${r.outputProposals.length} proposal(s)`);
    for (const a of r.assertions) {
      console.log(`         ${a.pass ? "✓" : "✗"} ${a.label}`);
      if (!a.pass || a.detail.includes("✓")) console.log(`           ${a.detail}`);
    }
  }

  console.log(`\n  COMPLIANCE RESULT: ${singleCancelCompliant && switchCompliant ? "PASS" : "FAIL"}`);
  const violations: string[] = [];
  for (const r of results) {
    for (const a of r.assertions.filter(a => !a.pass)) {
      violations.push(`[Run ${r.runIndex} ${r.type}] ${a.label}: ${a.detail}`);
    }
  }
  if (violations.length > 0) {
    console.log(`  Violations found: ${violations.length}`);
    for (const v of violations) console.log(`    ✗ ${v}`);
  } else {
    console.log(`  Violations found: 0`);
  }

  // ── PASS 2: Switch Efficiency Analysis ─────────────────────────────────────
  console.log("\n  ════ PASS 2: SWITCH EFFICIENCY ANALYSIS ════════════════════════════\n");
  console.log(`  Target: every compatible displaced-client / freed-provider pair produces a proposal.\n`);

  let switchAttempts = 0;
  let switchSuccesses = 0;
  let switchMissed = 0;

  for (const r of [...typeCResults, ...typeEResults]) {
    const { displacedClientIds, freedProviderIds } = r.cancellationContext;
    switchAttempts += displacedClientIds.length;
    const matched = r.outputProposals.filter(p => displacedClientIds.includes(p.clientId));
    switchSuccesses += matched.length;
    switchMissed += Math.max(0, displacedClientIds.length - matched.length);

    const desc = displacedClientIds.map(id => clientNameMap[id] ?? id).join(", ");
    const freed = freedProviderIds.map(id => providerNameMap[id] ?? id).join(", ");
    console.log(`  Run ${String(r.runIndex).padStart(2)} [${r.type}]`);
    console.log(`    Displaced: ${desc}`);
    console.log(`    Freed:     ${freed}`);
    if (matched.length > 0) {
      for (const p of matched) {
        console.log(`    ✓ Matched: ${clientNameMap[p.clientId] ?? p.clientId} → ${providerNameMap[p.providerId] ?? p.providerId} (${p.startTime}–${p.endTime})`);
      }
    } else {
      console.log(`    ✗ No match produced — no compatible availability overlap (expected if constraints incompatible)`);
    }
    for (const n of r.notes) console.log(`    ℹ ${n}`);
  }

  const switchEfficiency = switchAttempts > 0
    ? Math.round((switchSuccesses / switchAttempts) * 100)
    : 100;
  console.log(`\n  Switch attempts: ${switchAttempts} | Successful: ${switchSuccesses} | Missed: ${switchMissed}`);
  console.log(`  Switch efficiency: ${switchEfficiency}%`);

  // ── PASS 3: Schedule Isolation Verification ─────────────────────────────────
  console.log("\n  ════ PASS 3: SCHEDULE ISOLATION VERIFICATION ═══════════════════════\n");
  console.log(`  Verifies: when no switch opportunity exists, the schedule is untouched.\n`);

  const singleCancelRuns = [...typeAResults, ...typeBResults];
  const isolationPasses = singleCancelRuns.filter(r => r.outputProposals.length === 0).length;
  const isolationFails = singleCancelRuns.filter(r => r.outputProposals.length > 0).length;

  console.log(`  Single-cancel runs: ${singleCancelRuns.length}`);
  console.log(`  Correctly produced 0 proposals: ${isolationPasses} / ${singleCancelRuns.length}`);
  console.log(`  Incorrectly produced proposals: ${isolationFails} (VIOLATION if > 0)`);

  for (const r of singleCancelRuns.filter(r => r.outputProposals.length > 0)) {
    console.log(`\n  ✗ ISOLATION VIOLATION — Run ${r.runIndex} [${r.type}]:`);
    console.log(`    Cancellation: ${r.cancellations.map(c => `${c.who} ${c.clientName} ↔ ${c.providerName}`).join("; ")}`);
    console.log(`    Unexpected proposals:`);
    for (const p of r.outputProposals) {
      console.log(`      • ${clientNameMap[p.clientId] ?? p.clientId} ↔ ${providerNameMap[p.providerId] ?? p.providerId} (${p.startTime}–${p.endTime})`);
    }
  }

  if (isolationFails === 0) {
    console.log(`\n  ✓ ISOLATION VERIFIED — All single-cancellation runs produced zero new proposals.`);
    console.log(`    The schedule is completely unchanged except for the cancelled session itself.`);
  }

  // ── PASS 4: Composite Score ─────────────────────────────────────────────────
  console.log("\n  ════ PASS 4: COMPOSITE SCORE ═══════════════════════════════════════\n");

  const isolationScore   = singleCancelRuns.length > 0 ? Math.round((isolationPasses / singleCancelRuns.length) * 100) : 100;
  const switchScore      = switchAttempts > 0 ? switchEfficiency : 100;
  const complianceScore  = violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 20);
  const pairAccuracyScore = typeCResults.length > 0
    ? Math.round(typeCResults.filter(r => r.assertions.find(a => a.label === "All proposals are displaced-client ↔ freed-provider pairs")?.pass !== false).length / typeCResults.length * 100)
    : 100;

  const compositeScore = Math.round(
    complianceScore  * 0.35 +
    isolationScore   * 0.30 +
    switchScore      * 0.25 +
    pairAccuracyScore * 0.10
  );

  const scoreLabel = compositeScore >= 90 ? "Excellent" : compositeScore >= 75 ? "Good" : compositeScore >= 60 ? "Fair" : "Poor";

  console.log(`  SCHEDULE SCORE: ${compositeScore}/100 — ${scoreLabel}\n`);
  console.log(`  Breakdown:`);
  console.log(`    Compliance (violations=0):     ${complianceScore}/100  (weight: 35%)`);
  console.log(`    Isolation (single-cancel=0):   ${isolationScore}/100  (weight: 30%)`);
  console.log(`    Switch efficiency:             ${switchScore}/100  (weight: 25%)`);
  console.log(`    Pairing accuracy:              ${pairAccuracyScore}/100  (weight: 10%)`);

  // Top actions
  const topActions: string[] = [];
  if (isolationFails > 0) topActions.push(`Fix ${isolationFails} isolation violation(s) — single cancellations should never produce new proposals`);
  if (switchMissed > 0) topActions.push(`Investigate ${switchMissed} missed switch opportunity(s) — check availability overlap and constraint compatibility`);
  if (violations.length > 0) topActions.push(`Resolve ${violations.length} compliance violation(s) listed in Pass 1`);
  if (topActions.length === 0) topActions.push("All scenarios pass — no corrective actions required");

  console.log(`\n  Top actions:`);
  for (let i = 0; i < Math.min(3, topActions.length); i++) {
    console.log(`    ${i + 1}. ${topActions[i]}`);
  }

  // ── Summary table ───────────────────────────────────────────────────────────
  console.log("\n  ════ SCENARIO SUMMARY TABLE ════════════════════════════════════════\n");
  console.log(`  ${"#".padEnd(3)} ${"Type".padEnd(26)} ${"Cancellations".padEnd(36)} ${"Proposals".padEnd(10)} Result`);
  console.log(`  ${"─".repeat(3)} ${"─".repeat(26)} ${"─".repeat(36)} ${"─".repeat(10)} ──────`);
  for (const r of results) {
    const typeLabel = r.type.replace("_", " ").replace(/_/g, " ");
    const cancelDesc = r.cancellations.map(c => `${c.who[0]}:${c.providerName.split(",")[0]}`).join(" + ").slice(0, 34);
    const icon = r.pass ? "PASS ✓" : "FAIL ✗";
    console.log(`  ${String(r.runIndex).padEnd(3)} ${typeLabel.padEnd(26)} ${cancelDesc.padEnd(36)} ${String(r.outputProposals.length).padEnd(10)} ${icon}`);
  }

  console.log(`\n  Total runs: ${totalRuns} | Passed: ${passedRuns} | Failed: ${failedRuns}`);

  // ── Type F systematic-sweep grid ────────────────────────────────────────────
  if (fSummary.length > 0) {
    console.log("\n  ════ TYPE F SYSTEMATIC SWEEP — N=2..5 RESULTS ═════════════════════\n");
    console.log(`  ${"#".padEnd(3)} ${"N".padEnd(3)} ${"Split".padEnd(10)} ${"Mode".padEnd(13)} ${"Proposals".padEnd(10)} ${"Assertions".padEnd(12)} Result`);
    console.log(`  ${"─".repeat(3)} ${"─".repeat(3)} ${"─".repeat(10)} ${"─".repeat(13)} ${"─".repeat(10)} ${"─".repeat(12)} ──────`);
    for (const s of fSummary) {
      const split = `${s.c}C / ${s.p}P`;
      const mode = (s.c === 0 || s.p === 0) ? "single-side" : "mixed swap";
      const icon = s.pass ? "PASS ✓" : "FAIL ✗";
      const assertionLabel = `${s.assertionsPassed}/${s.assertionsTotal}`;
      console.log(`  ${String(s.runIndex).padEnd(3)} ${String(s.n).padEnd(3)} ${split.padEnd(10)} ${mode.padEnd(13)} ${String(s.proposals).padEnd(10)} ${assertionLabel.padEnd(12)} ${icon}`);
    }
    const fPassed = fSummary.filter(s => s.pass).length;
    const fTotal = fSummary.length;
    const fScore = fTotal > 0 ? Math.round((fPassed / fTotal) * 100) : 0;
    console.log(`\n  Type F sweep: ${fPassed}/${fTotal} passed (${fScore}/100)`);

    // Group by N for at-a-glance grid
    console.log("\n  Pass rate by N:");
    for (const N of [2, 3, 4, 5]) {
      const rows = fSummary.filter(s => s.n === N);
      if (rows.length === 0) continue;
      const passed = rows.filter(s => s.pass).length;
      const bar = "█".repeat(passed) + "░".repeat(rows.length - passed);
      console.log(`    N=${N}: [${bar}] ${passed}/${rows.length}`);
    }

    // Mixed-vs-single breakdown
    const singleSide = fSummary.filter(s => s.c === 0 || s.p === 0);
    const mixed = fSummary.filter(s => s.c > 0 && s.p > 0);
    console.log("\n  Mode breakdown:");
    console.log(`    Single-side (must yield 0 proposals): ${singleSide.filter(s => s.pass).length}/${singleSide.length} passed`);
    console.log(`    Mixed swap (must produce only displaced↔freed pairs): ${mixed.filter(s => s.pass).length}/${mixed.length} passed`);

    // Mixed scenarios that produced 0 proposals (no compatible swap available — informational, not failure)
    const mixedNoOutput = mixed.filter(s => s.proposals === 0 && s.pass);
    if (mixedNoOutput.length > 0) {
      console.log(`\n  ℹ ${mixedNoOutput.length} mixed scenario(s) passed with 0 proposals — no compatible availability between displaced clients and freed providers, but no isolation violation either.`);
    }
  }

  console.log("\n════════════════════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Simulation error:", err);
  prisma.$disconnect();
  process.exit(1);
});
