// Direct scheduler runner — mirrors /api/scheduler/propose-week without HTTP auth
// Usage: npx tsx scripts/run-scheduler-direct.ts

import { prisma } from "@/lib/prisma";
import { runScheduler } from "@/lib/scheduler/index";
import { buildAllDriveTimeMaps } from "@/lib/scheduler/maps";
import { getWeekBoundaries } from "@/lib/utils";
import { getWeeklyHoursMap, SESSION_CONFLICT_STATUSES, SESSION_BILLABLE_STATUSES } from "@/lib/queries/sessions";
import type { SchedulerClient, SchedulerProvider } from "@/lib/scheduler/types";

const MAX_SESSION_HOURS = 8.0;
const MIN_SESSION_HOURS = 1.5;

const CENTER_ID = "cmn56xpu90000wt7v2o7v0jnm";
const WEEK_OF_STR = "2026-04-17"; // any date in the target week

async function main() {
  const center = await prisma.center.findUnique({ where: { id: CENTER_ID } });
  if (!center) throw new Error("Center not found");

  const timezone = center.timezone;
  const weekOfObj = new Date(`${WEEK_OF_STR}T12:00:00Z`);
  const { weekStart, weekEnd } = getWeekBoundaries(weekOfObj, timezone);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000);

  const mondayDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(weekOf);

  console.log("Week boundaries:", weekStart.toISOString(), "→", weekEnd.toISOString());
  console.log("Monday date:", mondayDate);

  // Session types
  const [centerSessionType, homeSessionType, driveTimeSessionType] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);
  const defaultSessionType = centerSessionType ??
    await prisma.sessionType.findFirst({ where: { billable: true }, orderBy: { createdAt: "asc" } });
  if (!defaultSessionType) throw new Error("No billable session type found");
  const homeSessionTypeId = homeSessionType?.id ?? defaultSessionType.id;

  // Clients
  const rawClients = await prisma.client.findMany({
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
  });
  const clientIds = rawClients.map((c) => c.id);
  console.log("Clients loaded:", clientIds.length);

  // Authorizations
  const allAuths = await prisma.authorization.findMany({
    where: {
      clientId: { in: clientIds },
      startDate: { lte: weekEnd },
      endDate: { gte: weekStart },
    },
    orderBy: { startDate: "desc" },
    select: { id: true, clientId: true, approvedHoursPerWeek: true, endDate: true },
  });
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

  const usedHoursMap = await getWeeklyHoursMap(authorizationIds, weekStart, weekEnd);

  // Historical sessions (12-week window)
  const twelveWeeksAgo = new Date(weekStart.getTime() - 84 * 24 * 3_600_000);
  const priorSessions = await prisma.session.findMany({
    where: {
      clientId: { in: clientIds },
      startTime: { gte: twelveWeeksAgo, lt: weekStart },
      status: { in: SESSION_BILLABLE_STATUSES },
    },
    select: { clientId: true, providerId: true, startTime: true },
    orderBy: { startTime: "desc" },
  });
  const historicalByClient: Record<string, string[]> = {};
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) {
      historicalByClient[s.clientId].push(s.providerId);
    }
  }

  // Providers
  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId: CENTER_ID }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });
  const providerIds = rawProviders.map((p) => p.id);
  console.log("Providers loaded:", providerIds.length);

  // Blocks
  const [providerBlocks, clientBlocksRaw] = await Promise.all([
    prisma.providerBlock.findMany({
      where: { providerId: { in: providerIds }, date: { gte: weekStart, lte: weekEnd } },
      select: { providerId: true, date: true, startTime: true, endTime: true },
    }),
    prisma.clientBlock.findMany({
      where: { clientId: { in: clientIds }, date: { gte: weekStart, lte: weekEnd } },
      select: { clientId: true, date: true, startTime: true, endTime: true },
    }),
  ]);
  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const block of providerBlocks) {
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(block.date);
    if (!blocksByProvider[block.providerId]) blocksByProvider[block.providerId] = [];
    blocksByProvider[block.providerId].push({ date: dateStr, startTime: block.startTime, endTime: block.endTime });
  }
  const blocksByClient: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const block of clientBlocksRaw) {
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(block.date);
    if (!blocksByClient[block.clientId]) blocksByClient[block.clientId] = [];
    blocksByClient[block.clientId].push({ date: dateStr, startTime: block.startTime, endTime: block.endTime });
  }

  // Booked sessions + approved proposals
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

  function toLocalWindow(utcDate: Date): { dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string } {
    const localDay = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" })
      .format(utcDate).toUpperCase() as import("@prisma/client").DayOfWeek;
    const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
      .format(utcDate);
    return { dayOfWeek: localDay, startTime: localTime };
  }

  const bookedByProvider: Record<string, Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" | "DAYCARE" }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string; endTime: string }>> = {};

  for (const session of [...bookedSessions, ...approvedProposals]) {
    if (driveTimeSessionType && "sessionTypeId" in session && session.sessionTypeId === driveTimeSessionType.id) continue;
    const { dayOfWeek, startTime: localStart } = toLocalWindow(session.startTime);
    const { startTime: localEnd } = toLocalWindow(session.endTime);
    const cancelledBy = "cancelledBy" in session ? session.cancelledBy : null;
    const isCancelledByProvider = cancelledBy === "PROVIDER";
    const isCancelledByClient = cancelledBy === "CLIENT";

    if (!isCancelledByClient) {
      if (!bookedByProvider[session.providerId]) bookedByProvider[session.providerId] = [];
      bookedByProvider[session.providerId].push({
        dayOfWeek, startTime: localStart, endTime: localEnd,
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

  // Build scheduler input
  const schedulerClients: SchedulerClient[] = rawClients.map((c) => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
    const remaining = weeklyHours !== null ? Math.max(0, weeklyHours - used) : null;

    const daysNeeded = (() => {
      if (remaining === null || remaining <= 0) return 1;
      const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
      const SCHEDULABLE_DAYS = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]);
      const availDays = new Set(c.availability.filter((a) => SCHEDULABLE_DAYS.has(a.dayOfWeek)).map((a) => a.dayOfWeek)).size;
      return Math.max(1, Math.min(raw, availDays));
    })();

    const sessionHours = (() => {
      if (remaining === null || remaining <= 0) {
        return c.defaultSessionHours ?? center.defaultSessionHours;
      }
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
      usedHoursThisWeek: authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0,
      authorizationEndDate: authInfo?.endDate
        ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(authInfo.endDate)
        : null,
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
    position: p.position,
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

  // Drive time
  let driveMinutes: Record<string, Record<string, number>> = {};
  let distanceMeters: Record<string, Record<string, number>> = {};
  let driveTimeFailed = false;
  let driveTimeError = "";
  try {
    const providerAddressMap = new Map(rawProviders.map((p) => [
      p.id, [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") || null,
    ]));
    const clientAddressMap = new Map(rawClients.map((c) => [
      c.id, [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ") || null,
    ]));
    const centerAddress = [center.street, center.city, center.state, center.zip].filter(Boolean).join(", ") || null;
    const centerLocation = centerAddress ?? (center.latitude != null && center.longitude != null
      ? { lat: center.latitude, lng: center.longitude } : null);
    const allOriginIds = [center.id, ...schedulerProviders.map((p) => p.id)];
    const allOriginLocations = [centerLocation, ...schedulerProviders.map((p) => providerAddressMap.get(p.id) ?? null)];

    const maps = await buildAllDriveTimeMaps(
      allOriginIds, allOriginLocations,
      schedulerClients.map((c) => c.id),
      schedulerClients.map((c) => clientAddressMap.get(c.id) ?? null)
    );
    driveMinutes = maps.driveMinutes;
    distanceMeters = maps.distanceMeters;
  } catch (err) {
    driveTimeFailed = true;
    driveTimeError = err instanceof Error ? err.message : String(err);
    console.warn("[run-scheduler-direct] Drive time failed:", err);
    for (const p of schedulerProviders) {
      driveMinutes[p.id] = {}; distanceMeters[p.id] = {};
      for (const c of schedulerClients) { driveMinutes[p.id][c.id] = 0; distanceMeters[p.id][c.id] = 0; }
    }
    for (const from of schedulerClients) {
      driveMinutes[from.id] = driveMinutes[from.id] ?? {}; distanceMeters[from.id] = distanceMeters[from.id] ?? {};
      for (const to of schedulerClients) { driveMinutes[from.id][to.id] = 0; distanceMeters[from.id][to.id] = 0; }
    }
  }

  // Clean up existing proposals for the week
  await prisma.proposedSession.deleteMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { gte: weekStart, lt: weekEnd },
      OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
    },
  });
  if (driveTimeSessionType) {
    await prisma.session.deleteMany({
      where: {
        sessionTypeId: driveTimeSessionType.id,
        providerId: { in: providerIds },
        status: "SCHEDULED",
        startTime: { gte: weekStart, lt: weekEnd },
      },
    });
  }

  // Run scheduler
  const result = await runScheduler({
    weekOf,
    targetDate: mondayDate,
    timezone,
    centerId: center.id,
    clients: schedulerClients,
    providers: schedulerProviders,
    sessionTypeIds: { CENTER: defaultSessionType.id, HOME: homeSessionTypeId, SCHOOL: defaultSessionType.id },
    driveTimeSessionTypeId: driveTimeSessionType?.id ?? null,
    driveMinutes,
    distanceMeters,
    existingHomeSessions: [],
    weekMode: true,
  });

  const allWarnings = [...result.warnings];
  if (driveTimeFailed) allWarnings.push(`Drive time failed: ${driveTimeError}`);

  const output = {
    ...result,
    warnings: allWarnings,
    totalProposals: result.proposals.length,
    _debug: {
      clientsLoaded: schedulerClients.length,
      providersLoaded: schedulerProviders.length,
      weekOf: mondayDate,
      driveTimeFailed,
      driveTimeError,
      clientCadence: schedulerClients.map((c) => ({
        name: `${c.lastName}, ${c.firstName}`,
        authWeekly: c.approvedWeeklyHours,
        sessionHours: c.sessionHours,
        daysNeeded: c.daysNeeded,
        preferredLocation: c.preferredLocation,
      })),
    },
  };

  console.log("\n=== SCHEDULER RESULT ===");
  console.log(JSON.stringify(output, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
