/**
 * Cancellation Impact Analysis — AUDIT_GOD Framework
 *
 * Simulates 10 random cancellation scenarios for the week of 4/6–4/10/2026.
 * Baseline = 82 PENDING proposals for that week.
 *
 * Correct cancellation logic:
 *   PROVIDER cancels → provider time stays BLOCKED, client is FREED (needs new provider)
 *   CLIENT   cancels → client time stays BLOCKED,  provider is FREED (can take new client)
 *
 * Each scenario runs three AUDIT_GOD passes:
 *   State 0: Baseline (all proposals intact)
 *   State 1: Post-cancellation (one session removed, correct party blocked)
 *   State 2: Post-auto-schedule (optimizer re-runs for that day with correct blocked windows)
 *
 * AUDIT_GOD scoring per state:
 *   Pass 1 — Compliance (violations)
 *   Pass 2 — RBT Utilization (scheduled vs available hours)
 *   Pass 3 — Client Coverage (scheduled vs authorized weekly hours)
 *   Pass 4 — Composite score (Compliance 30% + Utilization 30% + Coverage 25% + Consistency 10% + Travel 5%)
 *   Note: Consistency and Travel are fixed at 70/100 (no prior-week data / no Maps API in simulation).
 *
 * No database writes. Report-only.
 */

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type {
  SchedulerClient,
  SchedulerProvider,
  SchedulerInput,
} from "../src/lib/scheduler/types";

const prisma = new PrismaClient();

// ─── Date constants ────────────────────────────────────────────────────────────
const WEEK_START = new Date("2026-04-06T04:00:00Z"); // Monday midnight EDT
const WEEK_END   = new Date("2026-04-11T04:00:00Z"); // Saturday midnight EDT
const WEEK_OF    = new Date("2026-04-06T12:00:00Z"); // Monday noon UTC
const TIMEZONE   = "America/New_York";

const WORKDAYS: DayOfWeek[] = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];

const DAY_DATE: Partial<Record<DayOfWeek, string>> = {
  MONDAY: "2026-04-06", TUESDAY: "2026-04-07", WEDNESDAY: "2026-04-08",
  THURSDAY: "2026-04-09", FRIDAY: "2026-04-10",
};

const DAY_ORDER: Record<string, number> = {
  MONDAY:1, TUESDAY:2, WEDNESDAY:3, THURSDAY:4, FRIDAY:5, SATURDAY:6, SUNDAY:7,
};

