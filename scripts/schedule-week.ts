/**
 * schedule-week.ts
 * Directly schedules remaining days (Thu + Fri) for the current week,
 * bypassing HTTP auth — for CLI/admin use only.
 *
 * Usage: npx tsx scripts/schedule-week.ts
 */

import { PrismaClient, DayOfWeek } from "@prisma/client";
import { runScheduler } from "../src/lib/scheduler/index";
import { buildAllDriveTimeMaps } from "../src/lib/scheduler/maps";
import { getWeekBoundaries } from "../src/lib/utils";
import { getWeeklyHoursMap, SESSION_CONFLICT_STATUSES, SESSION_BILLABLE_STATUSES } from "../src/lib/queries/sessions";
import type { SchedulerClient, SchedulerProvider } from "../src/lib/scheduler/types";

const prisma = new PrismaClient();

// Dates to schedule — full next week
const DAYS_TO_SCHEDULE = [
  "2026-04-06", // Monday
  "2026-04-07", // Tuesday
  "2026-04-08", // Wednesday
  "2026-04-09", // Thursday
  "2026-04-10", // Friday
];

async function scheduleDay(dateStr: string, centerId: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Scheduling: ${dateStr}`);
  console.log("=".repeat(60));

  const center = await prisma.center.findUnique({ where: { id: centerId } });
  if (!center) throw new Error("Center not found");

  const timezone = center.timezone;
  const targetDateObj = new Date(`${dateStr}T12:00:00Z`);
  const { weekStart, weekEnd } = getWeekBoundaries(targetDateObj, timezone);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000);

  const targetDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(targetDateObj);

  const [centerSessionType, homeSessionType, driveTimeSessionType] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);

  const defaultSessionType = centerSessionType ??
    await prisma.sessionType.findFirst({ where: { billable: true }, orderBy: { createdAt: "asc" } });
  if (!defaultSessionType) throw new Error("No billable session type found");

  const homeSessionTypeId = homeSessionType?.id ?? defaultSessionType.id;

  const rawClients = await prisma.client.findMany({
    where: {
      AND: [
        { OR: [{ centerId }, { centerId: null }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
      ],
    },
    include: {
      availability: true,
      approvedHomeProviders: { where: { endDate: null } },
    },
  });

  const clientIds = rawClients.map((c) => c.id);

  const allAuths = await prisma.authorization.findMany({
    where: {
      clientId: { in: clientIds },
      startDate: { lte: weekEnd },
      endDate: { gte: weekStart },
    },
    orderBy: { startDate: "desc" },
    select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
  });

  const authorizationIds: string[] = [];
  const clientAuthMap: Record<string, { authId: string; weeklyHours: number; endDate: Date }> = {};
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

  const usedHoursMap = await getWeeklyHoursMap(authorizationIds, weekStart, weekEnd);

  const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 24 * 3_600_000);
  const priorSessions = await prisma.session.findMany({
    where: {
      clientId: { in: clientIds },
      startTime: { gte: fourWeeksAgo, lt: weekStart },
      status: { in: SESSION_BILLABLE_STATUSES },
    },
    select: { clientId: true, providerId: true, startTime: true },
    orderBy: { startTime: "desc" },
  });

  const historicalProvidersByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalProvidersByClient[s.clientId]) historicalProvidersByClient[s.clientId] = [];
    if (!historicalProvidersByClient[s.clientId].includes(s.providerId)) {
      historicalProvidersByClient[s.clientId].push(s.providerId);
    }
  }

  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });

  const providerIds = rawProviders.map((p) => p.id);

  const providerBlocks = await prisma.providerBlock.findMany({
    where: {
      providerId: { in: providerIds },
      date: { gte: weekStart, lte: weekEnd },
    },
    select: { providerId: true, date: true, startTime: true, endTime: true },
  });

  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const block of providerBlocks) {
    const d = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(block.date);
    if (!blocksByProvider[block.providerId]) blocksByProvider[block.providerId] = [];
    blocksByProvider[block.providerId].push({ date: d, startTime: block.startTime, endTime: block.endTime });
  }

  const [bookedSessions, approvedProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        OR: [
          { status: { in: SESSION_CONFLICT_STATUSES }, providerId: { in: providerIds } },
          { status: "CANCELLED", cancelledBy: "PROVIDER", providerId: { in: providerIds } },
          { status: "CANCELLED", cancelledBy: "CLIENT", clientId: { in: clientIds } },
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

  function toLocalWindow(utcDate: Date): { dayOfWeek: DayOfWeek; startTime: string } {
    const localDay = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
    }).format(utcDate).toUpperCase() as DayOfWeek;
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(utcDate);
    return { dayOfWeek: localDay, startTime: localTime };
  }

  const dayNoonUTC = new Date(`${targetDate}T12:00:00Z`);
  const dayTzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dayNoonUTC);
  const dh = parseInt(dayTzParts.find((p) => p.type === "hour")!.value);
  const dm = parseInt(dayTzParts.find((p) => p.type === "minute")!.value);
  const ds = parseInt(dayTzParts.find((p) => p.type === "second")!.value);
  const dayOffsetMs = (dh === 24 ? 0 : dh) * 3_600_000 + dm * 60_000 + ds * 1_000;
  const targetDayStart = new Date(dayNoonUTC.getTime() - dayOffsetMs);
  const targetDayEnd = new Date(targetDayStart.getTime() + 24 * 3_600_000);

  const bookedByProvider: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: DayOfWeek; startTime: string; endTime: string }>> = {};

  for (const session of [...bookedSessions, ...approvedProposals]) {
    if (driveTimeSessionType && "sessionTypeId" in session && session.sessionTypeId === driveTimeSessionType.id) continue;
    if (!("cancelledBy" in session) && session.startTime >= targetDayStart && session.startTime < targetDayEnd) continue;

    const { dayOfWeek, startTime: localStart } = toLocalWindow(session.startTime);
    const { startTime: localEnd } = toLocalWindow(session.endTime);
    const cancelledBy = "cancelledBy" in session ? session.cancelledBy : null;
    const isCancelledByProvider = cancelledBy === "PROVIDER";
    const isCancelledByClient = cancelledBy === "CLIENT";

    if (!isCancelledByClient) {
      if (!bookedByProvider[session.providerId]) bookedByProvider[session.providerId] = [];
      bookedByProvider[session.providerId].push({
        dayOfWeek,
        startTime: localStart,
        endTime: localEnd,
        clientId: session.clientId ?? undefined,
        locationType: session.locationType ?? undefined,
      });
    }
    if (session.clientId && !isCancelledByProvider) {
      if (!bookedByClient[session.clientId]) bookedByClient[session.clientId] = [];
      bookedByClient[session.clientId].push({ dayOfWeek, startTime: localStart, endTime: localEnd });
    }
  }

  const providerWeeklyHoursMap: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (s.status === "CANCELLED") continue;
    const hrs = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    providerWeeklyHoursMap[s.providerId] = (providerWeeklyHoursMap[s.providerId] ?? 0) + hrs;
  }

  if (authorizationIds.length > 0) {
    const otherDayProposals = await prisma.proposedSession.findMany({
      where: {
        authorizationId: { in: authorizationIds },
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
        NOT: { AND: [{ startTime: { gte: targetDayStart } }, { startTime: { lt: targetDayEnd } }] },
      },
      select: { authorizationId: true, startTime: true, endTime: true },
    });
    for (const p of otherDayProposals) {
      if (!p.authorizationId) continue;
      const hrs = (p.endTime.getTime() - p.startTime.getTime()) / 3_600_000;
      usedHoursMap[p.authorizationId] = (usedHoursMap[p.authorizationId] ?? 0) + hrs;
    }
  }

  const DAY_ORDER: Record<string, number> = {
    MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
  };
  const targetDayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(targetDateObj).toUpperCase();
  const targetDayOrder = DAY_ORDER[targetDayStr] ?? 1;

  const schedulerClients: SchedulerClient[] = rawClients.map((c) => {
    const authInfo = clientAuthMap[c.id];
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      latitude: c.latitude,
      longitude: c.longitude,
      sessionHours: (() => {
        const weeklyHours = authInfo?.weeklyHours ?? null;
        const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
        const remaining = weeklyHours !== null ? weeklyHours - used : null;
        const remainingAvailDays = new Set(
          c.availability
            .filter((a) => (DAY_ORDER[a.dayOfWeek] ?? 8) >= targetDayOrder)
            .map((a) => a.dayOfWeek)
        ).size;
        const authPerDay =
          remaining !== null && remainingAvailDays > 0
            ? remaining / remainingAvailDays
            : (c.defaultSessionHours ?? center.defaultSessionHours);
        return Math.floor(Math.max(authPerDay, 0) * 2) / 2;
      })(),
      daysNeeded: 1,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      availability: c.availability.map((a) => ({
        dayOfWeek: a.dayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
      })),
      authorizationId: authInfo?.authId ?? null,
      approvedWeeklyHours: authInfo?.weeklyHours ?? 0,
      usedHoursThisWeek: authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0,
      authorizationEndDate: authInfo?.endDate
        ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(authInfo.endDate)
        : null,
      approvedProviderIds: c.approvedHomeProviders.map((ah) => ah.providerId),
      bookedWindows: bookedByClient[c.id] ?? [],
      blocks: [],
      historicalProviderIds: historicalProvidersByClient[c.id] ?? [],
      hasPriorWeekHistory: (historicalProvidersByClient[c.id] ?? []).length > 0,
      preferredLocation: c.preferredLocation,
    };
  });

  const schedulerProviders: SchedulerProvider[] = rawProviders.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    rbtLevel: p.rbtLevel,
    gender: p.gender,
    spanish: p.spanish,
    latitude: p.latitude,
    longitude: p.longitude,
    availability: p.availability.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      startTime: a.startTime,
      endTime: a.endTime,
    })),
    bookedWindows: bookedByProvider[p.id] ?? [],
    blocks: blocksByProvider[p.id] ?? [],
    weeklyHoursAlreadyScheduled: providerWeeklyHoursMap[p.id] ?? 0,
  }));

  // Drive time
  let driveMinutes: Record<string, Record<string, number>> = {};
  let distanceMeters: Record<string, Record<string, number>> = {};
  try {
    const providerAddressMap = new Map(rawProviders.map((p) => [
      p.id,
      [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") || null,
    ]));
    const clientAddressMap = new Map(rawClients.map((c) => [
      c.id,
      [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ") || null,
    ]));
    const clientAddrs = schedulerClients.map((c) => clientAddressMap.get(c.id) ?? null);
    const centerAddress = [center.street, center.city, center.state, center.zip].filter(Boolean).join(", ") || null;
    const centerLocation = centerAddress ?? (center.latitude != null && center.longitude != null
      ? { lat: center.latitude, lng: center.longitude }
      : null);
    const allOriginIds = [center.id, ...schedulerProviders.map((p) => p.id)];
    const allOriginLocations = [centerLocation, ...schedulerProviders.map((p) => providerAddressMap.get(p.id) ?? null)];
    const maps = await buildAllDriveTimeMaps(allOriginIds, allOriginLocations, schedulerClients.map((c) => c.id), clientAddrs);
    driveMinutes = maps.driveMinutes;
    distanceMeters = maps.distanceMeters;
  } catch {
    console.warn("Drive time unavailable, using zeros");
    for (const p of schedulerProviders) {
      driveMinutes[p.id] = {}; distanceMeters[p.id] = {};
      for (const c of schedulerClients) { driveMinutes[p.id][c.id] = 0; distanceMeters[p.id][c.id] = 0; }
    }
    for (const from of schedulerClients) {
      driveMinutes[from.id] = {}; distanceMeters[from.id] = {};
      for (const to of schedulerClients) { driveMinutes[from.id][to.id] = 0; distanceMeters[from.id][to.id] = 0; }
    }
  }

  // Clear existing proposals for this day
  await prisma.proposedSession.deleteMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { gte: targetDayStart, lt: targetDayEnd },
      OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
    },
  });

  if (driveTimeSessionType) {
    await prisma.session.deleteMany({
      where: {
        sessionTypeId: driveTimeSessionType.id,
        providerId: { in: providerIds },
        status: "SCHEDULED",
        startTime: { gte: targetDayStart, lt: targetDayEnd },
      },
    });
  }

  const existingHomeSessions = [...bookedSessions]
    .filter((s) => s.clientId && s.locationType === "HOME" && s.startTime >= targetDayStart && s.startTime < targetDayEnd)
    .map((s) => ({ providerId: s.providerId, clientId: s.clientId!, startTime: s.startTime, endTime: s.endTime }));

  const result = await runScheduler({
    weekOf,
    targetDate,
    timezone,
    centerId: center.id,
    clients: schedulerClients,
    providers: schedulerProviders,
    sessionTypeIds: { CENTER: defaultSessionType.id, HOME: homeSessionTypeId, SCHOOL: defaultSessionType.id },
    driveTimeSessionTypeId: driveTimeSessionType?.id ?? null,
    driveMinutes,
    distanceMeters,
    existingHomeSessions,
  });

  console.log(`  Proposals created: ${result.proposals.length}`);
  console.log(`  Unscheduled clients: ${result.totalClientsUnscheduled ?? 0}`);
  if ((result.unscheduledClientIds ?? []).length > 0) {
    console.log(`    → IDs: ${result.unscheduledClientIds.join(", ")}`);
  }
  if ((result.warnings ?? []).length > 0) {
    console.log(`  Warnings: ${result.warnings.join("; ")}`);
  }

  return result;
}

async function main() {
  const center = await prisma.center.findFirst({ select: { id: true, name: true, timezone: true } });
  if (!center) { console.error("No center found"); process.exit(1); }
  console.log(`Center: ${center.name} (${center.id}) — tz: ${center.timezone}`);

  for (const day of DAYS_TO_SCHEDULE) {
    await scheduleDay(day, center.id);
  }

  await prisma.$disconnect();
  console.log("\nDone. Refresh the schedule view to see proposals.");
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
