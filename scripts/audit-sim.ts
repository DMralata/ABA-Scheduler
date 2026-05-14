/**
 * Simulation Script — tests proposed scheduler improvements without modifying
 * production code. Runs the optimizer once (baseline) then applies filters
 * in post-processing to estimate the effect of each proposed change.
 *
 * Usage:  npx tsx scripts/audit-sim.ts [YYYY-MM-DD]
 *
 * Simulations run:
 *   SIM A — Minimum slot quality floor (60%): rejects proposals where the
 *            scheduled duration < 60% of the client's authorized sessionHours.
 *            Conservative estimate (no replacement scheduling).
 *   SIM B — Minimum slot quality floor (80%): same, stricter threshold.
 *   SIM C — Full sessions only: only full-duration proposals pass.
 *
 * NOTE: These are conservative lower-bound estimates. The real implementation
 * would let the optimizer RETRY rejected clients, potentially finding better
 * providers with more time. Actual results would be equal or better.
 */

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type { SchedulerClient, SchedulerProvider } from "../src/lib/scheduler/types";
import type { ProposedSessionOutput } from "../src/lib/scheduler/types";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();
const MAX_SESSION_HOURS = 6.0;
const MIN_SESSION_HOURS = 1.5;
const SCHEDULABLE_DAYS: DayOfWeek[] = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];

