// POST /api/scheduler/propose-week
// Schedules the remaining part of the current week in a single optimizer pass.
//
// Key differences from /api/scheduler/propose (single-day):
//  - Session hours = approvedHoursPerWeek / ceil(approvedHoursPerWeek / MAX_SESSION_HOURS)
//    — evenly distributes auth across daysNeeded sessions instead of front-loading.
//  - daysNeeded per client is derived from the same formula.
//  - Deletes proposals + drive time sessions only from "now" forward — preserves
//    past days and today's already-scheduled morning sessions.
//  - Passes weekMode: true so the optimizer runs multi-round across remaining days.
//  - targetDate = today (not Monday) so the optimizer skips already-passed days.
//  - notBefore = current time so today's already-started window is not re-scheduled.
//
// Request body: { weekOf: string (ISO date within the target week), centerId: string, now?: string (ISO — current client time, defaults to server time) }

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { runScheduler } from "@/lib/scheduler/index";
import { buildAllDriveTimeMaps } from "@/lib/scheduler/maps";
import { schoolOriginIdFor, schoolToCenterDistance } from "@/lib/scheduler/schoolLocation";
import { getWeekBoundaries } from "@/lib/utils";
import type { SchedulerClient, SchedulerProvider } from "@/lib/scheduler/types";
import { getWeeklyHoursMap, getClientAvgWeeklyCancellationHours, SESSION_CONFLICT_STATUSES, SESSION_BILLABLE_STATUSES } from "@/lib/queries/sessions";
import { getClientNameMasker } from "@/lib/maskClient";

