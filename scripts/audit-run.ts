/**
 * Audit Script — runs the scheduler engine against real DB data and
 * produces a full AUDIT_GOD.md four-pass report.
 *
 * Usage:  npx tsx scripts/audit-run.ts [YYYY-MM-DD]
 * Default date: today
 */

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type { SchedulerClient, SchedulerProvider } from "../src/lib/scheduler/types";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();

const MAX_SESSION_HOURS = 8.0;
const MIN_SESSION_HOURS = 1.5;

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const targetArg = process.argv[2];
  const targetDateObj = targetArg ? new Date(targetArg + "T12:00:00Z") : new Date();

  const center = await prisma.center.findFirst();
  if (!center) { console.error("No center found."); process.exit(1); }
  const tz = center.timezone;
  const targetDate = toLocalDateStr(targetDateObj, tz);

  console.log(`\n${"═".repeat(56)}`);
  console.log(`SCHEDULE AUDIT REPORT`);
  console.log(`Target date: ${targetDate}  |  Center: ${center.name}  |  TZ: ${tz}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(56)}\n`);

  const { weekStart, weekEnd } = getWeekBoundaries(targetDateObj, tz);
  const weekOf = new Date(weekStart.getTime() + 86_400_000); // Monday

  // ── Load Direct Therapy session type ────────────────────────────────────────
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

  // ── Load authorizations ──────────────────────────────────────────────────────
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

  // ── Used hours this week ─────────────────────────────────────────────────────
  const usedSessions = await prisma.session.findMany({
    where: {
      authorizationId: { in: authorizationIds },
      billable: true,
      status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
      startTime: { gte: weekStart, lt: weekEnd },
    },
    select: { authorizationId: true, startTime: true, endTime: true },
  });
  const usedHoursMap: Record<string, number> = {};
  for (const s of usedSessions) {
    if (!s.authorizationId) continue;
    usedHoursMap[s.authorizationId] = (usedHoursMap[s.authorizationId] ?? 0)
      + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }

  // ── Historical provider preference ──────────────────────────────────────────
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

  // ── Load providers ───────────────────────────────────────────────────────────
  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });
  const providerIds = rawProviders.map(p => p.id);

  // ── Provider blocks ──────────────────────────────────────────────────────────
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

  // ── Booked sessions + committed proposals ───────────────────────────────────
  // Simulation mode mirrors what the UI auto-schedule does: PENDING proposals
  // are cleared before each run, so they are NOT counted as committed time here.
  // Only APPROVED proposals (human-confirmed) are treated as locked.
  // This ensures the simulation produces numbers that match the UI output.
  const [bookedSessions, committedProposals] = await Promise.all([
    prisma.session.findMany({
      where: { providerId: { in: providerIds }, status: { in: ["SCHEDULED","IN_PROGRESS"] }, startTime: { gte: weekStart }, endTime: { lte: weekEnd } },
      select: { providerId: true, clientId: true, startTime: true, endTime: true, billable: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
        status: "APPROVED",   // PENDING excluded — UI clears those before each run
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true },
    }),
  ]);

  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};
  for (const s of [...bookedSessions, ...committedProposals]) {
    const { dayOfWeek, time: st } = toLocalWindow(s.startTime, tz);
    const { time: et } = toLocalWindow(s.endTime, tz);
    if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
    bookedByProvider[s.providerId].push({ dayOfWeek, startTime: st, endTime: et });
    if (s.clientId) {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek, startTime: st, endTime: et });
    }
  }

  // Pre-compute existing scheduled hours per provider and per client for Pass 2/3.
  // These are hours already in the schedule (sessions + committed proposals) that
  // the fresh optimizer run adds on top of — coverage and utilization must include them.
  const existingHoursByProvider: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (!s.billable) continue;
    existingHoursByProvider[s.providerId] = (existingHoursByProvider[s.providerId] ?? 0)
      + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }
  for (const p of committedProposals) {
    existingHoursByProvider[p.providerId] = (existingHoursByProvider[p.providerId] ?? 0)
      + (p.endTime.getTime() - p.startTime.getTime()) / 3_600_000;
  }

  const existingHoursByClient: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (!s.billable || !s.clientId) continue;
    existingHoursByClient[s.clientId] = (existingHoursByClient[s.clientId] ?? 0)
      + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }
  for (const p of committedProposals) {
    if (!p.clientId) continue;
    existingHoursByClient[p.clientId] = (existingHoursByClient[p.clientId] ?? 0)
      + (p.endTime.getTime() - p.startTime.getTime()) / 3_600_000;
  }

  // ── Build scheduler input types ──────────────────────────────────────────────
  // Pending proposal hours count against each client's used hours this week —
  // the optimizer must see them as committed so it doesn't over-schedule.
  const pendingHoursByClient: Record<string, number> = {};
  for (const p of committedProposals) {
    if (!p.clientId) continue;
    pendingHoursByClient[p.clientId] = (pendingHoursByClient[p.clientId] ?? 0)
      + (p.endTime.getTime() - p.startTime.getTime()) / 3_600_000;
  }

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
        const used = auth ? (usedHoursMap[auth.authId] ?? 0) + (pendingHoursByClient[c.id] ?? 0) : 0;
        const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;
        if (remaining === null || remaining <= 0) return 1;
        const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
        const availDays = new Set(c.availability.map((a) => a.dayOfWeek)).size;
        return Math.max(1, Math.min(raw, availDays));
      })(),
      sessionHours: (() => {
        // Mirror propose-week/route.ts: auth-derived cadence formula
        const weeklyHours = auth?.weeklyHours ?? null;
        const used = auth ? (usedHoursMap[auth.authId] ?? 0) + (pendingHoursByClient[c.id] ?? 0) : 0;
        const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;
        if (remaining === null || remaining <= 0) {
          return c.defaultSessionHours ?? center.defaultSessionHours;
        }
        const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
        const availDays = new Set(c.availability.map((a) => a.dayOfWeek)).size;
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
      usedHoursThisWeek: auth ? (usedHoursMap[auth.authId] ?? 0) + (pendingHoursByClient[c.id] ?? 0) : 0,
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

  // ── Run optimizer (week mode) ─────────────────────────────────────────────────
  const workingState = createWorkingState();
  const result = optimize(
    {
      weekOf,
      targetDate, // used for auth expiry warnings only
      timezone: tz,
      centerId: null,
      clients: schedulerClients,
      providers: schedulerProviders,
      sessionTypeIds: { CENTER: sessionType.id, HOME: sessionType.id, SCHOOL: sessionType.id },
      driveTimeSessionTypeId: null,
      driveMinutes: {}, distanceMeters: {}, // No Maps API in script — all drive times = 0
      weekMode: true,
    },
    workingState
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // PASS 1 — COMPLIANCE VALIDATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`PASS 1 — COMPLIANCE VALIDATION`);
  console.log(`${"─".repeat(56)}`);

  const violations: Array<{ client: string; provider: string; rule: string; detail: string; severity: "CRITICAL" | "HIGH" }> = [];

  const clientMap = new Map(schedulerClients.map(c => [c.id, c]));
  const providerMap = new Map(schedulerProviders.map(p => [p.id, p]));

  // Data integrity: flag any provider whose name matches a client name — likely test data contamination
  const clientNames = new Set(schedulerClients.map(c => `${c.firstName} ${c.lastName}`.toLowerCase()));
  for (const p of schedulerProviders) {
    const pName = `${p.firstName} ${p.lastName}`.toLowerCase();
    if (clientNames.has(pName)) {
      violations.push({
        client: `${p.lastName}, ${p.firstName}`,
        provider: `${p.lastName}, ${p.firstName}`,
        rule: "Data integrity — provider/client name collision",
        detail: `"${p.firstName} ${p.lastName}" exists as both a provider and a client. Likely test data contamination — verify and remove the duplicate.`,
        severity: "HIGH",
      });
    }
  }

  for (const proposal of result.proposals) {
    const client = clientMap.get(proposal.clientId)!;
    const provider = providerMap.get(proposal.providerId)!;
    const label = `${client.lastName}, ${client.firstName} → ${provider.lastName}, ${provider.firstName}`;

    // Female requirement
    if (client.femaleProviderOnly && provider.gender.toLowerCase() !== "female") {
      violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
        rule: "Female provider requirement", detail: `Provider gender: ${provider.gender}`, severity: "CRITICAL" });
    }
    // Spanish requirement
    if (client.spanish && !provider.spanish) {
      violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
        rule: "Spanish-speaking requirement", detail: "Provider does not speak Spanish", severity: "CRITICAL" });
    }
    // RBT level
    const RBT_RANK: Record<string, number> = { I: 1, II: 2, III: 3 };
    if (client.minimumRbtLevel && provider.position === "RBT") {
      if (!provider.rbtLevel || RBT_RANK[provider.rbtLevel] < RBT_RANK[client.minimumRbtLevel]) {
        violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
          rule: "RBT Level requirement", detail: `Client requires Level ${client.minimumRbtLevel}, provider is ${provider.rbtLevel ?? "unassigned"}`, severity: "CRITICAL" });
      }
    }
    // Authorization
    if (!client.authorizationId) {
      violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
        rule: "Active authorization required", detail: "No active authorization linked", severity: "CRITICAL" });
    }
    // Availability check — provider
    const providerDayAvail = provider.availability.filter(a => a.dayOfWeek === proposal.dayOfWeek);
    const slotStart = parseHHMM(proposal.startTime);
    const slotEnd = parseHHMM(proposal.endTime);
    const inProviderWindow = providerDayAvail.some(a => parseHHMM(a.startTime) <= slotStart && parseHHMM(a.endTime) >= slotEnd);
    if (!inProviderWindow) {
      violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
        rule: "Provider availability", detail: `Session ${proposal.startTime}–${proposal.endTime} on ${proposal.dayOfWeek} outside provider window`, severity: "CRITICAL" });
    }
    // Availability check — client
    const clientDayAvail = client.availability.filter(a => a.dayOfWeek === proposal.dayOfWeek);
    const inClientWindow = clientDayAvail.some(a => parseHHMM(a.startTime) <= slotStart && parseHHMM(a.endTime) >= slotEnd);
    if (!inClientWindow) {
      violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
        rule: "Client availability", detail: `Session ${proposal.startTime}–${proposal.endTime} on ${proposal.dayOfWeek} outside client window`, severity: "CRITICAL" });
    }
    // Auth hours check
    const remaining = client.approvedWeeklyHours - client.usedHoursThisWeek;
    if (client.sessionHours > remaining) {
      violations.push({ client: `${client.lastName}, ${client.firstName}`, provider: `${provider.lastName}, ${provider.firstName}`,
        rule: "Authorization weekly hours", detail: `Would schedule ${client.sessionHours}h but only ${remaining.toFixed(1)}h remain`, severity: "CRITICAL" });
    }
  }

  if (violations.length === 0) {
    console.log(`COMPLIANCE RESULT: ✅ PASS\nViolations found: 0\n`);
  } else {
    console.log(`COMPLIANCE RESULT: ❌ FAIL\nViolations found: ${violations.length}\n`);
    for (const v of violations) {
      console.log(`  Session:  ${v.client} — ${v.provider}`);
      console.log(`  Rule:     ${v.rule}`);
      console.log(`  Detail:   ${v.detail}`);
      console.log(`  Severity: ${v.severity}\n`);
    }
    const hasCritical = violations.some(v => v.severity === "CRITICAL");
    if (hasCritical) {
      console.log(`⛔ CRITICAL violations detected. Stopping audit.\n`);
      process.exit(0);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PASS 2 — RBT UTILIZATION ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`PASS 2 — RBT UTILIZATION (week of ${targetDate})\n${"─".repeat(56)}`);

  const SCHEDULABLE_DAYS: DayOfWeek[] = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];

  interface RbtStat {
    name: string;
    workingDayAvailMins: number; // available mins on days they're actually scheduled
    scheduledMins: number;       // total scheduled mins across all proposals
    workingDays: Set<DayOfWeek>;
    assignedClientsByDay: Map<DayOfWeek, string[]>;
  }

  const rbtStats: RbtStat[] = [];
  let totalWorkingDayAvailMins = 0, totalScheduledMins = 0;

  for (const p of schedulerProviders) {
    if (p.position !== "RBT") continue;

    const proposed = result.proposals.filter(pr => pr.providerId === p.id);

    // Working days = fresh proposals + existing sessions/committed proposals already in DB
    const workingDays = new Set(proposed.map(pr => pr.dayOfWeek));
    for (const s of [...bookedSessions, ...committedProposals]) {
      if (s.providerId !== p.id) continue;
      workingDays.add(toLocalWindow(s.startTime, tz).dayOfWeek);
    }

    // Available mins only on working days — unscheduled days are intentionally idle
    const workingDayAvailMins = p.availability
      .filter(a => SCHEDULABLE_DAYS.includes(a.dayOfWeek) && workingDays.has(a.dayOfWeek))
      .reduce((sum, w) => sum + parseHHMM(w.endTime) - parseHHMM(w.startTime), 0);

    // Skip providers with no availability at all (not just no schedule)
    const totalAvailMins = p.availability
      .filter(a => SCHEDULABLE_DAYS.includes(a.dayOfWeek))
      .reduce((sum, w) => sum + parseHHMM(w.endTime) - parseHHMM(w.startTime), 0);
    if (totalAvailMins === 0) continue;

    // Scheduled = fresh proposals + existing billable sessions + committed proposals
    const freshMins = proposed.reduce((sum, pr) => sum + parseHHMM(pr.endTime) - parseHHMM(pr.startTime), 0);
    const existingMins = Math.round((existingHoursByProvider[p.id] ?? 0) * 60);
    const scheduledMins = freshMins + existingMins;

    // Show all assigned clients per day (existing + fresh)
    const assignedClientsByDay = new Map<DayOfWeek, string[]>();
    for (const s of [...bookedSessions, ...committedProposals]) {
      if (s.providerId !== p.id || !s.clientId) continue;
      const { dayOfWeek } = toLocalWindow(s.startTime, tz);
      const c = clientMap.get(s.clientId);
      const name = c ? `${c.lastName}, ${c.firstName}` : s.clientId;
      if (!assignedClientsByDay.has(dayOfWeek)) assignedClientsByDay.set(dayOfWeek, []);
      if (!assignedClientsByDay.get(dayOfWeek)!.includes(name)) assignedClientsByDay.get(dayOfWeek)!.push(name);
    }
    for (const pr of proposed) {
      const c = clientMap.get(pr.clientId);
      const name = c ? `${c.lastName}, ${c.firstName}` : pr.clientId;
      if (!assignedClientsByDay.has(pr.dayOfWeek)) assignedClientsByDay.set(pr.dayOfWeek, []);
      if (!assignedClientsByDay.get(pr.dayOfWeek)!.includes(name)) assignedClientsByDay.get(pr.dayOfWeek)!.push(name);
    }

    rbtStats.push({ name: `${p.lastName}, ${p.firstName}`, workingDayAvailMins, scheduledMins, workingDays, assignedClientsByDay });
    totalWorkingDayAvailMins += workingDayAvailMins;
    totalScheduledMins += scheduledMins;
  }

  for (const s of rbtStats) {
    // Day-fill rate: of the hours on days this provider works, how full are they?
    const dayFill = s.workingDayAvailMins > 0 ? Math.round((s.scheduledMins / s.workingDayAvailMins) * 100) : 0;
    const gapMins = s.workingDayAvailMins - s.scheduledMins;
    const cappedFill = Math.min(100, dayFill);
    const fillBar = "█".repeat(Math.round(cappedFill / 10)) + "░".repeat(10 - Math.round(cappedFill / 10));
    const workingDayList = SCHEDULABLE_DAYS.filter(d => s.workingDays.has(d)).map(d => d.charAt(0) + d.slice(1, 3).toLowerCase()).join(", ");
    console.log(`\n  ${s.name}`);
    console.log(`    Working days:      ${s.workingDays.size > 0 ? workingDayList : "— NONE —"}`);
    console.log(`    Avail on work days:${(s.workingDayAvailMins / 60).toFixed(1)}h`);
    console.log(`    Scheduled:         ${(s.scheduledMins / 60).toFixed(1)}h`);
    console.log(`    Gap on work days:  ${(gapMins / 60).toFixed(1)}h`);
    console.log(`    Day-fill rate:     [${fillBar}] ${dayFill}%`);
    for (const day of SCHEDULABLE_DAYS) {
      const clients = s.assignedClientsByDay.get(day);
      if (clients && clients.length > 0) {
        console.log(`    ${day.charAt(0) + day.slice(1).toLowerCase().padEnd(9)}  ${clients.join(", ")}`);
      }
    }
  }

  const overallDayFill = totalWorkingDayAvailMins > 0 ? Math.round((totalScheduledMins / totalWorkingDayAvailMins) * 100) : 0;
  const sparseWorkDays = rbtStats.filter(s => s.workingDays.size > 0 && s.workingDayAvailMins > 0 && (s.scheduledMins / s.workingDayAvailMins) < 0.6);

  console.log(`\n  AGGREGATE`);
  console.log(`    RBTs with scheduled days:   ${rbtStats.filter(s => s.workingDays.size > 0).length} / ${rbtStats.length}`);
  console.log(`    Total scheduled hours:      ${(totalScheduledMins / 60).toFixed(1)}h`);
  console.log(`    Overall day-fill rate:      ${overallDayFill}%  (scheduled ÷ avail on working days)`);
  if (sparseWorkDays.length > 0) {
    console.log(`    Sparse work days (<60%):    ${sparseWorkDays.map(s => s.name).join(", ")}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PASS 3 — CLIENT COVERAGE ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nPASS 3 — CLIENT COVERAGE\n${"─".repeat(56)}`);

  // Client scheduled hours = existing sessions + committed proposals + fresh proposals
  const clientScheduledHours = new Map<string, number>();
  for (const [clientId, hrs] of Object.entries(existingHoursByClient)) {
    clientScheduledHours.set(clientId, hrs);
  }
  for (const pr of result.proposals) {
    const hrs = (parseHHMM(pr.endTime) - parseHHMM(pr.startTime)) / 60;
    clientScheduledHours.set(pr.clientId, (clientScheduledHours.get(pr.clientId) ?? 0) + hrs);
  }

  // Days scheduled: existing sessions + committed proposals + fresh proposals
  const clientDaysScheduled = new Map<string, Set<DayOfWeek>>();
  for (const s of [...bookedSessions, ...committedProposals]) {
    if (!s.clientId) continue;
    if (!clientDaysScheduled.has(s.clientId)) clientDaysScheduled.set(s.clientId, new Set());
    clientDaysScheduled.get(s.clientId)!.add(toLocalWindow(s.startTime, tz).dayOfWeek);
  }
  for (const pr of result.proposals) {
    if (!clientDaysScheduled.has(pr.clientId)) clientDaysScheduled.set(pr.clientId, new Set());
    clientDaysScheduled.get(pr.clientId)!.add(pr.dayOfWeek);
  }

  let fullyCovered = 0, underServed = 0, noProvider = 0, expiringAuth = 0;
  const today = targetDateObj;

  for (const c of schedulerClients) {
    const scheduledH = clientScheduledHours.get(c.id) ?? 0;
    const weeklyTarget = c.approvedWeeklyHours;
    // Effective capacity: max hours physically schedulable in a 5-day week.
    // = 5 days × MAX_SESSION_HOURS (6h). Clients whose auth exceeds this (e.g. 35h or 40h)
    // can never reach 90% coverage no matter how good the schedule is — cap the denominator
    // so coverage isn't penalized for an authorization that exceeds what one provider can deliver.
    const maxWeeklySchedulable = 5 * MAX_SESSION_HOURS; // 30h
    const coverageDenominator = Math.min(weeklyTarget, maxWeeklySchedulable);
    // Weekly coverage: scheduled hours / effective weekly capacity
    const coverage = coverageDenominator > 0 ? Math.round((scheduledH / coverageDenominator) * 100) : 0;
    const capNote = weeklyTarget > maxWeeklySchedulable
      ? ` [auth ${weeklyTarget}h exceeds 5-day capacity — denominator capped at ${maxWeeklySchedulable}h]` : "";

    let status = "UNDER-SERVED";
    if (coverage >= 90) { status = "OPTIMAL"; fullyCovered++; }
    else if (coverage < 70) { underServed++; }

    const flags: string[] = [];
    if (scheduledH === 0) {
      const reason = result.skipReasons[c.id];
      flags.push(reason ?? "Not scheduled — reason unknown");
      noProvider++;
    } else if (result.skipReasons[c.id]) {
      flags.push(result.skipReasons[c.id]); // partial schedule warning
    }

    let daysUntilExpiry: number | null = null;
    if (c.authorizationEndDate) {
      daysUntilExpiry = Math.ceil((new Date(c.authorizationEndDate).getTime() - today.getTime()) / 86_400_000);
      if (daysUntilExpiry >= 0 && daysUntilExpiry <= 30) { flags.push(`Auth expiring in ${daysUntilExpiry} days`); expiringAuth++; }
    }

    const daysCount = clientDaysScheduled.get(c.id)?.size ?? 0;
    console.log(`\n  ${c.lastName}, ${c.firstName}`);
    console.log(`    Auth weekly:    ${c.approvedWeeklyHours}h${capNote}`);
    console.log(`    Scheduled:      ${scheduledH.toFixed(1)}h across ${daysCount} day${daysCount !== 1 ? "s" : ""}  |  Weekly coverage: ${coverage === 0 ? "—" : coverage + "%"}`);
    console.log(`    Status:         ${status}`);
    if (c.authorizationEndDate) {
      console.log(`    Auth expires:   ${c.authorizationEndDate}${daysUntilExpiry !== null ? ` (${daysUntilExpiry} days)` : ""}`);
    }
    // Show per-day assignments
    for (const day of SCHEDULABLE_DAYS) {
      const dayProposals = result.proposals.filter(p => p.clientId === c.id && p.dayOfWeek === day);
      for (const pr of dayProposals) {
        const pv = providerMap.get(pr.providerId);
        const pvLabel = pv ? `${pv.lastName}, ${pv.firstName} (${pv.position})` : pr.providerId;
        console.log(`    ${day.charAt(0) + day.slice(1).toLowerCase().padEnd(9)}  ${pvLabel}  ${pr.startTime}–${pr.endTime}`);
      }
    }
    if (flags.length > 0) {
      for (const f of flags) console.log(`    ⚠  ${f}`);
    }
  }

  // Clients with any scheduled hours (existing + fresh proposals)
  const clientsWithAnyHours = schedulerClients.filter(c => (clientScheduledHours.get(c.id) ?? 0) > 0).length;
  // Constraint-blocked = clients with 0 hours AND a skip reason that isn't "already covered"
  const constraintBlocked = schedulerClients.filter(c => {
    const hrs = clientScheduledHours.get(c.id) ?? 0;
    return hrs === 0 && !!result.skipReasons[c.id];
  }).length;

  console.log(`\n  SUMMARY`);
  console.log(`    Clients with any hours: ${clientsWithAnyHours} / ${schedulerClients.length}`);
  console.log(`    Fresh proposals:        ${result.proposals.length}`);
  console.log(`    Fully covered (≥90%):   ${fullyCovered}`);
  console.log(`    Constraint-blocked:     ${constraintBlocked}  (0 hours + no eligible provider)`);
  console.log(`    Expiring auths (30d):   ${expiringAuth}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // PASS 4 — SCHEDULE SCORE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\nPASS 4 — SCHEDULE SCORE\n${"─".repeat(56)}`);

  const complianceScore = violations.length === 0 ? 100 : 0;
  const utilizationScore = overallDayFill; // day-fill rate on working days only
  // Coverage score: based on clients ≥90% covered (existing sessions + fresh proposals)
  // Not based on result.totalClientsScheduled which only counts fresh proposals this run —
  // that would score 0 whenever the week is already scheduled.
  const coverageScore = schedulerClients.length > 0
    ? Math.round((fullyCovered / schedulerClients.length) * 100)
    : 0;
  // Consistency: % of proposals where provider is in client's historicalProviderIds
  const proposalsWithHistory = result.proposals.filter(p => {
    const c = clientMap.get(p.clientId);
    return c && c.historicalProviderIds.includes(p.providerId);
  });
  const consistencyScore = result.proposals.length > 0
    ? Math.round((proposalsWithHistory.length / result.proposals.length) * 100)
    : 100;
  // Travel: no Maps data in this script, score 100 (unknown)
  const travelScore = 100;

  const finalScore = Math.round(
    complianceScore * 0.30 +
    utilizationScore * 0.30 +
    coverageScore   * 0.25 +
    consistencyScore * 0.10 +
    travelScore     * 0.05
  );

  const rating = finalScore >= 90 ? "Excellent" : finalScore >= 75 ? "Good" : finalScore >= 60 ? "Fair" : "Poor";

  console.log(`\n  SCHEDULE SCORE: ${finalScore}/100 — ${rating}\n`);
  console.log(`  Breakdown:`);
  console.log(`    Compliance:           ${complianceScore}/100  (weight: 30%)`);
  console.log(`    Day-fill Rate:        ${utilizationScore}/100  (weight: 30%)`);
  console.log(`    Client Coverage:      ${coverageScore}/100  (weight: 25%)`);
  console.log(`    Provider Consistency: ${consistencyScore}/100  (weight: 10%)`);
  console.log(`    Travel Efficiency:    ${travelScore}/100  (weight:  5%) [no GPS data — assumed 0 drive time]`);

  // ── Top actions ──────────────────────────────────────────────────────────────
  console.log(`\n  Top actions to improve this score:`);
  const actions: string[] = [];

  if (constraintBlocked > 0) {
    // Only report clients with 0 hours AND a constraint failure — not clients already covered
    const blockedList = schedulerClients
      .filter(c => (clientScheduledHours.get(c.id) ?? 0) === 0 && !!result.skipReasons[c.id])
      .map(c => `${c.lastName}: ${result.skipReasons[c.id]}`)
      .slice(0, 3).join(" | ");
    actions.push(`Resolve constraint failures for ${constraintBlocked} client(s) with 0 hours — ${blockedList}`);
  }
  if (overallDayFill < 80 && sparseWorkDays.length > 0) {
    const gapH = ((totalWorkingDayAvailMins - totalScheduledMins) / 60).toFixed(1);
    actions.push(`${gapH}h of unfilled time on working days — ${sparseWorkDays.map(s => s.name).join(", ")} have sparse days that could absorb more clients`);
  }
  if (expiringAuth > 0) {
    actions.push(`Renew ${expiringAuth} authorization(s) expiring within 30 days to avoid service gaps`);
  }
  if (consistencyScore < 80 && result.proposals.length > 0) {
    actions.push(`Improve provider consistency — ${result.proposals.length - proposalsWithHistory.length} client(s) assigned to a different provider than prior weeks`);
  }
  if (actions.length === 0) actions.push("Schedule is already highly optimized — no immediate actions needed");

  actions.forEach((a, i) => console.log(`    ${i + 1}. ${a}`));

  // ─────────────────────────────────────────────────────────────────────────────
  // PROPOSALS DETAIL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(56)}`);
  console.log(`PROPOSED SESSIONS (${result.proposals.length})`);
  for (const p of result.proposals) {
    const c = clientMap.get(p.clientId)!;
    const pv = providerMap.get(p.providerId)!;
    console.log(`  ✅ ${c.lastName}, ${c.firstName}  →  ${pv.lastName}, ${pv.firstName} (${pv.position})  —  ${p.dayOfWeek} ${p.startTime}–${p.endTime}`);
  }
  if (constraintBlocked > 0) {
    console.log(`\nCONSTRAINT-BLOCKED CLIENTS (${constraintBlocked}) — 0 hours scheduled`);
    for (const c of schedulerClients) {
      const hrs = clientScheduledHours.get(c.id) ?? 0;
      if (hrs === 0 && result.skipReasons[c.id]) {
        console.log(`  ❌ ${c.lastName}, ${c.firstName}  —  ${result.skipReasons[c.id]}`);
      }
    }
  }
  if (result.warnings.length > 0) {
    console.log(`\nWARNINGS`);
    for (const w of result.warnings) console.log(`  ⚠  ${w}`);
  }

  console.log(`\n${"═".repeat(56)}\n`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