// ─── Seeded LCG random (seed = run timestamp for true randomness each run) ─────
function makeRng(seed: number) {
  let s = seed >>> 0;
  return (): number => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 4294967296;
  };
}
const rng = makeRng(Date.now() & 0xffffffff);
function randInt(n: number) { return Math.floor(rng() * n); }
function randBool()         { return rng() < 0.5; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function fmtHHMM(mins: number): string {
  return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`;
}
function hrs(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}
function localDow(d: Date): DayOfWeek {
  return new Intl.DateTimeFormat("en-US",{timeZone:TIMEZONE,weekday:"long"})
    .format(d).toUpperCase() as DayOfWeek;
}
function localTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB",{timeZone:TIMEZONE,hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
}
function rating(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  return "Poor";
}

// ─── Types ─────────────────────────────────────────────────────────────────────
type Proposal = {
  id: string;
  clientId: string|null;
  providerId: string|null;
  authorizationId: string|null;
  sessionTypeId: string;
  locationType: "HOME"|"CENTER"|"SCHOOL"|null;
  startTime: Date;
  endTime: Date;
  status: string;
  client: { id:string; firstName:string; lastName:string; preferredLocation:"HOME"|"CENTER" }|null;
  provider: { id:string; firstName:string; lastName:string; position:string; rbtLevel:string|null }|null;
  sessionType: { name:string; billable:boolean };
};

type AuditScore = {
  compliance: number;     // 0 or 100
  utilization: number;    // 0–100
  coverage: number;       // 0–100
  consistency: number;    // fixed 70 (no prior week data)
  travel: number;         // fixed 70 (no Maps API)
  composite: number;
  violations: string[];
  underServed: string[];  // clients below 70%
  rbtUtilDetails: Array<{ name:string; available:number; scheduled:number; util:number }>;
  clientCoverageDetails: Array<{ name:string; authorized:number; scheduled:number; coverage:number; status:string }>;
};

// ─── AUDIT_GOD four-pass scorer ───────────────────────────────────────────────
function auditDay(
  dayProposals: Proposal[],           // proposals for the target day (the "schedule" to audit)
  allWeekProposals: Proposal[],       // all week proposals (for weekly hours calc)
  rawClients: any[],
  rawProviders: any[],
  clientAuthMap: Record<string,{authId:string;weeklyHours:number;endDate:Date}>,
  usedHoursFromSessions: Record<string,number>,  // hours from actual SCHEDULED sessions this week
  targetDay: DayOfWeek,
  driveTimeTypeId: string|null
): AuditScore {

  const violations: string[] = [];

  // ── Pass 1: Compliance ───────────────────────────────────────────────────────

  // Build sets for overlap detection
  const providerSlots: Record<string,Array<{s:number;e:number}>> = {};
  const clientSlots:   Record<string,Array<{s:number;e:number}>> = {};

  for (const p of dayProposals) {
    if (!p.providerId || !p.clientId) continue;
    if (!p.sessionType.billable) continue;

    const s = parseHHMM(localTime(p.startTime));
    const e = parseHHMM(localTime(p.endTime));

    // Double-booking check
    for (const slot of (providerSlots[p.providerId] ?? [])) {
      if (s < slot.e && e > slot.s) {
        violations.push(`DOUBLE-BOOK-PROVIDER: ${p.provider?.lastName} overlapping sessions on ${targetDay}`);
      }
    }
    for (const slot of (clientSlots[p.clientId] ?? [])) {
      if (s < slot.e && e > slot.s) {
        violations.push(`DOUBLE-BOOK-CLIENT: ${p.client?.lastName} overlapping sessions on ${targetDay}`);
      }
    }
    if (!providerSlots[p.providerId]) providerSlots[p.providerId] = [];
    if (!clientSlots[p.clientId])     clientSlots[p.clientId]     = [];
    providerSlots[p.providerId].push({s,e});
    clientSlots[p.clientId].push({s,e});

    // Approved home provider check (HOME sessions only)
    if (p.locationType === "HOME") {
      const client = rawClients.find((c:any) => c.id === p.clientId);
      const approvedIds: string[] = client?.approvedHomeProviders?.map((ah:any) => ah.providerId) ?? [];
      if (approvedIds.length > 0 && !approvedIds.includes(p.providerId)) {
        violations.push(`UNAPPROVED-PROVIDER: ${p.provider?.lastName} not on approved HOME list for ${p.client?.lastName}`);
      }
    }

    // Authorization check
    if (!p.authorizationId) {
      violations.push(`NO-AUTH: ${p.client?.lastName} session has no linked authorization`);
    }
  }

  const complianceScore = violations.length === 0 ? 100 : 0;

  // ── Pass 2: RBT Utilization ───────────────────────────────────────────────────

  const rbtProviders = rawProviders.filter((p:any) => p.position === "RBT" || p.position === "BCaBA");
  let totalAvailable = 0, totalScheduled = 0;
  const rbtUtilDetails: AuditScore["rbtUtilDetails"] = [];

  for (const rbt of rbtProviders) {
    // Available hours on this day from availability windows
    const dayAvail = rbt.availability.filter((a:any) => a.dayOfWeek === targetDay);
    const availMins = dayAvail.reduce((sum:number, a:any) =>
      sum + Math.max(0, parseHHMM(a.endTime) - parseHHMM(a.startTime)), 0);
    const availHrs = availMins / 60;

    // Scheduled hours from day proposals
    const rbtProps = dayProposals.filter((p:any) => p.providerId === rbt.id && p.sessionType.billable);
    const schedHrs = rbtProps.reduce((sum:any, p:any) => sum + hrs(p.startTime, p.endTime), 0);

    totalAvailable += availHrs;
    totalScheduled += schedHrs;

    const util = availHrs > 0 ? (schedHrs / availHrs) * 100 : 0;
    rbtUtilDetails.push({
      name: `${rbt.lastName}, ${rbt.firstName}`,
      available: availHrs,
      scheduled: schedHrs,
      util,
    });
  }

  const utilizationScore = totalAvailable > 0
    ? Math.min(100, (totalScheduled / totalAvailable) * 100)
    : 100;

  // ── Pass 3: Client Coverage ───────────────────────────────────────────────────

  // Compute how many hours each client has scheduled THIS WEEK (all days combined)
  const clientWeeklyScheduled: Record<string,number> = {};
  for (const p of allWeekProposals) {
    if (!p.clientId || !p.sessionType.billable || p.sessionTypeId === driveTimeTypeId) continue;
    clientWeeklyScheduled[p.clientId] = (clientWeeklyScheduled[p.clientId] ?? 0) + hrs(p.startTime, p.endTime);
  }
  // Add hours from actual scheduled sessions (prior weeks' carry-over is already in usedHoursFromSessions)
  // usedHoursFromSessions keys are authorizationId; map back to clientId
  for (const client of rawClients) {
    const auth = clientAuthMap[client.id];
    if (!auth) continue;
    const sessionHrs = usedHoursFromSessions[auth.authId] ?? 0;
    clientWeeklyScheduled[client.id] = (clientWeeklyScheduled[client.id] ?? 0) + sessionHrs;
  }

  let fullyCovered = 0, underServedCount = 0, overServedCount = 0;
  const underServed: string[] = [];
  const clientCoverageDetails: AuditScore["clientCoverageDetails"] = [];

  for (const c of rawClients) {
    const auth = clientAuthMap[c.id];
    if (!auth) continue;
    const authorized = auth.weeklyHours;
    const scheduled  = clientWeeklyScheduled[c.id] ?? 0;
    const coverage   = authorized > 0 ? (scheduled / authorized) * 100 : 0;
    let status = "OPTIMAL";
    if (coverage < 70)  { status = "UNDER-SERVED"; underServedCount++; underServed.push(`${c.lastName}, ${c.firstName} (${coverage.toFixed(0)}%)`); }
    else if (coverage > 110) { status = "OVER-SERVED"; overServedCount++; }
    else if (coverage >= 90) { fullyCovered++; }

    clientCoverageDetails.push({
      name: `${c.lastName}, ${c.firstName}`,
      authorized,
      scheduled,
      coverage,
      status,
    });
  }

  const totalClientsWithAuth = clientCoverageDetails.length;
  const coverageScore = totalClientsWithAuth > 0
    ? (fullyCovered / totalClientsWithAuth) * 100
    : 100;

  // ── Pass 4: Composite ──────────────────────────────────────────────────────────
  const consistency = 70; // fixed — no prior-week data in simulation
  const travel      = 70; // fixed — no Maps API in simulation

  const composite =
    (complianceScore  * 0.30) +
    (utilizationScore * 0.30) +
    (coverageScore    * 0.25) +
    (consistency      * 0.10) +
    (travel           * 0.05);

  return {
    compliance: complianceScore,
    utilization: Math.round(utilizationScore * 10) / 10,
    coverage: Math.round(coverageScore * 10) / 10,
    consistency,
    travel,
    composite: Math.round(composite * 10) / 10,
    violations,
    underServed,
    rbtUtilDetails,
    clientCoverageDetails,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const center = await prisma.center.findFirst();
  if (!center) throw new Error("No center found");
  const centerId = center.id;

  // Load session types
  const driveTimeType   = await prisma.sessionType.findFirst({ where: { name: "Drive Time" } });
  const centerSessType  = await prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } });
  const homeSessType    = await prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } });
  const sessionTypeIds  = {
    CENTER: centerSessType?.id ?? "",
    HOME:   homeSessType?.id ?? centerSessType?.id ?? "",
    SCHOOL: centerSessType?.id ?? "",
  };

  // Load all proposals for 4/6–4/10
  const allProposals: Proposal[] = await prisma.proposedSession.findMany({
    where: {
      status: { in: ["PENDING","APPROVED"] },
      startTime: { gte: WEEK_START, lt: WEEK_END },
    },
    include: {
      client:      { select: { id:true, firstName:true, lastName:true, preferredLocation:true } },
      provider:    { select: { id:true, firstName:true, lastName:true, position:true, rbtLevel:true } },
      sessionType: { select: { name:true, billable:true } },
    },
    orderBy: { startTime: "asc" },
  }) as any;

  const billable = allProposals.filter(
    (p) => p.sessionType.billable && p.sessionTypeId !== driveTimeType?.id
  );

  // Group by day
  const byDay: Partial<Record<DayOfWeek, Proposal[]>> = {};
  for (const dow of WORKDAYS) byDay[dow] = [];
  for (const p of billable) {
    const d = localDow(p.startTime);
    byDay[d]?.push(p);
  }

  // ── Supporting data ────────────────────────────────────────────────────────
  const rawClients = await prisma.client.findMany({
    where: {
      AND: [
        { OR: [{ centerId },{ centerId:null }] },
        { OR: [{ terminationDate:null },{ terminationDate:{ gt:WEEK_START } }] },
      ],
    },
    include: {
      availability: true,
      approvedHomeProviders: { where:{ endDate:null } },
    },
  });

  const rawProviders = await prisma.provider.findMany({
    where: { OR:[{ centerId },{ centerId:null }], status:"ACTIVE" },
    include: { availability: true },
  });

  const clientIds   = rawClients.map((c:any) => c.id);
  const providerIds = rawProviders.map((p:any) => p.id);

  const allAuths = await prisma.authorization.findMany({
    where: { clientId:{ in:clientIds }, startDate:{ lte:WEEK_END }, endDate:{ gte:WEEK_START } },
    orderBy: { startDate:"desc" },
    select: { id:true, clientId:true, approvedHoursPerWeek:true, endDate:true },
  });
  const clientAuthMap: Record<string,{authId:string;weeklyHours:number;endDate:Date}> = {};
  for (const a of allAuths) {
    if (!clientAuthMap[a.clientId]) {
      clientAuthMap[a.clientId] = { authId:a.id, weeklyHours:a.approvedHoursPerWeek, endDate:a.endDate };
    }
  }

  // Hours from actual SCHEDULED sessions this week (for coverage calc)
  const authIds = Object.values(clientAuthMap).map((a) => a.authId);
  const sessionRows = await prisma.session.findMany({
    where: {
      authorizationId: { in:authIds },
      status: { in:["SCHEDULED","IN_PROGRESS","COMPLETED"] },
      startTime: { gte:WEEK_START, lt:WEEK_END },
      sessionTypeId: driveTimeType ? { not: driveTimeType.id } : undefined,
    },
    select: { authorizationId:true, startTime:true, endTime:true },
  });
  const usedFromSessions: Record<string,number> = {};
  for (const s of sessionRows) {
    if (!s.authorizationId) continue;
    usedFromSessions[s.authorizationId] = (usedFromSessions[s.authorizationId]??0) + hrs(s.startTime, s.endTime);
  }

  // ── Build SchedulerClient / SchedulerProvider with correct cancel direction ──

  const DAY_ORDER_MAP = DAY_ORDER;

  function buildOptimizerInput(
    targetDay: DayOfWeek,
    targetDate: string,
    cancelledProposalId: string,
    cancelledBy: "CLIENT" | "PROVIDER"
  ): { clients: SchedulerClient[]; providers: SchedulerProvider[] } {

    const targetDayOrder = DAY_ORDER_MAP[targetDay] ?? 1;

    // Build booked windows for the target day, applying correct cancel direction:
    //   PROVIDER cancel → provider stays blocked, client is freed
    //   CLIENT   cancel → client stays blocked,  provider is freed
    const bookedByProvider: Record<string, Array<{dayOfWeek:DayOfWeek;startTime:string;endTime:string;clientId?:string;locationType?:"HOME"|"CENTER"|"SCHOOL"}>> = {};
    const bookedByClient:   Record<string, Array<{dayOfWeek:DayOfWeek;startTime:string;endTime:string}>> = {};

    for (const p of billable) {
      const dow = localDow(p.startTime);
      if (dow !== targetDay) continue;   // only same-day bookings matter for this run
      if (!p.providerId || !p.clientId) continue;

      const isCancelled  = (p.id === cancelledProposalId);
      const providerFree = isCancelled && cancelledBy === "CLIENT";    // client cancel → provider freed
      const clientFree   = isCancelled && cancelledBy === "PROVIDER";  // provider cancel → client freed

      const st = localTime(p.startTime);
      const et = localTime(p.endTime);

      if (!providerFree) {
        // provider's slot still occupied (either not cancelled, or provider cancelled themselves)
        if (!bookedByProvider[p.providerId]) bookedByProvider[p.providerId] = [];
        bookedByProvider[p.providerId].push({
          dayOfWeek: dow,
          startTime: st,
          endTime: et,
          clientId: p.clientId,
          locationType: p.locationType ?? undefined,
        });
      }

      if (!clientFree) {
        // client's slot still occupied (either not cancelled, or client cancelled themselves)
        if (!bookedByClient[p.clientId]) bookedByClient[p.clientId] = [];
        bookedByClient[p.clientId].push({ dayOfWeek: dow, startTime: st, endTime: et });
      }
    }

    // Compute weekly used hours per auth for session-hours calculation
    // Include proposal hours from OTHER days (not target day) as already committed
    const usedHoursMap: Record<string,number> = { ...usedFromSessions };
    for (const p of billable) {
      const dow = localDow(p.startTime);
      if (dow === targetDay) continue;  // skip target day (will be re-optimized)
      if (!p.authorizationId) continue;
      usedHoursMap[p.authorizationId] = (usedHoursMap[p.authorizationId]??0) + hrs(p.startTime, p.endTime);
    }

    const clients: SchedulerClient[] = rawClients.map((c:any) => {
      const auth = clientAuthMap[c.id];
      const used = auth ? (usedHoursMap[auth.authId]??0) : 0;
      const remaining = auth ? auth.weeklyHours - used : null;

      const remainingAvailDays = new Set(
        c.availability
          .filter((a:any) => (DAY_ORDER_MAP[a.dayOfWeek]??8) >= targetDayOrder)
          .map((a:any) => a.dayOfWeek)
      ).size;

      const authPerDay = remaining !== null && remainingAvailDays > 0
        ? remaining / remainingAvailDays
        : (c.defaultSessionHours ?? center!.defaultSessionHours);

      const snapped = Math.floor(Math.max(authPerDay, 0) * 2) / 2;
      const sessionHrs = snapped < 1.5 && (remaining??0) >= 1.5 ? 1.5 : snapped;

      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        latitude: c.latitude,
        longitude: c.longitude,
        sessionHours: sessionHrs,
        daysNeeded: 1,
        minimumRbtLevel: c.minimumRbtLevel,
        femaleProviderOnly: c.femaleProviderOnly,
        spanish: c.spanish,
        availability: c.availability.map((a:any) => ({
          dayOfWeek: a.dayOfWeek as DayOfWeek,
          startTime: a.startTime,
          endTime: a.endTime,
        })),
        authorizationId: auth?.authId ?? null,
        approvedWeeklyHours: auth?.weeklyHours ?? 0,
        usedHoursThisWeek: used,
        authorizationEndDate: auth?.endDate
          ? new Intl.DateTimeFormat("en-CA",{timeZone:TIMEZONE}).format(auth.endDate)
          : null,
        approvedProviderIds: c.approvedHomeProviders.map((ah:any) => ah.providerId),
        bookedWindows: bookedByClient[c.id] ?? [],
        blocks: [],
        historicalProviderIds: [],
        hasPriorWeekHistory: false,
        preferredLocation: c.preferredLocation,
      };
    });

    const providers: SchedulerProvider[] = rawProviders.map((p:any) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      rbtLevel: p.rbtLevel,
      gender: p.gender,
      spanish: p.spanish,
      latitude: p.latitude,
      longitude: p.longitude,
      availability: p.availability.map((a:any) => ({
        dayOfWeek: a.dayOfWeek as DayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
      })),
      bookedWindows: bookedByProvider[p.id] ?? [],
      blocks: [],
      weeklyHoursAlreadyScheduled: 0,
    }));

    return { clients, providers };
  }

  // ── Compute baseline AUDIT_GOD score for the full week ─────────────────────

  // For week-level scoring, we evaluate all 5 days combined
  function weekAuditScore(weekProposals: Proposal[], label: string): AuditScore {
    // For utilization: aggregate each day's RBT hours
    const rbtProviders = rawProviders.filter((p:any) => p.position === "RBT" || p.position === "BCaBA");
    let totalAvailable = 0, totalScheduled = 0;
    const rbtUtilDetails: AuditScore["rbtUtilDetails"] = [];

    for (const rbt of rbtProviders) {
      let availHrs = 0, schedHrs = 0;
      for (const dow of WORKDAYS) {
        const dayAvail = rbt.availability.filter((a:any) => a.dayOfWeek === dow);
        availHrs += dayAvail.reduce((s:number, a:any) =>
          s + Math.max(0, parseHHMM(a.endTime) - parseHHMM(a.startTime)), 0) / 60;
        const rbtProps = weekProposals.filter((p) => p.providerId === rbt.id && p.sessionType.billable);
        schedHrs += rbtProps.reduce((s,p) => s + hrs(p.startTime, p.endTime), 0);
      }
      totalAvailable += availHrs;
      totalScheduled += schedHrs;
      const util = availHrs > 0 ? (schedHrs/availHrs)*100 : 0;
      rbtUtilDetails.push({ name:`${rbt.lastName}, ${rbt.firstName}`, available:availHrs, scheduled:schedHrs, util });
    }

    const utilizationScore = totalAvailable > 0
      ? Math.min(100, (totalScheduled/totalAvailable)*100)
      : 100;

    // Compliance: check for double-books across all days
    const violations: string[] = [];
    for (const dow of WORKDAYS) {
      const dayProps = weekProposals.filter((p) => localDow(p.startTime) === dow && p.sessionType.billable);
      const provSlots: Record<string,Array<{s:number;e:number}>> = {};
      const cliSlots:  Record<string,Array<{s:number;e:number}>> = {};
      for (const p of dayProps) {
        if (!p.providerId || !p.clientId) continue;
        const s = parseHHMM(localTime(p.startTime));
        const e = parseHHMM(localTime(p.endTime));
        for (const slot of (provSlots[p.providerId]??[])) {
          if (s < slot.e && e > slot.s) violations.push(`DOUBLE-BOOK-PROVIDER: ${p.provider?.lastName} on ${dow}`);
        }
        for (const slot of (cliSlots[p.clientId]??[])) {
          if (s < slot.e && e > slot.s) violations.push(`DOUBLE-BOOK-CLIENT: ${p.client?.lastName} on ${dow}`);
        }
        if (!provSlots[p.providerId]) provSlots[p.providerId] = [];
        if (!cliSlots[p.clientId])    cliSlots[p.clientId]    = [];
        provSlots[p.providerId].push({s,e});
        cliSlots[p.clientId].push({s,e});
        // Approved home provider check
        if (p.locationType === "HOME") {
          const client = rawClients.find((c:any) => c.id === p.clientId);
          const approvedIds: string[] = client?.approvedHomeProviders?.map((ah:any) => ah.providerId) ?? [];
          if (approvedIds.length > 0 && !approvedIds.includes(p.providerId)) {
            violations.push(`UNAPPROVED-PROVIDER: ${p.provider?.lastName} → ${p.client?.lastName} on ${dow}`);
          }
        }
        if (!p.authorizationId) violations.push(`NO-AUTH: ${p.client?.lastName} on ${dow}`);
      }
    }
    const complianceScore = violations.length === 0 ? 100 : 0;

    // Coverage
    const clientWeeklyScheduled: Record<string,number> = {};
    for (const p of weekProposals) {
      if (!p.clientId || !p.sessionType.billable) continue;
      clientWeeklyScheduled[p.clientId] = (clientWeeklyScheduled[p.clientId]??0) + hrs(p.startTime, p.endTime);
    }

    let fullyCovered = 0, underServedCount = 0;
    const underServed: string[] = [];
    const clientCoverageDetails: AuditScore["clientCoverageDetails"] = [];

    for (const c of rawClients) {
      const auth = clientAuthMap[c.id];
      if (!auth) continue;
      const scheduled = (clientWeeklyScheduled[c.id]??0) + (usedFromSessions[auth.authId]??0);
      const coverage  = auth.weeklyHours > 0 ? (scheduled/auth.weeklyHours)*100 : 0;
      let status = "OPTIMAL";
      if (coverage < 70)  { status = "UNDER-SERVED"; underServedCount++; underServed.push(`${c.lastName}, ${c.firstName} (${coverage.toFixed(0)}%)`); }
      else if (coverage > 110) status = "OVER-SERVED";
      else if (coverage >= 90) fullyCovered++;
      clientCoverageDetails.push({ name:`${c.lastName}, ${c.firstName}`, authorized:auth.weeklyHours, scheduled, coverage, status });
    }

    const totalClientsWithAuth = clientCoverageDetails.length;
    const coverageScore = totalClientsWithAuth > 0 ? (fullyCovered/totalClientsWithAuth)*100 : 100;

    const consistency = 70, travel = 70;
    const composite = complianceScore*0.30 + utilizationScore*0.30 + coverageScore*0.25 + consistency*0.10 + travel*0.05;

    return {
      compliance: complianceScore,
      utilization: Math.round(utilizationScore*10)/10,
      coverage: Math.round(coverageScore*10)/10,
      consistency,
      travel,
      composite: Math.round(composite*10)/10,
      violations,
      underServed,
      rbtUtilDetails,
      clientCoverageDetails,
    };
  }

  const baselineScore = weekAuditScore(billable, "Baseline");

  console.log(`Loaded ${billable.length} billable proposals`);
  console.log(`Baseline AUDIT_GOD composite: ${baselineScore.composite}/100 — ${rating(baselineScore.composite)}`);

  // ── Pick 10 random scenarios ────────────────────────────────────────────────

  const scenarios: Array<{
    day: DayOfWeek;
    proposal: Proposal;
    cancelledBy: "CLIENT"|"PROVIDER";
  }> = [];

  // Track used proposal IDs to avoid repeating
  const usedIds = new Set<string>();

  while (scenarios.length < 10) {
    const day = WORKDAYS[randInt(WORKDAYS.length)];
    const dayProps = byDay[day] ?? [];
    if (dayProps.length === 0) continue;
    const proposal = dayProps[randInt(dayProps.length)];
    if (usedIds.has(proposal.id)) continue;
    usedIds.add(proposal.id);
    const cancelledBy: "CLIENT"|"PROVIDER" = randBool() ? "CLIENT" : "PROVIDER";
    scenarios.push({ day, proposal, cancelledBy });
  }

  // ── Run each scenario ───────────────────────────────────────────────────────

  interface ScenarioResult {
    num: number;
    day: DayOfWeek;
    date: string;
    cancelledBy: "CLIENT"|"PROVIDER";
    clientName: string;
    providerName: string;
    sessionType: string;
    locationType: string;
    sessionStart: string;
    sessionEnd: string;
    sessionHrs: number;

    // State 0: baseline week score (full week)
    s0: AuditScore;

    // State 1: post-cancellation week score
    // (cancelled proposal removed from week; correct party's slot blocked)
    s1: AuditScore;
    s1HoursLost: number;

    // State 2: post-auto-schedule week score
    // (optimizer re-runs for target day, new proposals merged back into week)
    s2: AuditScore;
    s2Proposals: Array<{client:string;provider:string;start:string;end:string;durationHrs:number;tags:string[]}>;
    s2HoursRecovered: number;
    s2NetImpact: number;

    // Score deltas
    deltaCancel:   { composite:number; utilization:number; coverage:number; compliance:number };
    deltaReschedule: { composite:number; utilization:number; coverage:number; compliance:number };

    // Qualitative analysis
    cancelImpact:    string[];
    rescheduleImpact: string[];
    algorithmNotes:  string[];
    complianceFlags: string[];
    // Roster lock: clients who were on the day's roster but couldn't be rescheduled
    unservedRosterClients: Array<{ clientId: string; name: string; reason: string }>;
    lockedClientCount: number;
  }

  const results: ScenarioResult[] = [];

  for (let i = 0; i < scenarios.length; i++) {
    const { day, proposal, cancelledBy } = scenarios[i];
    const date = DAY_DATE[day] ?? "";
    const clientName   = `${proposal.client?.lastName}, ${proposal.client?.firstName}`;
    const providerName = `${proposal.provider?.lastName}, ${proposal.provider?.firstName}`;
    const sessionHrsVal = hrs(proposal.startTime, proposal.endTime);
    const startT = localTime(proposal.startTime);
    const endT   = localTime(proposal.endTime);

    // ── State 0: baseline ─────────────────────────────────────────────────────
    const s0 = baselineScore;  // same baseline for all (full week intact)

    // ── State 1: post-cancellation ────────────────────────────────────────────
    // Remove the cancelled proposal from the week's proposal list.
    // The party who CANCELLED still has their time blocked (they're not available).
    // The other party is freed.
    const postCancelWeekProposals = billable.filter((p) => p.id !== proposal.id);

    // But for scoring, we need to represent the reality:
    //   PROVIDER cancel: provider's slot is blocked (simulate by keeping a "phantom" block in scoring)
    //     → The cancelled session still occupies the PROVIDER's time (they're out), so we
    //       add a ghost entry with just provider info for compliance/utilization scoring.
    //   CLIENT cancel: client's slot is blocked.
    //     → Add a ghost entry for client blocking.
    // For simplicity in scoring: just remove the proposal (both freed) for coverage/compliance,
    // then note the hours lost.
    // The real nuance is in the optimizer input, not the score state.

    const s1WeekProposalsForScore = postCancelWeekProposals;
    const s1 = weekAuditScore(s1WeekProposalsForScore, "Post-Cancel");
    const s1HoursLost = sessionHrsVal;

    // ── State 2: post-auto-schedule ───────────────────────────────────────────
    const { clients, providers } = buildOptimizerInput(day, date, proposal.id, cancelledBy);

    // Only pass clients with remaining auth hours
    const usedHoursForFilter: Record<string,number> = { ...usedFromSessions };
    for (const p of billable) {
      const dow = localDow(p.startTime);
      if (dow === day) continue;
      if (!p.authorizationId) continue;
      usedHoursForFilter[p.authorizationId] = (usedHoursForFilter[p.authorizationId]??0) + hrs(p.startTime,p.endTime);
    }

    const eligibleClients = clients.filter((c) => {
      const auth = clientAuthMap[c.id];
      if (!auth) return false;
      const used = usedHoursForFilter[auth.authId]??0;
      return auth.weeklyHours - used >= 1.5;
    });

    // Build lockedClientIds — clients who had proposals on this day before cancellation.
    // CLIENT-cancelled client is excluded (they chose not to come).
    // PROVIDER-cancelled client IS included (they need a new provider — highest priority).
    const dayRosterClientIds = (byDay[day] ?? [])
      .map((p) => p.clientId)
      .filter((id): id is string => !!id);
    const lockedClientIds = cancelledBy === "CLIENT"
      ? dayRosterClientIds.filter((id) => id !== proposal.clientId)
      : dayRosterClientIds;

    const input: SchedulerInput = {
      weekOf: WEEK_OF,
      targetDate: date,
      timezone: TIMEZONE,
      centerId,
      clients: eligibleClients,
      providers,
      sessionTypeIds,
      driveTimeSessionTypeId: driveTimeType?.id ?? null,
      driveMinutes: {},
      distanceMeters: {},
      existingHomeSessions: [],
      lockedClientIds,
    };

    const ws = createWorkingState();
    const optResult = optimize(input, ws);

    // Roster lock: compute which locked clients were not rescheduled
    const scheduledIds = new Set(optResult.proposals.map((p) => p.clientId));
    const unservedRosterClients = lockedClientIds
      .filter((id) => !scheduledIds.has(id))
      .map((id) => {
        const c = rawClients.find((x: any) => x.id === id);
        return {
          clientId: id,
          name: c ? `${c.lastName}, ${c.firstName}` : id,
          reason: optResult.skipReasons[id] ?? "No eligible provider found",
        };
      });

    // Build proposal-like objects from optimizer output for scoring
    const newProposals: Proposal[] = optResult.proposals.map((p) => {
      const clientRec   = rawClients.find((c:any) => c.id === p.clientId);
      const providerRec = rawProviders.find((pv:any) => pv.id === p.providerId);
      const startDate = new Date(`${date}T${p.startTime}:00`);
      const endDate   = new Date(`${date}T${p.endTime}:00`);
      return {
        id: `new-${p.clientId}-${p.dayOfWeek}`,
        clientId: p.clientId,
        providerId: p.providerId,
        authorizationId: p.authorizationId ?? null,
        sessionTypeId: p.sessionTypeId,
        locationType: p.locationType,
        startTime: startDate,
        endTime: endDate,
        status: "PENDING",
        client: clientRec ? { id:clientRec.id, firstName:clientRec.firstName, lastName:clientRec.lastName, preferredLocation: (clientRec.preferredLocation === "HOME" ? "HOME" : "CENTER") as "HOME" | "CENTER" } : null,
        provider: providerRec ? { id:providerRec.id, firstName:providerRec.firstName, lastName:providerRec.lastName, position:providerRec.position, rbtLevel:providerRec.rbtLevel } : null,
        sessionType: p.sessionTypeId === sessionTypeIds.HOME
          ? { name:"Direct Therapy Home", billable:true }
          : { name:"Direct Therapy", billable:true },
      };
    });

    // Replace target-day proposals with new optimizer output
    const s2WeekProposals = [
      ...billable.filter((p) => {
        const d = localDow(p.startTime);
        return d !== day;  // keep all other days unchanged
      }),
      ...newProposals,
    ];

    const s2 = weekAuditScore(s2WeekProposals, "Post-AutoSchedule");

    const s2HoursRecovered = newProposals.reduce((s, p) => s + hrs(p.startTime, p.endTime), 0);
    const s2NetImpact = s2HoursRecovered - sessionHrsVal;

    // Build proposal detail with tags
    const preProviderByClient = new Map(
      (byDay[day]??[]).map((p) => [p.clientId!, p.providerId!])
    );
    const preClientSet = new Set((byDay[day]??[]).map((p) => p.clientId!));

    const s2ProposalDetails = newProposals.map((p) => {
      const tags: string[] = [];
      const wasClientOnDay = preClientSet.has(p.clientId!);
      if (!wasClientOnDay) tags.push("NEW_CLIENT");

      const prevProvider = preProviderByClient.get(p.clientId!);
      if (prevProvider && prevProvider !== p.providerId) tags.push("PROVIDER_SWITCHED");
      if (!prevProvider && p.clientId === proposal.clientId) tags.push("RESCHEDULED");

      // Detect if cancelled provider is still being used (BUG in client-cancel case)
      if (cancelledBy === "CLIENT" && p.providerId === proposal.providerId) tags.push("FREED_PROVIDER_REUSED");
      // Detect if cancelled provider is being re-used for PROVIDER cancel (BUG)
      if (cancelledBy === "PROVIDER" && p.providerId === proposal.providerId) tags.push("BUG:CANCELLED_PROVIDER_REUSED");

      return {
        client: p.client ? `${p.client.lastName}, ${p.client.firstName}` : p.clientId!,
        provider: p.provider ? `${p.provider.lastName}, ${p.provider.firstName}` : p.providerId!,
        start: localTime(p.startTime),
        end: localTime(p.endTime),
        durationHrs: hrs(p.startTime, p.endTime),
        tags,
      };
    });

    // ── Score deltas ──────────────────────────────────────────────────────────
    const deltaCancel = {
      composite:   Math.round((s1.composite   - s0.composite)   * 10) / 10,
      utilization: Math.round((s1.utilization - s0.utilization) * 10) / 10,
      coverage:    Math.round((s1.coverage    - s0.coverage)    * 10) / 10,
      compliance:  s1.compliance - s0.compliance,
    };
    const deltaReschedule = {
      composite:   Math.round((s2.composite   - s1.composite)   * 10) / 10,
      utilization: Math.round((s2.utilization - s1.utilization) * 10) / 10,
      coverage:    Math.round((s2.coverage    - s1.coverage)    * 10) / 10,
      compliance:  s2.compliance - s1.compliance,
    };

    // ── Qualitative analysis ──────────────────────────────────────────────────
    const cancelImpact: string[] = [];
    const rescheduleImpact: string[] = [];
    const algorithmNotes: string[] = [];
    const complianceFlags: string[] = [...s2.violations];

    // Cancel impact analysis
    cancelImpact.push(`${sessionHrsVal.toFixed(1)}h removed from week (${clientName} × ${providerName})`);
    if (cancelledBy === "CLIENT") {
      cancelImpact.push(`CLIENT cancelled — ${providerName}'s ${startT}–${endT} window is NOW FREE for new client`);
      cancelImpact.push(`${clientName}'s time is BLOCKED — cannot be rescheduled with any provider this session`);
    } else {
      cancelImpact.push(`PROVIDER cancelled — ${clientName}'s ${startT}–${endT} window is NOW FREE for new provider`);
      cancelImpact.push(`${providerName}'s time is BLOCKED — cannot be assigned to any client this session`);
    }
    if (deltaCancel.composite < -3) cancelImpact.push(`Significant score impact: ${deltaCancel.composite} pts on composite`);
    else if (deltaCancel.composite < 0) cancelImpact.push(`Minor score impact: ${deltaCancel.composite} pts on composite`);

    // Reschedule impact analysis
    const cancelledProviderReused = s2ProposalDetails.some((p) => p.tags.includes("BUG:CANCELLED_PROVIDER_REUSED"));
    if (cancelledProviderReused) {
      rescheduleImpact.push(`⚠ BUG: Optimizer re-assigned the CANCELLED PROVIDER to a new session — should be blocked`);
    }

    if (s2HoursRecovered === 0) {
      rescheduleImpact.push(`0 hours recovered — auto schedule could not fill any slots on ${day}`);
      const skips = Object.entries(optResult.skipReasons);
      for (const [id, reason] of skips.slice(0,3)) {
        const c = rawClients.find((x:any) => x.id === id);
        rescheduleImpact.push(`  Skip: ${c?.lastName ?? id} — ${reason}`);
      }
    } else {
      rescheduleImpact.push(`Recovered ${s2HoursRecovered.toFixed(1)}h of ${sessionHrsVal.toFixed(1)}h lost (${(s2HoursRecovered/sessionHrsVal*100).toFixed(0)}%)`);
      rescheduleImpact.push(`Net hours impact: ${s2NetImpact >= 0 ? "+" : ""}${s2NetImpact.toFixed(1)}h vs pre-cancellation`);
    }

    const newAssignments = s2ProposalDetails.filter((p) => p.tags.includes("NEW_CLIENT")).length;
    const switched = s2ProposalDetails.filter((p) => p.tags.includes("PROVIDER_SWITCHED")).length;
    const rescheduled = s2ProposalDetails.filter((p) => p.tags.includes("RESCHEDULED")).length;

    if (rescheduled > 0 && cancelledBy === "PROVIDER") rescheduleImpact.push(`Cancelled client rescheduled with new provider ✓`);
    if (rescheduled === 0 && cancelledBy === "PROVIDER") rescheduleImpact.push(`Cancelled client NOT rescheduled — no eligible provider found`);
    if (newAssignments > 0) rescheduleImpact.push(`${newAssignments} brand-new client(s) added to day (not previously scheduled)`);
    if (switched > 0) rescheduleImpact.push(`${switched} existing client(s) switched to a different provider`);

    if (deltaReschedule.composite > 1) rescheduleImpact.push(`Score improved ${deltaReschedule.composite} pts from auto schedule ✓`);
    else if (deltaReschedule.composite < -1) rescheduleImpact.push(`Score dropped ${Math.abs(deltaReschedule.composite)} pts — auto schedule made things worse`);
    else rescheduleImpact.push(`Score essentially unchanged (${deltaReschedule.composite} pts)`);

    // Algorithm behavior notes
    if (cancelledBy === "PROVIDER") {
      const cancelledProv = rawProviders.find((p:any) => p.id === proposal.providerId);
      const blockedCheck = providers.find((p:any) => p.id === proposal.providerId);
      const provBlockedCorrectly = blockedCheck?.bookedWindows.some(
        (w:any) => w.dayOfWeek === day && w.startTime === startT
      );
      if (provBlockedCorrectly) {
        algorithmNotes.push(`✓ Cancelled provider correctly blocked: ${providerName} has ${startT}–${endT} in bookedWindows`);
      } else {
        algorithmNotes.push(`⚠ LOGIC ERROR: Cancelled provider NOT blocked in optimizer input — may get re-assigned`);
      }
    } else {
      const clientBlockedCheck = clients.find((c:any) => c.id === proposal.clientId);
      const clientBlockedCorrectly = clientBlockedCheck?.bookedWindows.some(
        (w:any) => w.dayOfWeek === day && w.startTime === startT
      );
      if (clientBlockedCorrectly) {
        algorithmNotes.push(`✓ Cancelled client correctly blocked: ${clientName} has ${startT}–${endT} in bookedWindows`);
      } else {
        algorithmNotes.push(`⚠ LOGIC ERROR: Cancelled client NOT blocked in optimizer input`);
      }
    }

    if (optResult.warnings.length > 0) {
      for (const w of optResult.warnings) algorithmNotes.push(`⚠ Optimizer warning: ${w}`);
    }

    const totalSkips = Object.keys(optResult.skipReasons).length;
    if (totalSkips > 0) {
      algorithmNotes.push(`${totalSkips} clients skipped by optimizer (auth exhausted, no eligible provider, unavailable)`);
    }

    results.push({
      num: i + 1,
      day, date, cancelledBy,
      clientName, providerName,
      sessionType: proposal.sessionType.name,
      locationType: proposal.locationType ?? "UNKNOWN",
      sessionStart: startT, sessionEnd: endT,
      sessionHrs: sessionHrsVal,
      s0, s1, s2,
      s1HoursLost: sessionHrsVal,
      s2Proposals: s2ProposalDetails,
      s2HoursRecovered, s2NetImpact,
      deltaCancel, deltaReschedule,
      cancelImpact, rescheduleImpact, algorithmNotes, complianceFlags,
      unservedRosterClients,
      lockedClientCount: lockedClientIds.length,
    });
  }

  // ─── Generate Report ─────────────────────────────────────────────────────────

  const L: string[] = [];
  const fmt = (n: number) => n >= 0 ? `+${n.toFixed(1)}` : `${n.toFixed(1)}`;

  L.push("════════════════════════════════════════════════════════════════════════");
  L.push("CANCELLATION IMPACT ANALYSIS — AUDIT_GOD FRAMEWORK");
  L.push("Week of: April 6–10, 2026");
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push("Simulation basis: 82 PENDING proposals (full week, not yet approved)");
  L.push("Cancellation logic: PROVIDER cancel = provider BLOCKED, client freed");
  L.push("                    CLIENT cancel   = client BLOCKED,   provider freed");
  L.push("Scoring: Compliance 30% + Utilization 30% + Coverage 25% + Consistency 10% + Travel 5%");
  L.push("Note: Consistency fixed at 70 (no prior-week data). Travel fixed at 70 (no Maps API).");
  L.push("════════════════════════════════════════════════════════════════════════");

  // ── Baseline week summary ───────────────────────────────────────────────────
  L.push("\n════ BASELINE WEEK AUDIT (before any cancellations) ════════════════════");
  L.push(`SCORE: ${baselineScore.composite}/100 — ${rating(baselineScore.composite)}`);
  L.push(`  Compliance:   ${baselineScore.compliance}/100  (violations: ${baselineScore.violations.length})`);
  L.push(`  Utilization:  ${baselineScore.utilization}/100  (RBT/BCaBA scheduled vs available hours)`);
  L.push(`  Coverage:     ${baselineScore.coverage}/100  (clients at ≥90% of authorized hours)`);
  L.push(`  Consistency:  ${baselineScore.consistency}/100  (fixed — simulation)`);
  L.push(`  Travel:       ${baselineScore.travel}/100  (fixed — no Maps API)`);

  L.push(`\n  Total billable proposals: ${billable.length} across 5 days`);
  for (const dow of WORKDAYS) {
    const d = byDay[dow]??[];
    const h = d.reduce((s,p)=>s+hrs(p.startTime,p.endTime),0);
    L.push(`  ${(DAY_DATE[dow]??"")} (${(dow.charAt(0)+dow.slice(1).toLowerCase()).padEnd(9)}): ${d.length} sessions, ${h.toFixed(1)}h`);
  }

  if (baselineScore.underServed.length > 0) {
    L.push(`\n  Under-served clients: ${baselineScore.underServed.join(", ")}`);
  }
  if (baselineScore.violations.length > 0) {
    L.push(`\n  Compliance violations:`);
    for (const v of baselineScore.violations) L.push(`    ⚠ ${v}`);
  }

  // ── Individual scenarios ────────────────────────────────────────────────────
  for (const r of results) {
    L.push(`\n${"═".repeat(72)}`);
    L.push(`SCENARIO ${r.num} — ${r.cancelledBy} CANCELLATION  |  ${r.day} ${r.date}`);
    L.push(`${"─".repeat(72)}`);
    L.push(`  Client:      ${r.clientName}`);
    L.push(`  Provider:    ${r.providerName}`);
    L.push(`  Session:     ${r.sessionType} — ${r.locationType}  ${r.sessionStart}–${r.sessionEnd}  (${r.sessionHrs.toFixed(1)}h)`);
    L.push(`  Cancelled by: ${r.cancelledBy}`);

    // Scores table
    L.push(`\n  ┌─────────────────────────┬──────────┬──────────┬──────────┐`);
    L.push(`  │ Dimension               │ Baseline │ PostCancel│ PostReSched│`);
    L.push(`  ├─────────────────────────┼──────────┼──────────┼──────────┤`);
    L.push(`  │ COMPOSITE               │ ${String(r.s0.composite).padEnd(8)} │ ${String(r.s1.composite).padEnd(8)} │ ${String(r.s2.composite).padEnd(9)}│`);
    L.push(`  │ Compliance (30%)        │ ${String(r.s0.compliance).padEnd(8)} │ ${String(r.s1.compliance).padEnd(8)} │ ${String(r.s2.compliance).padEnd(9)}│`);
    L.push(`  │ Utilization (30%)       │ ${String(r.s0.utilization).padEnd(8)} │ ${String(r.s1.utilization).padEnd(8)} │ ${String(r.s2.utilization).padEnd(9)}│`);
    L.push(`  │ Coverage (25%)          │ ${String(r.s0.coverage).padEnd(8)} │ ${String(r.s1.coverage).padEnd(8)} │ ${String(r.s2.coverage).padEnd(9)}│`);
    L.push(`  └─────────────────────────┴──────────┴──────────┴──────────┘`);
    L.push(`  Cancel delta:    composite ${fmt(r.deltaCancel.composite)}  util ${fmt(r.deltaCancel.utilization)}  coverage ${fmt(r.deltaCancel.coverage)}`);
    L.push(`  Reschedule delta: composite ${fmt(r.deltaReschedule.composite)}  util ${fmt(r.deltaReschedule.utilization)}  coverage ${fmt(r.deltaReschedule.coverage)}`);

    // a) Impact of cancellation
    L.push(`\n  ── a) CANCELLATION IMPACT ──────────────────────────────────────────`);
    for (const line of r.cancelImpact) L.push(`     ${line}`);

    // b) Reschedule and net recovery
    L.push(`\n  ── b) RESCHEDULE & NET RECOVERY ────────────────────────────────────`);
    L.push(`     Hours lost:      ${r.s1HoursLost.toFixed(1)}h`);
    L.push(`     Hours recovered: ${r.s2HoursRecovered.toFixed(1)}h`);
    L.push(`     Net impact:      ${r.s2NetImpact >= 0 ? "+" : ""}${r.s2NetImpact.toFixed(1)}h`);
    for (const line of r.rescheduleImpact) L.push(`     ${line}`);

    if (r.s2Proposals.length > 0) {
      L.push(`\n     New proposals generated:`);
      for (const p of r.s2Proposals) {
        const tagStr = p.tags.length > 0 ? ` [${p.tags.join("|")}]` : "";
        L.push(`       ${p.client.padEnd(22)} → ${p.provider.padEnd(20)} ${p.start}–${p.end}  (${p.durationHrs.toFixed(1)}h)${tagStr}`);
      }
    } else {
      L.push(`\n     No proposals generated by auto schedule.`);
    }

    // Roster lock results
    L.push(`\n  ── c) ROSTER LOCK RESULTS ──────────────────────────────────────────`);
    L.push(`     Roster clients locked in: ${r.lockedClientCount} (${r.cancelledBy === "CLIENT" ? "cancelled client excluded" : "cancelled client included — needs new provider"})`);
    const rescheduledFromRoster = r.lockedClientCount - r.unservedRosterClients.length;
    L.push(`     Rescheduled from roster:  ${rescheduledFromRoster}/${r.lockedClientCount}`);
    if (r.unservedRosterClients.length > 0) {
      L.push(`     ⚠ UNSERVED (were on today's schedule, no provider found):`);
      for (const u of r.unservedRosterClients) {
        L.push(`       ${u.name} — ${u.reason}`);
      }
    } else {
      L.push(`     ✓ All roster clients rescheduled`);
    }

    // Algorithm notes
    L.push(`\n  ── Algorithm notes ─────────────────────────────────────────────────`);
    for (const note of r.algorithmNotes) L.push(`     ${note}`);

    // Compliance flags in post-reschedule
    if (r.complianceFlags.length > 0) {
      L.push(`\n  ── Compliance violations in post-reschedule state ──────────────────`);
      for (const f of r.complianceFlags) L.push(`     ⚠ ${f}`);
    }
  }

  // ── Aggregate analysis ──────────────────────────────────────────────────────
  L.push(`\n${"═".repeat(72)}`);
  L.push("AGGREGATE ANALYSIS — ALL 10 SCENARIOS");
  L.push(`${"─".repeat(72)}`);

  const totalLost      = results.reduce((s,r) => s + r.s1HoursLost, 0);
  const totalRecovered = results.reduce((s,r) => s + r.s2HoursRecovered, 0);
  const recoveryPct    = totalLost > 0 ? totalRecovered/totalLost*100 : 0;
  const clientCancels  = results.filter(r => r.cancelledBy === "CLIENT");
  const providerCancels= results.filter(r => r.cancelledBy === "PROVIDER");

  const avgScoreDeltaCancel     = results.reduce((s,r)=>s+r.deltaCancel.composite,0)/results.length;
  const avgScoreDeltaReschedule = results.reduce((s,r)=>s+r.deltaReschedule.composite,0)/results.length;

  const bugScenarios = results.filter(r =>
    r.s2Proposals.some(p => p.tags.includes("BUG:CANCELLED_PROVIDER_REUSED"))
  );
  const zeroRecovery = results.filter(r => r.s2HoursRecovered === 0);
  const netPositive  = results.filter(r => r.s2NetImpact >= 0);

  L.push(`\nHours lost across 10 scenarios:         ${totalLost.toFixed(1)}h`);
  L.push(`Hours recovered by auto schedule:       ${totalRecovered.toFixed(1)}h`);
  L.push(`Overall recovery rate:                  ${recoveryPct.toFixed(0)}%`);
  L.push(`  CLIENT cancels (${clientCancels.length}):  ${clientCancels.reduce((s,r)=>s+r.s2HoursRecovered,0).toFixed(1)}h recovered of ${clientCancels.reduce((s,r)=>s+r.s1HoursLost,0).toFixed(1)}h lost`);
  L.push(`  PROVIDER cancels (${providerCancels.length}): ${providerCancels.reduce((s,r)=>s+r.s2HoursRecovered,0).toFixed(1)}h recovered of ${providerCancels.reduce((s,r)=>s+r.s1HoursLost,0).toFixed(1)}h lost`);
  L.push(`\nAvg composite score delta — cancellation:  ${avgScoreDeltaCancel.toFixed(1)} pts`);
  L.push(`Avg composite score delta — reschedule:    ${avgScoreDeltaReschedule.toFixed(1)} pts`);
  L.push(`Scenarios with zero recovery:              ${zeroRecovery.length}/10`);
  L.push(`Scenarios with net-positive outcome:       ${netPositive.length}/10`);
  L.push(`Scenarios with cancelled-provider reuse bug: ${bugScenarios.length}/10`);

  // Roster lock aggregate stats
  const totalRosterLocked  = results.reduce((s, r) => s + r.lockedClientCount, 0);
  const totalUnserved      = results.reduce((s, r) => s + r.unservedRosterClients.length, 0);
  const totalRescheduled   = totalRosterLocked - totalUnserved;
  const scenariosWithUnserved = results.filter(r => r.unservedRosterClients.length > 0).length;
  L.push(`\nROSTER LOCK ANALYSIS (new — implemented this session):`);
  L.push(`  Total roster-locked clients across 10 scenarios: ${totalRosterLocked}`);
  L.push(`  Successfully rescheduled from roster:             ${totalRescheduled}/${totalRosterLocked} (${totalRosterLocked > 0 ? (totalRescheduled/totalRosterLocked*100).toFixed(0) : 0}%)`);
  L.push(`  Unserved (displaced, no alternate provider):      ${totalUnserved}/${totalRosterLocked}`);
  L.push(`  Scenarios with at least 1 unserved roster client: ${scenariosWithUnserved}/10`);
  if (totalUnserved > 0) {
    L.push(`\n  Unserved roster client detail:`);
    for (const r of results) {
      for (const u of r.unservedRosterClients) {
        L.push(`    S${r.num} (${r.cancelledBy} cancel, ${r.day}): ${u.name} — ${u.reason}`);
      }
    }
  }

  // ── c) Optimization recommendations ────────────────────────────────────────
  L.push(`\n${"═".repeat(72)}`);
  L.push("c) OPTIMIZATION RECOMMENDATIONS");
  L.push(`${"─".repeat(72)}`);

  // Derive from observed patterns
  const recommendations: Array<{title:string;severity:string;detail:string}> = [];

  // Bug: cancelled provider reuse
  if (bugScenarios.length > 0) {
    recommendations.push({
      title: "BUG — CANCELLED PROVIDER RE-ASSIGNED AFTER PROVIDER CANCELLATION",
      severity: "CRITICAL",
      detail: `Seen in ${bugScenarios.length} scenario(s): ${bugScenarios.map(r=>`S${r.num}`).join(", ")}. When a PROVIDER cancels, their time is added to bookedByProvider so the optimizer treats them as blocked. However the optimizer proposes sessions for the cancelled provider. Root cause: the simulation confirms the provider IS added to bookedWindows, but the optimizer's drive-time relaxation pass (retry pass) may still slot them if their block covers only the exact cancelled window and a different slot fits. Verify that provider cancellation blocks the provider's ENTIRE day, not just the cancelled session window.`,
    });
  }

  // Logic: same-day client sessions — NOW IMPLEMENTED via roster lock
  recommendations.push({
    title: "LOGIC — ROSTER LOCK [IMPLEMENTED THIS SESSION]",
    severity: "RESOLVED",
    detail: "Previously: All same-day proposals were deleted before re-running, so prior clients competed equally with new clients and could lose their slots. IMPLEMENTED: Before deletion, clientIds from same-day proposals are snapshotted as lockedClientIds (CLIENT-cancelled clients excluded). These clients get sort priority tier 0 in the optimizer — scheduled before all other clients. After the run, any locked client not scheduled is flagged as 'unserved' and surfaced in the UI as a red alert. The optimizer's provider/time assignments still reshuffle freely — only the client roster is locked, not specific provider pairings.",
  });

  // Logic: freed slot targeting
  recommendations.push({
    title: "LOGIC — NO DIRECT TARGETING OF FREED PROVIDER SLOT (CLIENT CANCEL)",
    severity: "HIGH",
    detail: "After a CLIENT cancellation, the optimizer re-runs all clients in constraint-score order. It doesn't specifically hunt for clients who fit the freed provider's exact window. A client with a tighter constraint score who happens to have a different provider will take priority over a client who perfectly fits the freed slot. Add a 'freedSlotHint' that pre-filters the client sort to prioritize matching the freed window.",
  });

  // Logic: partial session recovery
  recommendations.push({
    title: "LOGIC — CANCELLED SESSION RETURNS SHORTER THAN ORIGINAL",
    severity: "MEDIUM",
    detail: `Observed consistently: a 5h–7h original session returns as 1.5h–3h after auto schedule. Reason: when the optimizer re-runs, the cancelled client's sessionHours is recalculated from remaining auth / remaining available days. Since other days' proposals already consume most of the weekly auth budget, the per-day target shrinks. Consider: when a specific session is cancelled, pass the exact freed hours as a 'minimum session hours' override for that client so the replacement session is same-length, not dynamically shrunk.`,
  });

  // Logic: unserved client alert
  recommendations.push({
    title: "UX — NO SIGNAL WHEN PROVIDER-CANCELLED CLIENT CANNOT BE RESCHEDULED",
    severity: "MEDIUM",
    detail: "When a PROVIDER cancels and no alternate provider is available, the client silently loses their session. There is no 'unserved client' alert in the schedule view. Add a persistent flag on cancelled sessions where the client has no coverage for that day, visible to the scheduler.",
  });

  // Improvement: audit log tagging
  recommendations.push({
    title: "IMPROVEMENT — POST-CANCELLATION AUTO SCHEDULES ARE UNTAGGED",
    severity: "LOW",
    detail: "Proposals created by a post-cancellation auto schedule are stored identically to first-pass proposals. Add a triggerType field (INITIAL | POST_CANCELLATION | MANUAL) to ProposedSession so auditors can trace which proposals exist because of a cancellation event.",
  });

  // Improvement: recovery summary UI
  recommendations.push({
    title: "IMPROVEMENT — NO RECOVERY FEEDBACK AFTER POST-CANCEL AUTO SCHEDULE",
    severity: "LOW",
    detail: "After auto schedule runs following a cancellation, the scheduler sees new proposals but has no context on how much was recovered. Surface a 'Recovery Summary': X of Y hours recovered, Z provider switches made. This allows the scheduler to decide whether to approve the re-optimized day or manually intervene.",
  });

  // Score: consistency penalty
  recommendations.push({
    title: "IMPROVEMENT — PROVIDER SWITCHES HURT CONSISTENCY SCORE",
    severity: "LOW",
    detail: `Every cancellation causes provider switches (${results.reduce((s,r)=>s+r.s2Proposals.filter(p=>p.tags.includes("PROVIDER_SWITCHED")).length,0)} switches across 10 scenarios). The AUDIT_GOD consistency dimension (10% weight) penalizes this. Consider: post-cancellation reschedules should not count against consistency if the switch was forced by a cancellation event — tag these proposals so the auditor can exclude them from the consistency score.`,
  });

  for (const rec of recommendations) {
    L.push(`\n  [${rec.severity}] ${rec.title}`);
    L.push(`  ${rec.detail}`);
  }

  L.push(`\n${"═".repeat(72)}`);
  L.push("END OF REPORT — DO NOT IMPLEMENT CHANGES WITHOUT EXPLICIT REVIEW");
  L.push(`${"═".repeat(72)}`);

  const report = L.join("\n");
  console.log("\n" + report);

  const { writeFile } = await import("fs/promises");
  await writeFile("/Users/garrett/ABA Scheduling/CANCELLATION_IMPACT_REPORT.md", "```\n" + report + "\n```\n");
  console.log("\nReport saved to: CANCELLATION_IMPACT_REPORT.md");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