function toLocalDateStr(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function toLocalWindow(utcDate: Date, tz: string) {
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(utcDate).toUpperCase() as DayOfWeek;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(utcDate);
  return { dayOfWeek, time };
}
function parseHHMM(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function bar(pct: number, width = 10): string {
  const filled = Math.round(Math.min(pct, 100) / 10);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
function fmt(n: number): string { return n.toFixed(1); }

// ─── Simulation metrics ────────────────────────────────────────────────────────

interface SimStats {
  label: string;
  proposals: ProposedSessionOutput[];
  clientMap: Map<string, SchedulerClient>;
  providerMap: Map<string, SchedulerProvider>;
}

function computeStats(sim: SimStats) {
  const { proposals, clientMap, providerMap } = sim;

  // Per-client coverage
  const clientHours = new Map<string, number>();
  for (const p of proposals) {
    const dur = (parseHHMM(p.endTime) - parseHHMM(p.startTime)) / 60;
    clientHours.set(p.clientId, (clientHours.get(p.clientId) ?? 0) + dur);
  }

  // Per-RBT utilization (working-day fill only — same metric as audit-run)
  const rbtStats: Array<{
    name: string;
    workingDayAvailMins: number;
    scheduledMins: number;
    workingDays: Set<DayOfWeek>;
  }> = [];

  for (const p of providerMap.values()) {
    if (p.position !== "RBT") continue;
    const proposed = proposals.filter(pr => pr.providerId === p.id);
    const workingDays = new Set(proposed.map(pr => pr.dayOfWeek));
    const totalAvailMins = p.availability
      .filter(a => SCHEDULABLE_DAYS.includes(a.dayOfWeek))
      .reduce((sum, w) => sum + parseHHMM(w.endTime) - parseHHMM(w.startTime), 0);
    if (totalAvailMins === 0) continue;
    const workingDayAvailMins = p.availability
      .filter(a => SCHEDULABLE_DAYS.includes(a.dayOfWeek) && workingDays.has(a.dayOfWeek))
      .reduce((sum, w) => sum + parseHHMM(w.endTime) - parseHHMM(w.startTime), 0);
    const scheduledMins = proposed.reduce((sum, pr) => sum + parseHHMM(pr.endTime) - parseHHMM(pr.startTime), 0);
    rbtStats.push({ name: `${p.lastName}, ${p.firstName}`, workingDayAvailMins, scheduledMins, workingDays });
  }

  const totalWorkingDayAvailMins = rbtStats.reduce((s, r) => s + r.workingDayAvailMins, 0);
  const totalScheduledMins = rbtStats.reduce((s, r) => s + r.scheduledMins, 0);
  const overallDayFill = totalWorkingDayAvailMins > 0
    ? Math.round((totalScheduledMins / totalWorkingDayAvailMins) * 100) : 0;

  let fullyCovered = 0;
  let underServed70 = 0;
  let totalCoverageSum = 0;
  for (const c of clientMap.values()) {
    const scheduled = clientHours.get(c.id) ?? 0;
    const coverage = c.approvedWeeklyHours > 0 ? scheduled / c.approvedWeeklyHours : 0;
    totalCoverageSum += coverage;
    if (coverage >= 0.90) fullyCovered++;
    if (coverage < 0.70) underServed70++;
  }
  const avgCoverage = clientMap.size > 0 ? Math.round((totalCoverageSum / clientMap.size) * 100) : 0;
  const totalScheduledHours = totalScheduledMins / 60;

  return { clientHours, rbtStats, overallDayFill, totalScheduledHours, fullyCovered, underServed70, avgCoverage, totalWorkingDayAvailMins, totalScheduledMins };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const targetArg = process.argv[2];
  const targetDateObj = targetArg ? new Date(targetArg + "T12:00:00Z") : new Date();

  const center = await prisma.center.findFirst();
  if (!center) { console.error("No center found."); process.exit(1); }
  const tz = center.timezone;
  const targetDate = toLocalDateStr(targetDateObj, tz);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`SCHEDULER SIMULATION REPORT`);
  console.log(`Week of: ${targetDate}  |  Center: ${center.name}`);
  console.log(`${"═".repeat(64)}\n`);

  const { weekStart, weekEnd } = getWeekBoundaries(targetDateObj, tz);
  const weekOf = new Date(weekStart.getTime() + 86_400_000);

  const sessionType = await prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } })
    ?? await prisma.sessionType.findFirst({ where: { billable: true } });
  if (!sessionType) { console.error("No billable session type found."); process.exit(1); }

  // ── Load clients ────────────────────────────────────────────────────────────
  const rawClients = await prisma.client.findMany({
    where: {
      AND: [
        { OR: [{ centerId: center.id }, { centerId: null }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
      ],
    },
    include: { availability: true, approvedHomeProviders: { where: { endDate: null } } },
  });
  const clientIds = rawClients.map(c => c.id);

  const allAuths = await prisma.authorization.findMany({
    where: { clientId: { in: clientIds }, startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
    orderBy: { startDate: "desc" },
    select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
  });
  const clientAuthMap: Record<string, { authId: string; weeklyHours: number; endDate: Date }> = {};
  const authorizationIds: string[] = [];
  for (const auth of allAuths) {
    if (!clientAuthMap[auth.clientId]) {
      authorizationIds.push(auth.id);
      clientAuthMap[auth.clientId] = { authId: auth.id, weeklyHours: auth.approvedHoursPerWeek, endDate: auth.endDate };
    }
  }

  const usedSessions = await prisma.session.findMany({
    where: { authorizationId: { in: authorizationIds }, billable: true, status: { in: ["SCHEDULED","IN_PROGRESS","COMPLETED"] }, startTime: { gte: weekStart, lt: weekEnd } },
    select: { authorizationId: true, startTime: true, endTime: true },
  });
  const usedHoursMap: Record<string, number> = {};
  for (const s of usedSessions) {
    if (!s.authorizationId) continue;
    usedHoursMap[s.authorizationId] = (usedHoursMap[s.authorizationId] ?? 0)
      + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }

  const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 86_400_000);
  const priorSessions = await prisma.session.findMany({
    where: { clientId: { in: clientIds }, startTime: { gte: fourWeeksAgo, lt: weekStart }, status: { in: ["SCHEDULED","COMPLETED","IN_PROGRESS"] } },
    select: { clientId: true, providerId: true, startTime: true },
    orderBy: { startTime: "desc" },
  });
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) historicalByClient[s.clientId].push(s.providerId);
  }

  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });
  const providerIds = rawProviders.map(p => p.id);

  const providerBlocks = await prisma.providerBlock.findMany({
    where: { providerId: { in: providerIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { providerId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of providerBlocks) {
    const ds = toLocalDateStr(b.date, tz);
    if (!blocksByProvider[b.providerId]) blocksByProvider[b.providerId] = [];
    blocksByProvider[b.providerId].push({ date: ds, startTime: b.startTime, endTime: b.endTime });
  }

  const [bookedSessions, approvedProposals] = await Promise.all([
    prisma.session.findMany({
      where: { providerId: { in: providerIds }, status: { in: ["SCHEDULED","IN_PROGRESS"] }, startTime: { gte: weekStart }, endTime: { lte: weekEnd } },
      select: { providerId: true, clientId: true, startTime: true, endTime: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
        status: "APPROVED",
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true },
    }),
  ]);

  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  for (const s of [...bookedSessions, ...approvedProposals]) {
    if (!s.providerId) continue;
    const { dayOfWeek, time: st } = toLocalWindow(s.startTime, tz);
    const { time: et } = toLocalWindow(s.endTime, tz);
    if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
    bookedByProvider[s.providerId].push({ dayOfWeek, startTime: st, endTime: et });
    if (s.clientId) {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek, startTime: st, endTime: et });
    }
  }

  // ── Build scheduler types (shared between all sim runs) ──────────────────────
  const schedulerClients: SchedulerClient[] = rawClients.map(c => {
    const auth = clientAuthMap[c.id];
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      latitude: c.latitude,
      longitude: c.longitude,
      daysNeeded: (() => {
        const weeklyHours = auth?.weeklyHours ?? null;
        const used = auth ? (usedHoursMap[auth.authId] ?? 0) : 0;
        const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;
        if (remaining === null || remaining <= 0) return 1;
        const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
        const availDays = new Set(c.availability.map(a => a.dayOfWeek)).size;
        return Math.max(1, Math.min(raw, availDays));
      })(),
      sessionHours: (() => {
        const weeklyHours = auth?.weeklyHours ?? null;
        const used = auth ? (usedHoursMap[auth.authId] ?? 0) : 0;
        const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;
        if (remaining === null || remaining <= 0) {
          return c.defaultSessionHours ?? center.defaultSessionHours;
        }
        const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
        const availDays = new Set(c.availability.map(a => a.dayOfWeek)).size;
        const daysNeeded = Math.max(1, Math.min(raw, availDays));
        const rawPerDay = remaining / daysNeeded;
        const snapped = Math.round(rawPerDay * 2) / 2;
        return Math.max(snapped, MIN_SESSION_HOURS);
      })(),
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      availability: c.availability.map(a => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      bookedWindows: bookedByClient[c.id] ?? [],
      blocks: [],
      authorizationId: auth?.authId ?? null,
      approvedWeeklyHours: auth?.weeklyHours ?? 0,
      usedHoursThisWeek: auth ? (usedHoursMap[auth.authId] ?? 0) : 0,
      authorizationEndDate: auth?.endDate ? toLocalDateStr(auth.endDate, tz) : null,
      approvedProviderIds: c.approvedHomeProviders.map(a => a.providerId),
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: (historicalByClient[c.id] ?? []).length > 0,
      preferredLocation: c.preferredLocation,
    };
  });

  const schedulerProviders: SchedulerProvider[] = rawProviders.map(p => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position as "BCBA" | "BCaBA" | "RBT",
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

  const clientMap = new Map(schedulerClients.map(c => [c.id, c]));
  const providerMap = new Map(schedulerProviders.map(p => [p.id, p]));

  // ─────────────────────────────────────────────────────────────────────────────
  // Run optimizer (single pass — shared across all simulations)
  // ─────────────────────────────────────────────────────────────────────────────
  const workingState = createWorkingState();
  const result = optimize(
    {
      weekOf, targetDate, timezone: tz, centerId: null,
      clients: schedulerClients, providers: schedulerProviders,
      sessionTypeIds: { CENTER: sessionType.id, HOME: sessionType.id, SCHOOL: sessionType.id },
      driveTimeSessionTypeId: null,
      driveMinutes: {}, distanceMeters: {},
      weekMode: true,
    },
    workingState
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Quality floor filter — used by Sim A, B, C
  // Rejects proposals where slot duration < sessionHours * qualityFloor.
  // Returns the proposals that SURVIVE the filter + info about those removed.
  // ─────────────────────────────────────────────────────────────────────────────
  function applyQualityFloor(
    proposals: ProposedSessionOutput[],
    floorPct: number  // 0.0 = no filter, 0.6 = 60% floor, 1.0 = full sessions only
  ): { kept: ProposedSessionOutput[]; removed: ProposedSessionOutput[] } {
    const kept: ProposedSessionOutput[] = [];
    const removed: ProposedSessionOutput[] = [];
    for (const p of proposals) {
      const client = clientMap.get(p.clientId);
      if (!client) { kept.push(p); continue; }
      const slotDurMins = parseHHMM(p.endTime) - parseHHMM(p.startTime);
      const targetDurMins = Math.round(client.sessionHours * 60);
      const minAcceptableMins = Math.round(targetDurMins * floorPct);
      if (slotDurMins >= minAcceptableMins) {
        kept.push(p);
      } else {
        removed.push(p);
      }
    }
    return { kept, removed };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BASELINE — current output, no filter
  // ─────────────────────────────────────────────────────────────────────────────
  const baseline = computeStats({ label: "BASELINE", proposals: result.proposals, clientMap, providerMap });

  // ─────────────────────────────────────────────────────────────────────────────
  // SIM A — 60% quality floor
  // ─────────────────────────────────────────────────────────────────────────────
  const { kept: keptA, removed: removedA } = applyQualityFloor(result.proposals, 0.60);
  const simA = computeStats({ label: "SIM A (60% floor)", proposals: keptA, clientMap, providerMap });

  // ─────────────────────────────────────────────────────────────────────────────
  // SIM B — 80% quality floor
  // ─────────────────────────────────────────────────────────────────────────────
  const { kept: keptB, removed: removedB } = applyQualityFloor(result.proposals, 0.80);
  const simB = computeStats({ label: "SIM B (80% floor)", proposals: keptB, clientMap, providerMap });

  // ─────────────────────────────────────────────────────────────────────────────
  // SIM C — full sessions only (100%)
  // ─────────────────────────────────────────────────────────────────────────────
  const { kept: keptC, removed: removedC } = applyQualityFloor(result.proposals, 1.00);
  const simC = computeStats({ label: "SIM C (full only)", proposals: keptC, clientMap, providerMap });

  // ─────────────────────────────────────────────────────────────────────────────
  // OUTPUT — AGGREGATE COMPARISON
  // ─────────────────────────────────────────────────────────────────────────────
  function delta(a: number, b: number, suffix = ""): string {
    const d = b - a;
    if (d === 0) return "  —";
    return d > 0 ? `  +${fmt(d)}${suffix}` : `  ${fmt(d)}${suffix}`;
  }
  function deltaInt(a: number, b: number, suffix = ""): string {
    const d = b - a;
    if (d === 0) return "  —";
    return d > 0 ? `  +${d}${suffix}` : `  ${d}${suffix}`;
  }

  console.log(`AGGREGATE COMPARISON`);
  console.log(`${"─".repeat(64)}`);
  console.log(`${"Metric".padEnd(34)} ${"BASELINE".padEnd(10)} ${"SIM A 60%".padEnd(10)} ${"SIM B 80%".padEnd(10)} ${"SIM C 100%"}`);
  console.log(`${"─".repeat(34)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(10)}`);

  const rows: Array<[string, string, string, string, string]> = [
    ["Proposals", String(result.proposals.length), `${keptA.length} (${deltaInt(result.proposals.length, keptA.length)})`, `${keptB.length} (${deltaInt(result.proposals.length, keptB.length)})`, `${keptC.length} (${deltaInt(result.proposals.length, keptC.length)})`],
    ["Total scheduled hours", `${fmt(baseline.totalScheduledHours)}h`, `${fmt(simA.totalScheduledHours)}h (${delta(baseline.totalScheduledHours, simA.totalScheduledHours)}h)`, `${fmt(simB.totalScheduledHours)}h (${delta(baseline.totalScheduledHours, simB.totalScheduledHours)}h)`, `${fmt(simC.totalScheduledHours)}h (${delta(baseline.totalScheduledHours, simC.totalScheduledHours)}h)`],
    ["RBT day-fill rate", `${baseline.overallDayFill}%`, `${simA.overallDayFill}% (${deltaInt(baseline.overallDayFill, simA.overallDayFill)}%)`, `${simB.overallDayFill}% (${deltaInt(baseline.overallDayFill, simB.overallDayFill)}%)`, `${simC.overallDayFill}% (${deltaInt(baseline.overallDayFill, simC.overallDayFill)}%)`],
    ["Avg client coverage", `${baseline.avgCoverage}%`, `${simA.avgCoverage}% (${deltaInt(baseline.avgCoverage, simA.avgCoverage)}%)`, `${simB.avgCoverage}% (${deltaInt(baseline.avgCoverage, simB.avgCoverage)}%)`, `${simC.avgCoverage}% (${deltaInt(baseline.avgCoverage, simC.avgCoverage)}%)`],
    ["Clients ≥90% coverage", `${baseline.fullyCovered}`, `${simA.fullyCovered} (${deltaInt(baseline.fullyCovered, simA.fullyCovered)})`, `${simB.fullyCovered} (${deltaInt(baseline.fullyCovered, simB.fullyCovered)})`, `${simC.fullyCovered} (${deltaInt(baseline.fullyCovered, simC.fullyCovered)})`],
    ["Clients <70% coverage", `${baseline.underServed70}`, `${simA.underServed70} (${deltaInt(baseline.underServed70, simA.underServed70)})`, `${simB.underServed70} (${deltaInt(baseline.underServed70, simB.underServed70)})`, `${simC.underServed70} (${deltaInt(baseline.underServed70, simC.underServed70)})`],
  ];
  for (const [label, b, a, bb, c] of rows) {
    console.log(`${label.padEnd(34)} ${b.padEnd(10)} ${a.padEnd(10)} ${bb.padEnd(10)} ${c}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REMOVED PROPOSALS — what gets cut at each threshold
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nPROPOSALS REMOVED BY QUALITY FLOOR`);
  console.log(`${"─".repeat(64)}`);
  console.log(`These are the "gap fill" sessions eliminated at each threshold.\n`);

  // Show all proposals removed by SIM A (strictest = SIM C is a superset — show incrementally)
  const removedByA = new Set(removedA.map(p => `${p.clientId}|${p.dayOfWeek}|${p.startTime}`));
  const removedByBOnly = removedB.filter(p => !removedByA.has(`${p.clientId}|${p.dayOfWeek}|${p.startTime}`));
  const removedByCOnly = removedC.filter(p => !removedByA.has(`${p.clientId}|${p.dayOfWeek}|${p.startTime}`) && !removedByBOnly.map(x => `${x.clientId}|${x.dayOfWeek}|${x.startTime}`).includes(`${p.clientId}|${p.dayOfWeek}|${p.startTime}`));

  if (removedA.length > 0) {
    console.log(`Removed at 60% floor (${removedA.length} proposals):`);
    for (const p of removedA) {
      const c = clientMap.get(p.clientId);
      const pv = providerMap.get(p.providerId);
      const slotMins = parseHHMM(p.endTime) - parseHHMM(p.startTime);
      const targetMins = Math.round((c?.sessionHours ?? 0) * 60);
      const pct = targetMins > 0 ? Math.round((slotMins / targetMins) * 100) : 0;
      console.log(`  ✂  ${(c?.lastName ?? "?").padEnd(12)}, ${(c?.firstName ?? "?").padEnd(10)}  ${p.dayOfWeek.slice(0,3).padEnd(4)}  ${p.startTime}–${p.endTime}  (${fmt(slotMins/60)}h of ${fmt(targetMins/60)}h = ${pct}%)  via ${pv?.lastName ?? "?"}`);
    }
  } else {
    console.log(`  None at 60% floor — no gap-fill sessions detected.`);
  }

  if (removedByBOnly.length > 0) {
    console.log(`\nAdditionally removed at 80% floor (${removedByBOnly.length} more):`);
    for (const p of removedByBOnly) {
      const c = clientMap.get(p.clientId);
      const pv = providerMap.get(p.providerId);
      const slotMins = parseHHMM(p.endTime) - parseHHMM(p.startTime);
      const targetMins = Math.round((c?.sessionHours ?? 0) * 60);
      const pct = targetMins > 0 ? Math.round((slotMins / targetMins) * 100) : 0;
      console.log(`  ✂  ${(c?.lastName ?? "?").padEnd(12)}, ${(c?.firstName ?? "?").padEnd(10)}  ${p.dayOfWeek.slice(0,3).padEnd(4)}  ${p.startTime}–${p.endTime}  (${fmt(slotMins/60)}h of ${fmt(targetMins/60)}h = ${pct}%)  via ${pv?.lastName ?? "?"}`);
    }
  }

  if (removedByCOnly.length > 0) {
    console.log(`\nAdditionally removed at 100% floor (${removedByCOnly.length} more):`);
    for (const p of removedByCOnly) {
      const c = clientMap.get(p.clientId);
      const pv = providerMap.get(p.providerId);
      const slotMins = parseHHMM(p.endTime) - parseHHMM(p.startTime);
      const targetMins = Math.round((c?.sessionHours ?? 0) * 60);
      const pct = targetMins > 0 ? Math.round((slotMins / targetMins) * 100) : 0;
      console.log(`  ✂  ${(c?.lastName ?? "?").padEnd(12)}, ${(c?.firstName ?? "?").padEnd(10)}  ${p.dayOfWeek.slice(0,3).padEnd(4)}  ${p.startTime}–${p.endTime}  (${fmt(slotMins/60)}h of ${fmt(targetMins/60)}h = ${pct}%)  via ${pv?.lastName ?? "?"}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PER-CLIENT COVERAGE COMPARISON
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nPER-CLIENT COVERAGE (BASELINE vs SIM A 60% vs SIM C 100%)`);
  console.log(`${"─".repeat(64)}`);
  console.log(`${"Client".padEnd(20)} ${"Auth/wk".padEnd(8)} ${"BASELINE".padEnd(12)} ${"SIM A".padEnd(12)} ${"SIM C".padEnd(12)} Change`);
  console.log(`${"─".repeat(20)} ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(12)} ${"─".repeat(10)}`);

  for (const c of schedulerClients.sort((a, b) => a.lastName.localeCompare(b.lastName))) {
    const bH = baseline.clientHours.get(c.id) ?? 0;
    const aH = simA.clientHours.get(c.id) ?? 0;
    const cH = simC.clientHours.get(c.id) ?? 0;
    const bCov = c.approvedWeeklyHours > 0 ? Math.round((bH / c.approvedWeeklyHours) * 100) : 0;
    const aCov = c.approvedWeeklyHours > 0 ? Math.round((aH / c.approvedWeeklyHours) * 100) : 0;
    const cCov = c.approvedWeeklyHours > 0 ? Math.round((cH / c.approvedWeeklyHours) * 100) : 0;

    const bLabel = `${fmt(bH)}h (${bCov}%)`;
    const aLabel = `${fmt(aH)}h (${aCov}%)`;
    const cLabel = `${fmt(cH)}h (${cCov}%)`;

    const diffA = aCov - bCov;
    const diffC = cCov - bCov;
    const changeLabel = diffC !== 0 || diffA !== 0
      ? `A:${diffA >= 0 ? "+" : ""}${diffA}%  C:${diffC >= 0 ? "+" : ""}${diffC}%`
      : "no change";

    const name = `${c.lastName}, ${c.firstName}`;
    console.log(`${name.slice(0,20).padEnd(20)} ${(c.approvedWeeklyHours + "h").padEnd(8)} ${bLabel.padEnd(12)} ${aLabel.padEnd(12)} ${cLabel.padEnd(12)} ${changeLabel}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PER-RBT UTILIZATION COMPARISON (BASELINE vs SIM A)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nPER-RBT UTILIZATION (BASELINE vs SIM A 60% floor)`);
  console.log(`${"─".repeat(64)}`);
  console.log(`${"RBT".padEnd(22)} ${"BASELINE".padEnd(14)} ${"SIM A (60%)".padEnd(14)} ${"Delta"}`);
  console.log(`${"─".repeat(22)} ${"─".repeat(14)} ${"─".repeat(14)} ${"─".repeat(10)}`);

  const baselineRbtMap = new Map(baseline.rbtStats.map(r => [r.name, r]));
  const simARbtMap = new Map(simA.rbtStats.map(r => [r.name, r]));

  for (const rb of baseline.rbtStats.sort((a, b) => a.name.localeCompare(b.name))) {
    const sa = simARbtMap.get(rb.name);
    const bFill = rb.workingDayAvailMins > 0 ? Math.round((rb.scheduledMins / rb.workingDayAvailMins) * 100) : 0;
    const aFill = sa && sa.workingDayAvailMins > 0 ? Math.round((sa.scheduledMins / sa.workingDayAvailMins) * 100) : 0;
    const bH = fmt(rb.scheduledMins / 60);
    const aH = sa ? fmt(sa.scheduledMins / 60) : "—";
    const diff = aFill - bFill;
    const diffLabel = diff === 0 ? "—" : diff > 0 ? `+${diff}%` : `${diff}%`;
    console.log(`${rb.name.padEnd(22)} ${`${bH}h [${bFill}%]`.padEnd(14)} ${`${aH}h [${aFill}%]`.padEnd(14)} ${diffLabel}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PROVIDER CAPACITY FREED BY SIM A
  // Shows how much time opens up per RBT when gap-fill sessions are removed —
  // this is the time available for backfill in a real implementation.
  // ─────────────────────────────────────────────────────────────────────────────
  if (removedA.length > 0) {
    const freedByProvider: Map<string, { name: string; freedMins: number; freedSlots: string[] }> = new Map();
    for (const p of removedA) {
      const pv = providerMap.get(p.providerId);
      const dur = parseHHMM(p.endTime) - parseHHMM(p.startTime);
      const name = pv ? `${pv.lastName}, ${pv.firstName}` : p.providerId;
      if (!freedByProvider.has(p.providerId)) freedByProvider.set(p.providerId, { name, freedMins: 0, freedSlots: [] });
      const entry = freedByProvider.get(p.providerId)!;
      entry.freedMins += dur;
      const c = clientMap.get(p.clientId);
      entry.freedSlots.push(`${p.dayOfWeek.slice(0,3)} ${p.startTime}–${p.endTime} (${c?.lastName ?? "?"})`);
    }

    console.log(`\nPROVIDER CAPACITY FREED AT 60% FLOOR`);
    console.log(`${"─".repeat(64)}`);
    console.log(`This is the time a backfill pass could re-use for higher-quality sessions.\n`);
    for (const { name, freedMins, freedSlots } of freedByProvider.values()) {
      console.log(`  ${name}: ${fmt(freedMins/60)}h freed`);
      for (const s of freedSlots) console.log(`    − ${s}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INTERPRETATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(64)}`);
  console.log(`INTERPRETATION`);
  console.log(`${"─".repeat(64)}`);
  console.log(`
  This simulation is CONSERVATIVE — it shows the worst-case effect of each
  quality floor: sessions removed with no replacement. The real implementation
  would re-run the optimizer for removed clients, potentially finding providers
  with more open time and producing equal or better coverage numbers.

  What to look for:
    • Clients where coverage IMPROVES (better providers found with no floor)
    • Clients where coverage DROPS (no better provider exists — data problem)
    • Providers with freed capacity (candidates for backfill)
    • Whether avg coverage goes up or down vs baseline
  `);

  console.log(`${"═".repeat(64)}\n`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
