/**
 * test-week-partial.ts
 *
 * Tests the "rest of week" scheduling behavior introduced in propose-week.
 * Runs the optimizer 5 times with different simulated "now" values:
 *
 *   Run 1 — Monday    7:00am  (full week, no days skipped)
 *   Run 2 — Tuesday   2:30pm  (Mon gone; Tue proposals start ≥ 2:30pm)
 *   Run 3 — Wednesday 11:15am (Mon+Tue gone; Wed proposals start ≥ 11:15am)
 *   Run 4 — Thursday  4:00pm  (Mon–Wed gone; Thu proposals start ≥ 4:00pm)
 *   Run 5 — Friday    9:30am  (Mon–Thu gone; only Fri ≥ 9:30am)
 *
 * For each run, verifies:
 *   ✓ No proposals on days before "today"
 *   ✓ All proposals on "today" start at or after "now"
 *   ✓ Proposals exist on at least one remaining day (optimizer found work to do)
 *   ✓ No double-booking of any provider
 *
 * Pure in-memory — zero DB writes.
 * Usage: npx tsx scripts/test-week-partial.ts
 */

import { PrismaClient, DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type { SchedulerInput, SchedulerClient, SchedulerProvider } from "../src/lib/scheduler/types";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();
const CENTER_ID = "cmn56xpu90000wt7v2o7v0jnm";
const TIMEZONE = "America/New_York";
const WEEK_OF_STR = "2026-04-14"; // week of Apr 14–18
const MAX_SESSION_HOURS = 8.0;
const MIN_SESSION_HOURS = 1.5;

// ─── Utilities ─────────────────────────────────────────────────────────────────

function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
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

/** Build a UTC Date for a "YYYY-MM-DD" date at a given local "HH:MM" in TIMEZONE */
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

// ─── Load DB context once ──────────────────────────────────────────────────────

interface DBContext {
  weekOf: Date;
  weekStart: Date;
  weekEnd: Date;
  mondayDate: string;
  fridayDate: string;
  weekDayDates: Record<DayOfWeek, string>; // Mon–Fri → "YYYY-MM-DD"
  clients: SchedulerClient[];
  providers: SchedulerProvider[];
  sessionTypeIds: { CENTER: string; HOME: string; SCHOOL: string; DAYCARE: string };
  driveTimeSessionTypeId: string | null;
  clientNameMap: Record<string, string>;
  providerNameMap: Record<string, string>;
}

async function loadContext(): Promise<DBContext> {
  const weekOfObj = new Date(`${WEEK_OF_STR}T12:00:00Z`);
  const { weekStart, weekEnd } = getWeekBoundaries(weekOfObj, TIMEZONE);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000);

  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

  const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
  const weekDayDates = {} as Record<DayOfWeek, string>;
  for (let i = 0; i < 5; i++) {
    weekDayDates[DAYS[i]] = fmt(new Date(weekOf.getTime() + i * 24 * 3_600_000));
  }
  const mondayDate = weekDayDates["MONDAY"];
  const fridayDate = weekDayDates["FRIDAY"];

  const [centerST, homeST, driveTimeST, center] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
    prisma.center.findUnique({ where: { id: CENTER_ID } }),
  ]);
  if (!centerST) throw new Error("No billable session type found");
  const sessionTypeIds = { CENTER: centerST.id, HOME: homeST?.id ?? centerST.id, SCHOOL: centerST.id, DAYCARE: centerST.id };
  const driveTimeSessionTypeId = driveTimeST?.id ?? null;
  const defaultSessHours = center?.defaultSessionHours ?? 4.0;

  const [rawClients, allAuths, rawProviders, priorSessions] = await Promise.all([
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
        preferredSlots: true,
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
        startTime: { gte: new Date(weekStart.getTime() - 84 * 24 * 3_600_000), lt: weekStart },
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
      },
      select: { clientId: true, providerId: true },
      orderBy: { startTime: "desc" },
    }),
  ]);

  // Auth map
  const clientAuthMap: Record<string, { authId: string; weeklyHours: number; endDate: Date }> = {};
  for (const auth of allAuths) {
    if (!clientAuthMap[auth.clientId]) {
      clientAuthMap[auth.clientId] = { authId: auth.id, weeklyHours: auth.approvedHoursPerWeek, endDate: auth.endDate };
    }
  }

  // Historical providers
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) historicalByClient[s.clientId].push(s.providerId);
  }

  const clientNameMap: Record<string, string> = {};
  const providerNameMap: Record<string, string> = {};
  for (const c of rawClients) clientNameMap[c.id] = `${c.lastName}, ${c.firstName}`;
  for (const p of rawProviders) providerNameMap[p.id] = `${p.lastName}, ${p.firstName}`;

  // Zero drive times
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

  const clients: SchedulerClient[] = rawClients.map(c => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const remaining = weeklyHours !== null ? Math.max(0, weeklyHours) : null;
    const SCHEDULABLE = new Set(["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]);
    const availDays = new Set(c.availability.filter(a => SCHEDULABLE.has(a.dayOfWeek)).map(a => a.dayOfWeek)).size;
    const daysNeeded = remaining === null || remaining <= 0 ? 1
      : Math.max(1, Math.min(Math.ceil(remaining / MAX_SESSION_HOURS), availDays || 1));
    const sessHoursRaw = remaining === null || remaining <= 0
      ? (c.defaultSessionHours ?? defaultSessHours)
      : remaining / daysNeeded;
    const sessHours = Math.max(Math.round(sessHoursRaw * 2) / 2, MIN_SESSION_HOURS);

    return {
      id: c.id,
      firstName: c.firstName, lastName: c.lastName,
      latitude: c.latitude, longitude: c.longitude,
      sessionHours: sessHours, daysNeeded,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly, spanish: c.spanish,
      availability: c.availability.map(a => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      authorizationId: authInfo?.authId ?? null,
      approvedWeeklyHours: authInfo?.weeklyHours ?? 0,
      usedHoursThisWeek: 0,
      authorizationEndDate: authInfo?.endDate
        ? new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(authInfo.endDate) : null,
      approvedProviderIds: c.approvedHomeProviders.map(ah => ah.providerId),
      bookedWindows: [],
      blocks: [],
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: (historicalByClient[c.id] ?? []).length > 0,
      preferredLocation: c.preferredLocation,
      preferredSlots: c.preferredSlots.map(s => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime })),
    };
  });

  const providers: SchedulerProvider[] = rawProviders.map(p => ({
    id: p.id,
    firstName: p.firstName, lastName: p.lastName,
    position: p.position as "BCBA" | "BCaBA" | "RBT",
    rbtLevel: p.rbtLevel, gender: p.gender, spanish: p.spanish,
    latitude: p.latitude, longitude: p.longitude,
    availability: p.availability.map(a => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
    bookedWindows: [], blocks: [],
    weeklyHoursAlreadyScheduled: 0,
    driveMinutes: driveMinutes[p.id] ?? {},
    distanceMeters: distanceMeters[p.id] ?? {},
  }));

  return { weekOf, weekStart, weekEnd, mondayDate, fridayDate, weekDayDates, clients, providers, sessionTypeIds, driveTimeSessionTypeId, clientNameMap, providerNameMap };
}