// Maximum session length per day. Clients with more weekly auth than this get multiple
// sessions per week rather than one marathon session.
const MAX_SESSION_HOURS = 8.0;
const MIN_SESSION_HOURS = 1.5;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
          }
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { weekOf: string; centerId: string; now?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { weekOf: weekOfStr, centerId, now: nowStr } = body;
  if (!weekOfStr || !centerId) {
    return NextResponse.json({ error: "weekOf and centerId are required" }, { status: 400 });
  }

  // Current time: use client-supplied value if present, otherwise server time.
  // This is the cutoff — proposals before this moment are left untouched.
  const notBefore = nowStr ? new Date(nowStr) : new Date();

  const weekOfObj = new Date(`${weekOfStr.slice(0, 10)}T12:00:00Z`);
  if (isNaN(weekOfObj.getTime())) {
    return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
  }

  const center = await prisma.center.findUnique({ where: { id: centerId } });
  if (!center) return NextResponse.json({ error: "Center not found" }, { status: 404 });

  const timezone = center.timezone;
  const { weekStart, weekEnd } = getWeekBoundaries(weekOfObj, timezone);
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000); // Monday midnight UTC

  // Monday date string — used for auth expiry warnings
  const mondayDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(weekOf);

  // Today's date in the center timezone — the optimizer will skip days before this.
  // Clamped to [Monday, Friday] of the target week so a weekend run still schedules
  // the full coming week rather than producing zero days.
  const todayRaw = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(notBefore);
  const fridayDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(weekOf.getTime() + 4 * 24 * 3_600_000)); // Friday
  // If today is before this week's Monday (running ahead) or after Friday (weekend), use Monday.
  const todayDateStr = todayRaw < mondayDate || todayRaw > fridayDate ? mondayDate : todayRaw;

  // ── Session types ────────────────────────────────────────────────────────────
  const [centerSessionType, homeSessionType, driveTimeSessionType] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);
  const defaultSessionType = centerSessionType ??
    await prisma.sessionType.findFirst({ where: { billable: true }, orderBy: { createdAt: "asc" } });
  if (!defaultSessionType) {
    return NextResponse.json({ error: "No billable session type found." }, { status: 422 });
  }
  const homeSessionTypeId = homeSessionType?.id ?? defaultSessionType.id;

  // ── Clients ──────────────────────────────────────────────────────────────────
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
      preferredSlots: true,
    },
  });
  const clientIds = rawClients.map((c) => c.id);

  // ── Authorizations ───────────────────────────────────────────────────────────
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

  // Used hours from already-booked sessions (SCHEDULED/COMPLETED — not proposals)
  const usedHoursMap = await getWeeklyHoursMap(authorizationIds, weekStart, weekEnd);

  // Average CLIENT-cancelled hours per week per client — used to compute the
  // over-scheduling buffer so net-delivered hours hit the authorization target.
  const avgCancellationMap = await getClientAvgWeeklyCancellationHours(
    rawClients.map((c) => ({ id: c.id, activeDate: c.activeDate }))
  );

  // ── Historical provider preference ──────────────────────────────────────────
  // 12-week window: captures longer clinical relationships (ABA therapy often runs months to years).
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
  const priorWeekClientIds = new Set<string>();
  const oneWeekAgo = new Date(weekStart.getTime() - 7 * 24 * 3_600_000);
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalByClient[s.clientId]) historicalByClient[s.clientId] = [];
    if (!historicalByClient[s.clientId].includes(s.providerId)) {
      historicalByClient[s.clientId].push(s.providerId);
    }
    if (s.startTime >= oneWeekAgo) priorWeekClientIds.add(s.clientId);
  }

  // ── Providers ────────────────────────────────────────────────────────────────
  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
  });
  const providerIds = rawProviders.map((p) => p.id);

  // Provider and client one-off blocks (date-specific, e.g. rest-of-day cancellations)
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

  // ── Booked sessions + approved proposals ────────────────────────────────────
  const [bookedSessions, approvedProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        OR: [
          { status: { in: SESSION_CONFLICT_STATUSES }, providerId: { in: providerIds } },
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

  function toLocalWindow(utcDate: Date): { dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string } {
    const localDay = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" })
      .format(utcDate).toUpperCase() as import("@prisma/client").DayOfWeek;
    const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
      .format(utcDate);
    return { dayOfWeek: localDay, startTime: localTime };
  }

  const bookedByProvider: Record<string, Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" }>> = {};
  const bookedByClient: Record<string, Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string; endTime: string }>> = {};

  for (const session of [...bookedSessions, ...approvedProposals]) {
    if (driveTimeSessionType && "sessionTypeId" in session && session.sessionTypeId === driveTimeSessionType.id) continue;

    const { dayOfWeek, startTime: localStart } = toLocalWindow(session.startTime);
    const { startTime: localEnd } = toLocalWindow(session.endTime);
    const cancelledBy = "cancelledBy" in session ? session.cancelledBy : null;
    const isCancelledByProvider = cancelledBy === "PROVIDER";
    const isCancelledByClient   = cancelledBy === "CLIENT";

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

  // Provider weekly hours already in DB
  const providerWeeklyHoursMap: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (s.status === "CANCELLED") continue;
    const hrs = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    providerWeeklyHoursMap[s.providerId] = (providerWeeklyHoursMap[s.providerId] ?? 0) + hrs;
  }

  // Over-scheduling buffer: schedule more than the raw authorization to compensate
  // for the client's typical cancellation rate. This ensures net-delivered hours
  // hit the authorization target even after expected cancellations.
  //   < 8 weeks active → 10% flat buffer (no reliable history yet)
  //   ≥ 8 weeks active → auth + avg weekly client-cancelled hours
  function effectiveTargetHours(weeklyHours: number, activeDate: Date | null, avgCancellations: number): number {
    if (!activeDate) return weeklyHours * 1.10;
    const weeksActive = (Date.now() - activeDate.getTime()) / (7 * 24 * 3_600_000);
    return weeksActive < 8
      ? weeklyHours * 1.10
      : weeklyHours + avgCancellations;
  }

  // ── Build scheduler input ────────────────────────────────────────────────────
  const maskClientName = await getClientNameMasker();
  const schedulerClients: SchedulerClient[] = rawClients.map((c) => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
    const targetHours = weeklyHours !== null
      ? effectiveTargetHours(weeklyHours, c.activeDate, avgCancellationMap[c.id] ?? 0)
      : null;
    const remaining = targetHours !== null ? Math.max(0, targetHours - used) : null;

    // Auth-derived cadence: split remaining hours across as few days as possible
    // while keeping each session at or below MAX_SESSION_HOURS.
    const daysNeeded = (() => {
      if (remaining === null || remaining <= 0) return 1;
      const raw = Math.ceil(remaining / MAX_SESSION_HOURS);
      // Cap at the number of schedulable (Mon–Fri) days the client is actually available.
      // Weekend availability is excluded — week mode only schedules Mon–Fri.
      const SCHEDULABLE_DAYS = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]);
      const availDays = new Set(c.availability.filter((a) => SCHEDULABLE_DAYS.has(a.dayOfWeek)).map((a) => a.dayOfWeek)).size;
      return Math.max(1, Math.min(raw, availDays));
    })();

    const sessionHours = (() => {
      if (remaining === null || remaining <= 0) {
        return c.defaultSessionHours ?? center.defaultSessionHours;
      }
      const rawPerDay = remaining / daysNeeded;
      const snapped = Math.round(rawPerDay * 2) / 2; // nearest 0.5h
      return Math.max(snapped, MIN_SESSION_HOURS);
    })();

    return {
      id: c.id,
      firstName: maskClientName(c.firstName),
      lastName: maskClientName(c.lastName),
      latitude: c.latitude,
      longitude: c.longitude,
      sessionHours,
      daysNeeded,
      minimumRbtLevel: c.minimumRbtLevel,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      availability: c.availability.map((a) => ({
        dayOfWeek: a.dayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
      })),
      authorizationId: authInfo?.authId ?? null,
      approvedWeeklyHours: targetHours ?? 0,
      usedHoursThisWeek: authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0,
      authorizationEndDate: authInfo?.endDate
        ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(authInfo.endDate)
        : null,
      approvedProviderIds: c.approvedHomeProviders.map((ah) => ah.providerId),
      bookedWindows: bookedByClient[c.id] ?? [],
      blocks: blocksByClient[c.id] ?? [],
      historicalProviderIds: historicalByClient[c.id] ?? [],
      hasPriorWeekHistory: priorWeekClientIds.has(c.id),
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
    availability: p.availability.map((a) => ({
      dayOfWeek: a.dayOfWeek,
      startTime: a.startTime,
      endTime: a.endTime,
    })),
    bookedWindows: bookedByProvider[p.id] ?? [],
    blocks: blocksByProvider[p.id] ?? [],
    weeklyHoursAlreadyScheduled: providerWeeklyHoursMap[p.id] ?? 0,
  }));

  // ── Drive time matrix ────────────────────────────────────────────────────────
  let driveMinutes: Record<string, Record<string, number>> = {};
  let distanceMeters: Record<string, Record<string, number>> = {};
  let driveTimeFailed = false;
  let driveTimeError = "";
  const schoolOriginId = schoolOriginIdFor(center.id);
  try {
    const providerAddressMap = new Map(rawProviders.map((p) => [
      p.id,
      [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") || null,
    ]));
    const clientAddressMap = new Map(rawClients.map((c) => [
      c.id,
      [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ") || null,
    ]));
    const centerAddress = [center.street, center.city, center.state, center.zip].filter(Boolean).join(", ") || null;
    const centerLocation = centerAddress ?? (center.latitude != null && center.longitude != null
      ? { lat: center.latitude, lng: center.longitude }
      : null);
    // Include the center's school address as a separate origin so HOME↔SCHOOL
    // transitions can be costed using a real school→client drive time.
    const schoolAddress = [center.schoolStreet, center.schoolCity, center.schoolState, center.schoolZip].filter(Boolean).join(", ") || null;
    const schoolLocation = schoolAddress ?? (center.schoolLatitude != null && center.schoolLongitude != null
      ? { lat: center.schoolLatitude, lng: center.schoolLongitude }
      : null);

    const allOriginIds = [center.id, ...schedulerProviders.map((p) => p.id), ...(schoolOriginId ? [schoolOriginId] : [])];
    const allOriginLocations = [centerLocation, ...schedulerProviders.map((p) => providerAddressMap.get(p.id) ?? null), ...(schoolOriginId ? [schoolLocation] : [])];

    const maps = await buildAllDriveTimeMaps(
      allOriginIds,
      allOriginLocations,
      schedulerClients.map((c) => c.id),
      schedulerClients.map((c) => clientAddressMap.get(c.id) ?? null)
    );
    driveMinutes = maps.driveMinutes;
    distanceMeters = maps.distanceMeters;

    // School↔center drive time: the maps helper only fetches origin→client pairs,
    // so populate this fixed value directly via haversine + 35mph average.
    if (schoolOriginId) {
      const sc = schoolToCenterDistance(
        center.schoolLatitude ?? null,
        center.schoolLongitude ?? null,
        center.latitude ?? null,
        center.longitude ?? null
      );
      if (sc) {
        driveMinutes[schoolOriginId] = driveMinutes[schoolOriginId] ?? {};
        distanceMeters[schoolOriginId] = distanceMeters[schoolOriginId] ?? {};
        driveMinutes[schoolOriginId][center.id] = sc.minutes;
        distanceMeters[schoolOriginId][center.id] = sc.meters;
        driveMinutes[center.id] = driveMinutes[center.id] ?? {};
        distanceMeters[center.id] = distanceMeters[center.id] ?? {};
        driveMinutes[center.id][schoolOriginId] = sc.minutes;
        distanceMeters[center.id][schoolOriginId] = sc.meters;
      }
    }
  } catch (err) {
    driveTimeFailed = true;
    driveTimeError = err instanceof Error ? err.message : String(err);
    console.warn("[propose-week] Drive time fetch failed, proceeding without:", err);
    for (const p of schedulerProviders) {
      driveMinutes[p.id] = {}; distanceMeters[p.id] = {};
      for (const c of schedulerClients) { driveMinutes[p.id][c.id] = 0; distanceMeters[p.id][c.id] = 0; }
    }
    for (const from of schedulerClients) {
      driveMinutes[from.id] = driveMinutes[from.id] ?? {}; distanceMeters[from.id] = distanceMeters[from.id] ?? {};
      for (const to of schedulerClients) { driveMinutes[from.id][to.id] = 0; distanceMeters[from.id][to.id] = 0; }
    }
  }

  // ── Delete proposals + drive time sessions from notBefore forward ────────────
  // Preserves past days and today's already-scheduled sessions before the current
  // time. Only proposals/drive-time sessions at or after notBefore are cleared so
  // the optimizer can rebuild them fresh.
  await prisma.proposedSession.deleteMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { gte: notBefore, lt: weekEnd },
      OR: [
        { clientId: { in: clientIds } },
        { providerId: { in: providerIds } },
      ],
    },
  });
  if (driveTimeSessionType) {
    await prisma.session.deleteMany({
      where: {
        sessionTypeId: driveTimeSessionType.id,
        providerId: { in: providerIds },
        status: "SCHEDULED",
        startTime: { gte: notBefore, lt: weekEnd },
      },
    });
  }

  // ── Collect today's pre-cutoff home sessions for drive-time continuity ───────
  // If a provider already has a home session this morning (before notBefore), pair
  // it with any new afternoon home proposals so a drive-time block is created between them.
  const todayUtcNoon = new Date(`${todayDateStr}T12:00:00Z`);
  const todayTzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(todayUtcNoon);
  const tdh = parseInt(todayTzParts.find((p) => p.type === "hour")!.value);
  const tdm = parseInt(todayTzParts.find((p) => p.type === "minute")!.value);
  const tds = parseInt(todayTzParts.find((p) => p.type === "second")!.value);
  const todayOffsetMs = (tdh === 24 ? 0 : tdh) * 3_600_000 + tdm * 60_000 + tds * 1_000;
  const todayDayStart = new Date(todayUtcNoon.getTime() - todayOffsetMs);

  const existingHomeSessions = bookedSessions
    .filter(
      (s) =>
        s.clientId &&
        s.locationType === "HOME" &&
        s.startTime >= todayDayStart &&
        s.startTime < notBefore // only sessions already locked in before the cutoff
    )
    .map((s) => ({
      providerId: s.providerId,
      clientId: s.clientId!,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

  // ── Run the scheduler ────────────────────────────────────────────────────────
  const result = await runScheduler({
    weekOf,
    targetDate: todayDateStr, // first schedulable day — optimizer skips days before this
    timezone,
    centerId: center.id,
    schoolOriginId,
    clients: schedulerClients,
    providers: schedulerProviders,
    sessionTypeIds: { CENTER: defaultSessionType.id, HOME: homeSessionTypeId, SCHOOL: defaultSessionType.id },
    driveTimeSessionTypeId: driveTimeSessionType?.id ?? null,
    driveMinutes,
    distanceMeters,
    existingHomeSessions,
    notBefore, // skip proposals whose startTime is before the current moment
    weekMode: true,
  });

  const allWarnings = [...result.warnings];
  if (driveTimeFailed) {
    allWarnings.push(`Drive time unavailable — Maps API error: ${driveTimeError || "unknown error"}. Sessions scheduled with minimum gap only.`);
  }

  const providerAddressMapForWarn = new Map(rawProviders.map((p) => [
    p.id,
    [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") || null,
  ]));
  const noAddressProviders = schedulerProviders.filter((p) => !providerAddressMapForWarn.get(p.id));
  if (!driveTimeFailed && noAddressProviders.length > 0) {
    allWarnings.push(
      `No address on file for ${noAddressProviders.length} provider(s): ${noAddressProviders.map((p) => `${p.lastName}, ${p.firstName}`).join("; ")}. Drive time was not factored into their assignments.`
    );
  }

  return NextResponse.json({
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
      })),
    },
  });
}
