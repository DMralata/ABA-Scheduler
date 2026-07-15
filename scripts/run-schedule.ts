/**
 * run-schedule.ts
 * Runs the auto-scheduler for a given week directly against the DB,
 * saves proposals, and prints:
 *   1. Authorization utilization per client
 *   2. Preferred slot adherence per proposal
 *   3. Provider / client breakdown
 *
 * Usage:  npx tsx scripts/run-schedule.ts [YYYY-MM-DD]
 * Default: current week
 */

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import { optimize, createWorkingState } from "../src/lib/scheduler/optimizer";
import type { SchedulerClient, SchedulerProvider } from "../src/lib/scheduler/types";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();

const MAX_SESSION_HOURS = 6.0;
const MIN_SESSION_HOURS = 1.5;
const DAY_OFFSET: Record<DayOfWeek, number> = {
  MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3,
  FRIDAY: 4, SATURDAY: 5, SUNDAY: 6,
};

function toLocalDateStr(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function toLocalDayOfWeek(d: Date, tz: string): DayOfWeek {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d).toUpperCase() as DayOfWeek;
}
function toLocalTime(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
function parseHHMM(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Converts DayOfWeek + local HH:MM → UTC Date for the given week (Monday midnight UTC) */
function toUtcDateTime(weekOf: Date, dayOfWeek: DayOfWeek, localTime: string, timezone: string): Date {
  const [hours, minutes] = localTime.split(":").map(Number);
  const targetDate = new Date(weekOf.getTime() + DAY_OFFSET[dayOfWeek] * 24 * 3_600_000);
  const dateStr = targetDate.toISOString().slice(0, 10);
  const anchor = new Date(`${dateStr}T12:00:00Z`);
  const localNoonStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(anchor);
  const localDateOnly = localNoonStr.slice(0, 10);
  const noonUTC = new Date(`${localDateOnly}T12:00:00Z`);
  const localNoonHour = parseInt(localNoonStr.slice(12, 14), 10);
  const localNoonMin  = parseInt(localNoonStr.slice(15, 17), 10);
  const offsetMs = (12 - localNoonHour) * 3_600_000 - localNoonMin * 60_000;
  const localMidnightUTC = new Date(noonUTC.getTime() + offsetMs - 12 * 3_600_000);
  return new Date(localMidnightUTC.getTime() + hours * 3_600_000 + minutes * 60_000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const targetArg = process.argv[2];
  const targetDateObj = targetArg ? new Date(`${targetArg}T12:00:00Z`) : new Date();

  const center = await prisma.center.findFirst();
  if (!center) { console.error("No center found."); process.exit(1); }
  const tz = center.timezone;
  const { weekStart, weekEnd } = getWeekBoundaries(targetDateObj, tz);
  const weekOf = new Date(weekStart.getTime() + 86_400_000); // Monday midnight UTC

  const mondayDate = toLocalDateStr(weekOf, tz);
  const fridayDate = toLocalDateStr(new Date(weekOf.getTime() + 4 * 86_400_000), tz);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`AUTO-SCHEDULE RUN — ${mondayDate} through ${fridayDate}`);
  console.log(`Center: ${center.name}  |  TZ: ${tz}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}\n`);

  // ── Session types ────────────────────────────────────────────────────────────
  const [centerST, homeST, driveTimeST] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);
  const defaultST = centerST ?? await prisma.sessionType.findFirst({ where: { billable: true }, orderBy: { createdAt: "asc" } });
  if (!defaultST) { console.error("No billable session type found."); process.exit(1); }
  const homeSTId = homeST?.id ?? defaultST.id;

  // ── Clients ──────────────────────────────────────────────────────────────────
  const rawClients = await prisma.client.findMany({
    where: {
      AND: [
        { OR: [{ centerId: center.id }, { centerId: null }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
      ],
    },
    include: {
      availability: true,
      approvedHomeProviders: { where: { endDate: null } },
      preferredSlots: true,
    },
  });
  const clientIds = rawClients.map((c) => c.id);

  // ── Authorizations ───────────────────────────────────────────────────────────
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

  // Used hours from already-booked sessions this week
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

  // Historical provider preference (prior 4 weeks)
  const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 86_400_000);
  const priorSessions = await prisma.session.findMany({
    where: { clientId: { in: clientIds }, startTime: { gte: fourWeeksAgo, lt: weekStart }, status: { in: ["SCHEDULED", "COMPLETED", "IN_PROGRESS"] } },
    select: { clientId: true, providerId: true, startTime: true },
    orderBy: { startTime: "desc" },
  });
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) historicalByClient[s.clientId].push(s.providerId);
  }

  // ── Providers ────────────────────────────────────────────────────────────────
  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });
  const providerIds = rawProviders.map((p) => p.id);

  // Provider blocks
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

  // Client blocks
  const clientBlocksRaw = await prisma.clientBlock.findMany({
    where: { clientId: { in: clientIds }, date: { gte: weekStart, lte: weekEnd } },
    select: { clientId: true, date: true, startTime: true, endTime: true },
  });
  const blocksByClient: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const b of clientBlocksRaw) {
    const ds = toLocalDateStr(b.date, tz);
    if (!blocksByClient[b.clientId]) blocksByClient[b.clientId] = [];
    blocksByClient[b.clientId].push({ date: ds, startTime: b.startTime, endTime: b.endTime });
  }

  // Booked sessions + approved proposals for this week
  const [bookedSessions, approvedProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        OR: [
          { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, providerId: { in: providerIds } },
          { status: "CANCELLED", cancelledBy: "PROVIDER", providerId: { in: providerIds } },
          { status: "CANCELLED", cancelledBy: "CLIENT",   clientId:  { in: clientIds } },
        ],
        startTime: { gte: weekStart },
        endTime: { lte: weekEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true, sessionTypeId: true, status: true, cancelledBy: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
        status: "APPROVED",
        startTime: { gte: weekStart },
        endTime: { lte: weekEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true },
    }),
  ]);

  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE" }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};

  for (const s of [...bookedSessions, ...approvedProposals]) {
    if (driveTimeST && "sessionTypeId" in s && s.sessionTypeId === driveTimeST.id) continue;
    const dow = toLocalDayOfWeek(s.startTime, tz);
    const localStart = toLocalTime(s.startTime, tz);
    const localEnd   = toLocalTime(s.endTime, tz);
    const cancelledBy = "cancelledBy" in s ? s.cancelledBy : null;

    if (cancelledBy !== "CLIENT" && s.providerId) {
      if (!bookedByProvider[s.providerId]) bookedByProvider[s.providerId] = [];
      bookedByProvider[s.providerId].push({ dayOfWeek: dow, startTime: localStart, endTime: localEnd, clientId: s.clientId ?? undefined, locationType: s.locationType ?? undefined });
    }
    if (s.clientId && cancelledBy !== "PROVIDER") {
      if (!bookedByClient[s.clientId]) bookedByClient[s.clientId] = [];
      bookedByClient[s.clientId].push({ dayOfWeek: dow, startTime: localStart, endTime: localEnd });
    }
  }

  const providerWeeklyHoursMap: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (s.status === "CANCELLED") continue;
    if (!s.providerId) continue;
    providerWeeklyHoursMap[s.providerId] = (providerWeeklyHoursMap[s.providerId] ?? 0)
      + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
  }

  // ── Build scheduler input ────────────────────────────────────────────────────
  const schedulerClients: SchedulerClient[] = rawClients.map((c) => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
    const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;

    const daysNeeded = (() => {
      if (remaining === null || remaining <= 0) return 1;
      const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
      const availDays = new Set(c.availability.map((a) => a.dayOfWeek)).size;
      return Math.max(1, Math.min(raw, availDays));
    })();

    const sessionHours = (() => {
      if (remaining === null || remaining <= 0) return c.defaultSessionHours ?? center.defaultSessionHours;
      const rawPerDay = remaining / daysNeeded;
      const snapped = Math.round(rawPerDay * 2) / 2;
      return Math.max(snapped, MIN_SESSION_HOURS);
    })();

    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      latitude: c.latitude,
      longitude: c.longitude,
      sessionHours,
      daysNeeded,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      availability: c.availability.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
      authorizationId: authInfo?.authId ?? null,
      approvedWeeklyHours: authInfo?.weeklyHours ?? 0,
      usedHoursThisWeek: used,
      authorizationEndDate: authInfo?.endDate ? toLocalDateStr(authInfo.endDate, tz) : null,
      approvedProviderIds: c.approvedHomeProviders.map((ah) => ah.providerId),
      bookedWindows: bookedByClient[c.id] ?? [],
      blocks: blocksByClient[c.id] ?? [],
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: (historicalByClient[c.id] ?? []).length > 0,
      preferredLocation: c.preferredLocation,
      preferredSlots: c.preferredSlots.map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime })),
    };
  });

  const schedulerProviders: SchedulerProvider[] = rawProviders.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position as "BCBA" | "BCaBA" | "RBT",
    rbtLevel: p.rbtLevel,
    gender: p.gender,
    spanish: p.spanish,
    latitude: p.latitude,
    longitude: p.longitude,
    availability: p.availability.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
    bookedWindows: bookedByProvider[p.id] ?? [],
    blocks: blocksByProvider[p.id] ?? [],
    weeklyHoursAlreadyScheduled: providerWeeklyHoursMap[p.id] ?? 0,
  }));

  // ── Delete existing PENDING proposals for the week ────────────────────────────
  const deleted = await prisma.proposedSession.deleteMany({
    where: {
      status: "PENDING",
      startTime: { gte: weekStart, lt: weekEnd },
      OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
    },
  });
  console.log(`Cleared ${deleted.count} existing PENDING proposals for this week.\n`);

  // ── Run optimizer ─────────────────────────────────────────────────────────────
  const workingState = createWorkingState();
  const result = optimize(
    {
      weekOf,
      targetDate: mondayDate,
      timezone: tz,
      centerId: center.id,
      clients: schedulerClients,
      providers: schedulerProviders,
      sessionTypeIds: { CENTER: defaultST.id, HOME: homeSTId, SCHOOL: defaultST.id, DAYCARE: defaultST.id },
      driveTimeSessionTypeId: driveTimeST?.id ?? null,
      driveMinutes: {},
      distanceMeters: {},
      weekMode: true,
    },
    workingState
  );

  // ── Save proposals ────────────────────────────────────────────────────────────
  let saved = 0;
  let skipped = 0;
  for (const p of result.proposals) {
    try {
      const startTime = toUtcDateTime(weekOf, p.dayOfWeek as DayOfWeek, p.startTime, tz);
      const endTime   = toUtcDateTime(weekOf, p.dayOfWeek as DayOfWeek, p.endTime, tz);
      if (endTime <= startTime) { skipped++; continue; }
      await prisma.proposedSession.create({
        data: {
          weekOf,
          clientId: p.clientId,
          providerId: p.providerId,
          sessionTypeId: p.sessionTypeId,
          authorizationId: p.authorizationId,
          startTime,
          endTime,
          timezone: tz,
          locationType: p.locationType,
          status: "PENDING",
          reasoning: p.reasoning,
        },
      });
      saved++;
    } catch {
      skipped++;
    }
  }
  console.log(`Saved ${saved} proposals  (${skipped} skipped).`);

  // ─────────────────────────────────────────────────────────────────────────────
  // REPORT 1 — AUTHORIZATION UTILIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`AUTHORIZATION UTILIZATION — week of ${mondayDate}`);
  console.log(`${"─".repeat(60)}`);

  const clientMap = new Map(schedulerClients.map((c) => [c.id, c]));
  const providerMap = new Map(schedulerProviders.map((p) => [p.id, p]));

  // Hours per client from fresh proposals
  const proposedHoursByClient: Record<string, number> = {};
  for (const p of result.proposals) {
    const hrs = (parseHHMM(p.endTime) - parseHHMM(p.startTime)) / 60;
    proposedHoursByClient[p.clientId] = (proposedHoursByClient[p.clientId] ?? 0) + hrs;
  }

  const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_ORDER: Record<DayOfWeek, number> = {
    MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6,
  };

  let totalAuthorized = 0, totalScheduled = 0;
  let fullyMet = 0, underServed = 0, blocked = 0;

  const sortedClients = [...schedulerClients].sort((a, b) => a.lastName.localeCompare(b.lastName));

  for (const c of sortedClients) {
    const auth = clientAuthMap[c.id];
    const authorizedH = auth?.weeklyHours ?? 0;
    const scheduledH  = (c.usedHoursThisWeek) + (proposedHoursByClient[c.id] ?? 0);
    const coverage    = authorizedH > 0 ? Math.round((scheduledH / authorizedH) * 100) : 0;
    const skipReason  = result.skipReasons[c.id];

    totalAuthorized += authorizedH;
    totalScheduled  += scheduledH;
    if (scheduledH === 0) blocked++;
    else if (coverage >= 90) fullyMet++;
    else underServed++;

    const bar = (() => {
      const filled = Math.min(10, Math.round(coverage / 10));
      return "█".repeat(filled) + "░".repeat(10 - filled);
    })();

    const statusIcon = scheduledH === 0 ? "❌" : coverage >= 90 ? "✅" : "⚠️ ";
    console.log(`\n  ${statusIcon} ${c.lastName}, ${c.firstName}  (${c.preferredLocation})`);
    console.log(`     Auth: ${authorizedH}h/wk  |  Scheduled: ${scheduledH.toFixed(1)}h  |  [${bar}] ${coverage}%`);
    if (auth) {
      const daysLeft = Math.ceil((auth.endDate.getTime() - new Date().getTime()) / 86_400_000);
      console.log(`     Auth ID: ${auth.authId.slice(-8)}  |  Expires: ${toLocalDateStr(auth.endDate, tz)} (${daysLeft}d)`);
    }
    if (skipReason) console.log(`     ⚠  Skip reason: ${skipReason}`);
  }

  const overallCoverage = totalAuthorized > 0 ? Math.round((totalScheduled / totalAuthorized) * 100) : 0;
  console.log(`\n  AGGREGATE`);
  console.log(`    Total authorized:   ${totalAuthorized}h/wk`);
  console.log(`    Total scheduled:    ${totalScheduled.toFixed(1)}h`);
  console.log(`    Overall coverage:   ${overallCoverage}%`);
  console.log(`    Fully met (≥90%):   ${fullyMet}`);
  console.log(`    Under-served:       ${underServed}`);
  console.log(`    Blocked (0h):       ${blocked}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // REPORT 2 — PREFERRED SLOT ADHERENCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`PREFERRED SLOT ADHERENCE`);
  console.log(`${"─".repeat(60)}`);

  let totalWithPrefs = 0, matchedAll = 0, matchedPartial = 0, noMatch = 0;
  const proposalsByClient: Record<string, typeof result.proposals> = {};
  for (const p of result.proposals) {
    if (!proposalsByClient[p.clientId]) proposalsByClient[p.clientId] = [];
    proposalsByClient[p.clientId].push(p);
  }

  for (const c of sortedClients) {
    const prefs = c.preferredSlots ?? [];
    const proposals = proposalsByClient[c.id] ?? [];
    if (prefs.length === 0) continue;

    totalWithPrefs++;
    const sortedPrefs = [...prefs].sort((a, b) => DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek]);

    // Count proposals that hit a preferred slot
    const matchedProposals = proposals.filter((p) =>
      prefs.some((pref) => pref.dayOfWeek === p.dayOfWeek && pref.startTime === p.startTime)
    );
    const matchRate = proposals.length > 0 ? matchedProposals.length / proposals.length : 0;

    const icon = proposals.length === 0 ? "❌" : matchRate === 1 ? "✅" : matchRate > 0 ? "⚠️ " : "❌";
    console.log(`\n  ${icon} ${c.lastName}, ${c.firstName}`);

    // Show preferred slots
    console.log(`     Preferred: ${sortedPrefs.map((p) => `${p.dayOfWeek.slice(0,3)} ${p.startTime}`).join("  |  ")}`);

    if (proposals.length === 0) {
      console.log(`     Proposals: none (client blocked/unscheduled)`);
      noMatch++;
    } else {
      const provName = (id: string) => { const p = providerMap.get(id); return p ? `${p.lastName}, ${p.firstName}` : id; };
      for (const p of [...proposals].sort((a, b) => DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek])) {
        const hit = prefs.some((pref) => pref.dayOfWeek === p.dayOfWeek && pref.startTime === p.startTime);
        const tag = hit ? "✅ preferred" : "↩ fallback";
        console.log(`     ${p.dayOfWeek.slice(0,3)} ${p.startTime}–${p.endTime}  →  ${provName(p.providerId)}  [${tag}]`);
      }
      if (matchRate === 1) matchedAll++;
      else if (matchRate > 0) matchedPartial++;
      else noMatch++;
    }
  }

  console.log(`\n  SUMMARY`);
  console.log(`    Clients with preferred slots: ${totalWithPrefs}`);
  console.log(`    All slots matched:            ${matchedAll}`);
  console.log(`    Partial match:                ${matchedPartial}`);
  console.log(`    No match / fallback only:     ${noMatch}`);
  const adherenceRate = totalWithPrefs > 0 ? Math.round(((matchedAll + matchedPartial) / totalWithPrefs) * 100) : 0;
  console.log(`    Adherence rate:               ${adherenceRate}%`);

  // ─────────────────────────────────────────────────────────────────────────────
  // REPORT 3 — PROVIDER / CLIENT BREAKDOWN
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`PROVIDER / CLIENT BREAKDOWN`);
  console.log(`${"─".repeat(60)}`);

  const byProvider = new Map<string, { name: string; position: string; proposals: typeof result.proposals }>();
  for (const p of result.proposals) {
    if (!byProvider.has(p.providerId)) {
      const pv = providerMap.get(p.providerId);
      byProvider.set(p.providerId, { name: pv ? `${pv.lastName}, ${pv.firstName}` : p.providerId, position: pv?.position ?? "?", proposals: [] });
    }
    byProvider.get(p.providerId)!.proposals.push(p);
  }

  for (const [, { name, position, proposals }] of [...byProvider.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const totalH = proposals.reduce((s, p) => s + (parseHHMM(p.endTime) - parseHHMM(p.startTime)) / 60, 0);
    console.log(`\n  ${name}  (${position})  —  ${totalH.toFixed(1)}h`);
    const sorted = [...proposals].sort((a, b) => DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek] || a.startTime.localeCompare(b.startTime));
    for (const p of sorted) {
      const c = clientMap.get(p.clientId);
      const cName = c ? `${c.lastName}, ${c.firstName}` : p.clientId;
      const hrs = (parseHHMM(p.endTime) - parseHHMM(p.startTime)) / 60;
      const prefTag = (c?.preferredSlots ?? []).some((pref) => pref.dayOfWeek === p.dayOfWeek && pref.startTime === p.startTime) ? " ★" : "";
      console.log(`    ${p.dayOfWeek.slice(0,3)}  ${p.startTime}–${p.endTime}  (${hrs.toFixed(1)}h)  ${cName}${prefTag}`);
    }
  }

  // Unscheduled clients
  const skippedClients = sortedClients.filter((c) => !proposalsByClient[c.id] || proposalsByClient[c.id].length === 0);
  if (skippedClients.length > 0) {
    console.log(`\n  UNSCHEDULED CLIENTS (${skippedClients.length})`);
    for (const c of skippedClients) {
      const reason = result.skipReasons[c.id] ?? "—";
      console.log(`    ❌ ${c.lastName}, ${c.firstName}  —  ${reason}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`\n  WARNINGS`);
    for (const w of result.warnings) console.log(`  ⚠  ${w}`);
  }

  console.log(`\n${"═".repeat(60)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