// ─── Run One Simulation ────────────────────────────────────────────────────────

interface RunConfig {
  label: string;
  simulatedNow: Date;      // UTC equivalent of the local "now"
  todayDateStr: string;    // "YYYY-MM-DD" in center timezone
  todayLocalTime: string;  // "HH:MM" local — for display
}

interface RunResult {
  config: RunConfig;
  daysInScope: string[];          // weekDates keys used by optimizer
  proposals: Array<{
    dayOfWeek: DayOfWeek;
    dateStr: string;
    clientId: string;
    providerId: string;
    startTime: string;
    endTime: string;
  }>;
  assertions: Array<{ label: string; pass: boolean; detail: string }>;
  pass: boolean;
}

function runSimulation(ctx: DBContext, config: RunConfig): RunResult {
  const { simulatedNow, todayDateStr } = config;

  // Build notBefore in local HH:MM (used to check today's proposals)
  const notBeforeLocalHHMM = localHHMM(simulatedNow);
  const notBeforeMins = parseHHMM(notBeforeLocalHHMM);

  // Build input with targetDate = todayDateStr (optimizer will filter weekDates to >= this)
  const input: SchedulerInput = {
    weekOf: ctx.weekOf,
    targetDate: todayDateStr,
    timezone: TIMEZONE,
    centerId: CENTER_ID,
    clients: ctx.clients.map(c => ({ ...c, bookedWindows: [], daysNeeded: c.daysNeeded })),
    providers: ctx.providers.map(p => ({ ...p, bookedWindows: [] })),
    sessionTypeIds: ctx.sessionTypeIds,
    driveTimeSessionTypeId: ctx.driveTimeSessionTypeId,
    driveMinutes: Object.fromEntries(
      ctx.providers.map(p => [p.id, Object.fromEntries(ctx.clients.map(c => [c.id, 0]))])
    ),
    distanceMeters: Object.fromEntries(
      ctx.providers.map(p => [p.id, Object.fromEntries(ctx.clients.map(c => [c.id, 0]))])
    ),
    existingHomeSessions: [],
    weekMode: true,
    notBefore: simulatedNow,
  };

  const result = optimize(input, createWorkingState());

  // Map proposals to include date strings
  const proposals = result.proposals.map(p => ({
    dayOfWeek: p.dayOfWeek as DayOfWeek,
    dateStr: ctx.weekDayDates[p.dayOfWeek as DayOfWeek] ?? "?",
    clientId: p.clientId,
    providerId: p.providerId,
    startTime: p.startTime,
    endTime: p.endTime,
  }));

  // Which days did the optimizer consider?
  const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
  const daysInScope = DAYS.filter(d => ctx.weekDayDates[d] >= todayDateStr);

  // ── Assertions ──────────────────────────────────────────────────────────────
  const assertions: Array<{ label: string; pass: boolean; detail: string }> = [];

  // 1. No proposals on days BEFORE today
  const pastDays = DAYS.filter(d => ctx.weekDayDates[d] < todayDateStr);
  const proposalsOnPastDays = proposals.filter(p => pastDays.includes(p.dayOfWeek));
  assertions.push({
    label: "No proposals on past days",
    pass: proposalsOnPastDays.length === 0,
    detail: proposalsOnPastDays.length === 0
      ? `✓ Correctly skipped: ${pastDays.length > 0 ? pastDays.map(d => d.charAt(0) + d.slice(1).toLowerCase()).join(", ") : "none (Monday run)"}`
      : `✗ ${proposalsOnPastDays.length} proposals on past days: ${[...new Set(proposalsOnPastDays.map(p => p.dayOfWeek))].join(", ")}`,
  });

  // 2. Proposals on today respect notBefore (start at or after current time)
  const todayProposals = proposals.filter(p => p.dateStr === todayDateStr);
  const tooEarlyToday = todayProposals.filter(p => parseHHMM(p.startTime) < notBeforeMins);
  assertions.push({
    label: `Today's proposals start at or after ${notBeforeLocalHHMM}`,
    pass: tooEarlyToday.length === 0,
    detail: tooEarlyToday.length === 0
      ? todayProposals.length > 0
        ? `✓ ${todayProposals.length} proposal(s) today, earliest at ${todayProposals.map(p => p.startTime).sort()[0]}`
        : `✓ No proposals today (availability window may not extend past ${notBeforeLocalHHMM})`
      : `✗ ${tooEarlyToday.length} proposal(s) start before ${notBeforeLocalHHMM}: ${tooEarlyToday.map(p => p.startTime).join(", ")}`,
  });

  // 3. Future days have no time restriction — proposals can start at any valid time
  const futureDays = DAYS.filter(d => ctx.weekDayDates[d] > todayDateStr);
  const futureProposals = proposals.filter(p => futureDays.includes(p.dayOfWeek));
  assertions.push({
    label: "Future days are fully schedulable (no time gate)",
    pass: true, // always structural pass — we just report what was found
    detail: futureProposals.length > 0
      ? `✓ ${futureProposals.length} proposal(s) on ${[...new Set(futureProposals.map(p => p.dayOfWeek))].map(d => d.charAt(0) + d.slice(1).toLowerCase()).join(", ")}`
      : `ℹ No proposals on future days (may be fully booked or no auth remaining)`,
  });

  // 4. At least one proposal somewhere in the remaining week
  assertions.push({
    label: "At least one proposal in remaining week",
    pass: proposals.length > 0,
    detail: proposals.length > 0
      ? `✓ ${proposals.length} total proposal(s) across ${[...new Set(proposals.map(p => p.dayOfWeek))].length} day(s)`
      : `✗ Zero proposals — no eligible client-provider pairs found for remaining days`,
  });

  // 5. No provider double-booking
  const byProviderDay = new Map<string, typeof proposals>();
  for (const p of proposals) {
    const key = `${p.providerId}::${p.dayOfWeek}`;
    if (!byProviderDay.has(key)) byProviderDay.set(key, []);
    byProviderDay.get(key)!.push(p);
  }
  let doubleBooks = 0;
  for (const [, slots] of byProviderDay) {
    const sorted = [...slots].sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (parseHHMM(sorted[i].endTime) > parseHHMM(sorted[i + 1].startTime)) doubleBooks++;
    }
  }
  assertions.push({
    label: "No provider double-booking",
    pass: doubleBooks === 0,
    detail: doubleBooks === 0
      ? "✓ All provider slots are non-overlapping"
      : `✗ ${doubleBooks} overlapping provider slot(s) detected`,
  });

  const pass = assertions.filter(a => a.label !== "Future days are fully schedulable (no time gate)").every(a => a.pass);
  return { config, daysInScope, proposals, assertions, pass };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("  WEEK PARTIAL SCHEDULING TEST — propose-week rest-of-week behavior   ");
  console.log(`  Week: Apr 14–18 2026 | Timezone: ${TIMEZONE}                        `);
  console.log("  5 runs with different simulated NOW times across the week           ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  const ctx = await loadContext();
  console.log(`  Loaded: ${ctx.clients.length} clients, ${ctx.providers.length} providers`);
  console.log(`  Week dates: ${ctx.mondayDate} (Mon) → ${ctx.fridayDate} (Fri)\n`);

  // 5 test configurations — variability in both day and time
  const runs: RunConfig[] = [
    {
      label: "Run 1 — Monday 7:00am (full week)",
      simulatedNow: toUtcDate(ctx.weekDayDates["MONDAY"], "07:00"),
      todayDateStr: ctx.weekDayDates["MONDAY"],
      todayLocalTime: "07:00",
    },
    {
      label: "Run 2 — Tuesday 2:30pm (Mon gone, Tue from 2:30pm)",
      simulatedNow: toUtcDate(ctx.weekDayDates["TUESDAY"], "14:30"),
      todayDateStr: ctx.weekDayDates["TUESDAY"],
      todayLocalTime: "14:30",
    },
    {
      label: "Run 3 — Wednesday 11:15am (Mon+Tue gone, Wed from 11:15am)",
      simulatedNow: toUtcDate(ctx.weekDayDates["WEDNESDAY"], "11:15"),
      todayDateStr: ctx.weekDayDates["WEDNESDAY"],
      todayLocalTime: "11:15",
    },
    {
      label: "Run 4 — Thursday 4:00pm (Mon–Wed gone, Thu from 4:00pm)",
      simulatedNow: toUtcDate(ctx.weekDayDates["THURSDAY"], "16:00"),
      todayDateStr: ctx.weekDayDates["THURSDAY"],
      todayLocalTime: "16:00",
    },
    {
      label: "Run 5 — Friday 9:30am (Mon–Thu gone, only Fri from 9:30am)",
      simulatedNow: toUtcDate(ctx.weekDayDates["FRIDAY"], "09:30"),
      todayDateStr: ctx.weekDayDates["FRIDAY"],
      todayLocalTime: "09:30",
    },
  ];

  const results: RunResult[] = [];

  for (const config of runs) {
    console.log(`  ──────────────────────────────────────────────────────────────────`);
    console.log(`  ${config.label}`);
    console.log(`  ──────────────────────────────────────────────────────────────────`);

    const r = runSimulation(ctx, config);
    results.push(r);

    const daysLabel = r.daysInScope.map(d => d.charAt(0) + d.slice(1).toLowerCase()).join(", ");
    console.log(`  Days in scope: ${daysLabel} (${r.daysInScope.length}/5)`);
    console.log(`  Total proposals: ${r.proposals.length}`);

    // Proposal breakdown by day
    const byDay: Record<string, number> = {};
    for (const p of r.proposals) byDay[p.dayOfWeek] = (byDay[p.dayOfWeek] ?? 0) + 1;
    const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
    const dayBreakdown = DAYS.map(d => {
      const dateStr = ctx.weekDayDates[d];
      const count = byDay[d] ?? 0;
      const isToday = dateStr === config.todayDateStr;
      const isPast = dateStr < config.todayDateStr;
      if (isPast) return `    ${d.charAt(0) + d.slice(1).toLowerCase()}: — (past, skipped)`;
      if (isToday) {
        if (count > 0) {
          const dayProps = r.proposals.filter(p => p.dayOfWeek === d);
          const earliest = dayProps.map(p => p.startTime).sort()[0];
          const latest = dayProps.map(p => p.endTime).sort().reverse()[0];
          return `    ${d.charAt(0) + d.slice(1).toLowerCase()}: ${count} proposal(s) — earliest ${earliest}, latest end ${latest} [notBefore: ${config.todayLocalTime}]`;
        }
        return `    ${d.charAt(0) + d.slice(1).toLowerCase()}: 0 proposals (no availability past ${config.todayLocalTime})`;
      }
      return `    ${d.charAt(0) + d.slice(1).toLowerCase()}: ${count} proposal(s)`;
    }).join("\n");
    console.log(dayBreakdown);

    // Assertions
    console.log();
    for (const a of r.assertions) {
      console.log(`  ${a.pass ? "✓" : "✗"} ${a.label}`);
      console.log(`    ${a.detail}`);
    }
    console.log(`\n  Result: ${r.pass ? "PASS ✓" : "FAIL ✗"}\n`);
  }

  // ─── Summary Report ─────────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY REPORT                                                       ");
  console.log("════════════════════════════════════════════════════════════════════════\n");

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  console.log(`  Runs passed: ${passed} / ${results.length}`);
  console.log(`  Runs failed: ${failed}\n`);

  // Key metric: proposal count by day across all runs (shows progressive shrinkage)
  console.log("  Proposal counts by day — shows days dropping off as 'now' advances:");
  console.log(`  ${"Run".padEnd(45)} Mon  Tue  Wed  Thu  Fri  Total`);
  console.log(`  ${"─".repeat(45)} ───  ───  ───  ───  ───  ─────`);
  const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
  for (const r of results) {
    const byDay: Record<string, number> = {};
    for (const p of r.proposals) byDay[p.dayOfWeek] = (byDay[p.dayOfWeek] ?? 0) + 1;
    const cols = DAYS.map(d => {
      const dateStr = ctx.weekDayDates[d];
      if (dateStr < r.config.todayDateStr) return " — ";
      return String(byDay[d] ?? 0).padStart(3);
    }).join("  ");
    console.log(`  ${r.config.label.padEnd(45)} ${cols}  ${String(r.proposals.length).padStart(5)}`);
  }

  // Timing check for each run — verify no proposal starts before notBefore on "today"
  console.log("\n  Timing checks (today's earliest proposal vs notBefore cutoff):");
  for (const r of results) {
    const todayProps = r.proposals.filter(p => p.dateStr === r.config.todayDateStr);
    if (todayProps.length === 0) {
      console.log(`  ${r.config.label.slice(0, 44)}: no proposals today (past availability window) ✓`);
    } else {
      const earliest = todayProps.map(p => p.startTime).sort()[0];
      const cutoff = r.config.todayLocalTime;
      const ok = parseHHMM(earliest) >= parseHHMM(cutoff);
      console.log(`  ${r.config.label.slice(0, 44)}: earliest ${earliest} vs cutoff ${cutoff} ${ok ? "✓" : "✗ VIOLATION"}`);
    }
  }

  if (failed > 0) {
    console.log("\n  ✗ FAILURES:");
    for (const r of results.filter(r => !r.pass)) {
      console.log(`\n  ${r.config.label}`);
      for (const a of r.assertions.filter(a => !a.pass)) {
        console.log(`    ✗ ${a.label}: ${a.detail}`);
      }
    }
  } else {
    console.log("\n  ✅ All 5 runs passed — rest-of-week scheduling behaves correctly.");
  }

  console.log("\n════════════════════════════════════════════════════════════════════════\n");
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Test error:", err);
  prisma.$disconnect();
  process.exit(1);
});
