// POST /api/scheduler/propose
// Assembles scheduler input from the database and triggers the AI scheduling engine.
// Returns a summary of proposals created.
//
// Request body: { weekOf: string (ISO date, Monday of target week), centerId: string }

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

export async function POST(request: NextRequest) {
  // Auth check — must be logged in
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
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { date: string; centerId: string; notBefore?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { date: dateStr, centerId, notBefore: notBeforeStr } = body;
  const notBefore = notBeforeStr ? new Date(notBeforeStr) : undefined;
  if (!dateStr || !centerId) {
    return NextResponse.json(
      { error: "date and centerId are required" },
      { status: 400 }
    );
  }

  // Extract YYYY-MM-DD then anchor at UTC noon so formatting in any center timezone
  // lands on the correct calendar date. Handles both plain date strings and full ISO
  // timestamps (e.g. "2026-03-25T07:00:00.000Z") from older callers.
  const targetDateObj = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  if (isNaN(targetDateObj.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // Load center (for timezone + default session hours)
  const center = await prisma.center.findUnique({
    where: { id: centerId },
  });
  if (!center) {
    return NextResponse.json({ error: "Center not found" }, { status: 404 });
  }

  const timezone = center.timezone;
  const { weekStart, weekEnd } = getWeekBoundaries(targetDateObj, timezone);

  // Derive Monday (weekOf) from weekStart (Sunday midnight local) + 1 day.
  // Used as the week anchor for proposal storage and the scheduler input.
  const weekOf = new Date(weekStart.getTime() + 24 * 3_600_000);

  // Compute the "YYYY-MM-DD" string for the target date in the center's timezone
  const targetDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(targetDateObj);

  // Load both Direct Therapy session types — CENTER and HOME variants — plus Drive Time.
  // Falls back to any billable type for CENTER if the named type is missing (shouldn't happen post-seed).
  const [centerSessionType, homeSessionType, driveTimeSessionType] = await Promise.all([
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } }),
    prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } }),
    prisma.sessionType.findFirst({ where: { name: "Drive Time" } }),
  ]);
  const defaultSessionType = centerSessionType ??
    await prisma.sessionType.findFirst({ where: { billable: true }, orderBy: { createdAt: "asc" } });
  if (!defaultSessionType) {
    return NextResponse.json(
      { error: "No billable session type found. Create one first." },
      { status: 422 }
    );
  }
  // If "Direct Therapy Home" doesn't exist yet, fall back to the CENTER type for both
  const homeSessionTypeId = homeSessionType?.id ?? defaultSessionType.id;

  // Load active clients for this center with availability and authorizations.
  // Include clients with centerId = null (created before center assignment was enforced).
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

  // Load authorization usage for this week — single batch query across all clients.
  // Condition: auth is active at any point during the week (starts before week ends,
  // ends after week starts). This correctly handles auths expiring mid-week.
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

  // For each client, pick the most recently started active auth
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

  // Average CLIENT-cancelled hours per week per client — used to compute the
  // over-scheduling buffer so net-delivered hours hit the authorization target.
  const avgCancellationMap = await getClientAvgWeeklyCancellationHours(
    rawClients.map((c) => ({ id: c.id, activeDate: c.activeDate }))
  );

  // Load prior 12 weeks of sessions to build provider-client history for consistency preference.
  // 12-week window captures longer clinical relationships (ABA therapy runs months to years).
  // Sessions are ordered newest-first so we can record the most recent provider per client.
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

  // Build per-client ordered list of provider IDs (most recent first, deduplicated)
  const historicalProvidersByClient: Record<string, string[]> = {};
  const priorWeekClientIds = new Set<string>();
  const oneWeekAgo = new Date(weekStart.getTime() - 7 * 24 * 3_600_000);
  for (const s of priorSessions) {
    if (!s.clientId || !s.providerId) continue;
    if (!historicalProvidersByClient[s.clientId]) historicalProvidersByClient[s.clientId] = [];
    if (!historicalProvidersByClient[s.clientId].includes(s.providerId)) {
      historicalProvidersByClient[s.clientId].push(s.providerId);
    }
    if (s.startTime >= oneWeekAgo) priorWeekClientIds.add(s.clientId);
  }

  // Load active providers for this center with availability and booked windows for the week.
  // Include providers with centerId = null (created before center assignment was enforced).
  const rawProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId }, { centerId: null }], status: "ACTIVE" },
    include: {
      availability: true,
    },
  });

  // Load provider and client one-off blocks that fall within the target week
  const providerIds = rawProviders.map((p) => p.id);
  const [providerBlocks, clientBlocksRaw] = await Promise.all([
    prisma.providerBlock.findMany({
      where: {
        providerId: { in: providerIds },
        date: { gte: weekStart, lte: weekEnd },
      },
      select: { providerId: true, date: true, startTime: true, endTime: true },
    }),
    prisma.clientBlock.findMany({
      where: {
        clientId: { in: clientIds },
        date: { gte: weekStart, lte: weekEnd },
      },
      select: { clientId: true, date: true, startTime: true, endTime: true },
    }),
  ]);

  // Group blocks by provider, converting the date to "YYYY-MM-DD" in the center timezone
  const blocksByProvider: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const block of providerBlocks) {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(block.date);

    if (!blocksByProvider[block.providerId]) blocksByProvider[block.providerId] = [];
    blocksByProvider[block.providerId].push({
      date: dateStr,
      startTime: block.startTime,
      endTime: block.endTime,
    });
  }
  const blocksByClient: Record<string, Array<{ date: string; startTime: string; endTime: string }>> = {};
  for (const block of clientBlocksRaw) {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(block.date);

    if (!blocksByClient[block.clientId]) blocksByClient[block.clientId] = [];
    blocksByClient[block.clientId].push({
      date: dateStr,
      startTime: block.startTime,
      endTime: block.endTime,
    });
  }

  // Get already-booked sessions AND approved proposals for each provider/client this week.
  // APPROVED proposals are user-confirmed locked slots — per ScheduleGod Hard Rule #1
  // they must be treated identically to SCHEDULED sessions so the optimizer avoids
  // proposing conflicting slots rather than failing at save time.
  const [bookedSessions, approvedProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        // Three cases that count as "occupying" a time slot:
        //   SCHEDULED/IN_PROGRESS: blocks both provider and client.
        //   CANCELLED-by-PROVIDER: provider called out sick — blocks their time only.
        //   CANCELLED-by-CLIENT:   client said they're not coming — blocks their time only.
        // The loop below routes each case to only the appropriate party.
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
        OR: [
          { clientId: { in: clientIds } },
          { providerId: { in: providerIds } },
        ],
        status: "APPROVED",
        startTime: { gte: weekStart },
        endTime: { lte: weekEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true, locationType: true },
    }),
  ]);

  // Helper: convert a UTC DateTime to local DayOfWeek + HH:MM strings
  function toLocalWindow(utcDate: Date): { dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string } {
    const localDay = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
    }).format(utcDate).toUpperCase() as import("@prisma/client").DayOfWeek;

    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(utcDate);

    return { dayOfWeek: localDay, startTime: localTime };
  }

  // Compute UTC boundaries for the target day early — needed below to skip target-day
  // APPROVED proposals that will be deleted before the optimizer runs.
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

  // Map booked sessions to day/time windows per provider and per client
  const bookedByProvider: Record<
    string,
    Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string; endTime: string; clientId?: string; locationType?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL" }>
  > = {};
  const bookedByClient: Record<
    string,
    Array<{ dayOfWeek: import("@prisma/client").DayOfWeek; startTime: string; endTime: string }>
  > = {};

  for (const session of [...bookedSessions, ...approvedProposals]) {
    // Skip Drive Time sessions — they're deleted before the scheduler runs but loaded
    // before the delete, so stale ones from prior runs would falsely block provider slots.
    if (driveTimeSessionType && 'sessionTypeId' in session && session.sessionTypeId === driveTimeSessionType.id) continue;

    // Skip APPROVED proposals on the target day — they're about to be deleted and replaced.
    // Including them would block their clients/providers and prevent the optimizer from
    // finding better combinations (e.g. a freed RBT replacing a BCBA after a cancellation).
    if (!('cancelledBy' in session) &&
        session.startTime >= targetDayStart && session.startTime < targetDayEnd) continue;

    const { dayOfWeek, startTime: localStart } = toLocalWindow(session.startTime);
    const { startTime: localEnd } = toLocalWindow(session.endTime);

    // Determine cancellation direction (only present on bookedSessions, not approvedProposals)
    const cancelledBy = 'cancelledBy' in session ? session.cancelledBy : null;
    const isCancelledByProvider = cancelledBy === "PROVIDER";
    const isCancelledByClient   = cancelledBy === "CLIENT";

    // Block provider time unless the CLIENT cancelled (client-cancelled sessions free the provider)
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

    // Block client time unless the PROVIDER cancelled (provider-cancelled sessions free the client)
    if (session.clientId && !isCancelledByProvider) {
      if (!bookedByClient[session.clientId]) bookedByClient[session.clientId] = [];
      bookedByClient[session.clientId].push({ dayOfWeek, startTime: localStart, endTime: localEnd });
    }
  }

  // Sum up billable hours already in the DB per provider this week (non-cancelled sessions).
  // Passed into the optimizer so it can prefer underutilized providers across the full week —
  // not just within the current run. Prevents Devon accumulating Mon-Thu while Maria sits empty.
  const providerWeeklyHoursMap: Record<string, number> = {};
  for (const s of bookedSessions) {
    if (s.status === "CANCELLED") continue;
    const hrs = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    providerWeeklyHoursMap[s.providerId] = (providerWeeklyHoursMap[s.providerId] ?? 0) + hrs;
  }

  // Add hours from PENDING/APPROVED proposals on other days of this week to usedHoursMap.
  // Auto Complete deletes proposals for the target day only, so proposals on Mon/Tue/Thu/Fri
  // are invisible to getWeeklyHoursMap (which reads the Session table, not ProposedSession).
  // Without this, each day's run sees 0 used hours and proposes a full day's worth, causing
  // total weekly proposals to exceed the client's authorized limit.
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

  // Day-of-week order used to count how many of a client's availability days
  // remain in the current week (including today). Used in the sessionHours formula below.
  const DAY_ORDER: Record<string, number> = {
    MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
  };
  const targetDayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(targetDateObj).toUpperCase();
  const targetDayOrder = DAY_ORDER[targetDayStr] ?? 1;

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

  // Build schedulerClients now that bookedByClient is available
  const maskClientName = await getClientNameMasker();
  const schedulerClients: SchedulerClient[] = rawClients.map((c) => {
    const authInfo = clientAuthMap[c.id];
    const weeklyHours = authInfo?.weeklyHours ?? null;
    const targetHours = weeklyHours !== null
      ? effectiveTargetHours(weeklyHours, c.activeDate, avgCancellationMap[c.id] ?? 0)
      : null;
    return {
      id: c.id,
      firstName: maskClientName(c.firstName),
      lastName: maskClientName(c.lastName),
      latitude: c.latitude,
      longitude: c.longitude,
      daysNeeded: 1, // day-by-day mode always schedules one session per run
      sessionHours: (() => {
        // Fill-the-day strategy: use as many remaining authorized hours as possible today,
        // up to the daily maximum. This front-loads hours rather than distributing them
        // evenly across the week, which keeps provider utilization high and leaves fewer
        // hours stranded at week-end. The slot generator caps actual session length at the
        // provider's available window, so this never over-schedules.
        // Clients below 1.5h remaining are skipped by checkRemainingHours.
        const used = authInfo ? (usedHoursMap[authInfo.authId] ?? 0) : 0;
        const remaining = targetHours !== null ? targetHours - used : null;

        const DAILY_MAX_HOURS = 8.0;
        const authPerDay =
          remaining !== null
            ? Math.min(remaining, DAILY_MAX_HOURS)
            : (c.defaultSessionHours ?? center.defaultSessionHours);

        const snapped = Math.floor(Math.max(authPerDay, 0) * 2) / 2; // snap down to nearest 0.5h
        // If the per-day target would be below the minimum billable session length (1.5h) but
        // there are still enough remaining hours for at least one session, bump up to 1.5h so
        // the slot generator can actually find valid slots. Without this, clients with small
        // per-day targets (e.g. 7h/week ÷ 5 days = 1.4h → snaps to 1h) pass checkRemainingHours
        // but produce zero slots since all effectiveDurations fail the MIN_FLEX_SESSION_MINS check.
        const MIN_BILLABLE_HOURS = 1.5;
        return snapped < MIN_BILLABLE_HOURS && (remaining ?? 0) >= MIN_BILLABLE_HOURS
          ? MIN_BILLABLE_HOURS
          : snapped;
      })(),
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
      historicalProviderIds: historicalProvidersByClient[c.id] ?? [],
      hasPriorWeekHistory: priorWeekClientIds.has(c.id),
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

  // Build drive time map — a SINGLE API call covering provider→client AND client→client.
  // driveMinutes[providerId][clientId] = provider home → client home (assignment ranking)
  // driveMinutes[clientId][clientId]   = client home → client home (consecutive-session gap)
  // Using one call avoids the rate-limit failures that occurred with two parallel calls.
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
    const clientAddrs = schedulerClients.map((c) => clientAddressMap.get(c.id) ?? null);
    console.log("[scheduler:maps] client addresses:", schedulerClients.map((c, i) => `${c.firstName} ${c.lastName} → ${clientAddrs[i]}`));

    // Include center as an extra "origin" in the drive time matrix so we get
    // real center→client distances for CENTER→HOME and HOME→CENTER transitions
    // instead of using provider home as a proxy.
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
      clientAddrs
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
    // Log the client→client drive time matrix for debugging
    console.log("[scheduler:maps] client→client drive times (min):");
    for (const from of schedulerClients) {
      for (const to of schedulerClients) {
        if (from.id !== to.id) {
          console.log(`  ${from.firstName} ${from.lastName} → ${to.firstName} ${to.lastName}: ${driveMinutes[from.id]?.[to.id] ?? "?"} min, ${distanceMeters[from.id]?.[to.id] ?? "?"}m`);
        }
      }
    }
  } catch (err) {
    driveTimeFailed = true;
    driveTimeError = err instanceof Error ? err.message : String(err);
    console.warn("[scheduler] Drive time fetch failed, proceeding without:", err);
    for (const p of schedulerProviders) {
      driveMinutes[p.id] = {}; distanceMeters[p.id] = {};
      for (const c of schedulerClients) { driveMinutes[p.id][c.id] = 0; distanceMeters[p.id][c.id] = 0; }
    }
    for (const from of schedulerClients) {
      driveMinutes[from.id] = driveMinutes[from.id] ?? {}; distanceMeters[from.id] = distanceMeters[from.id] ?? {};
      for (const to of schedulerClients) { driveMinutes[from.id][to.id] = 0; distanceMeters[from.id][to.id] = 0; }
    }
  }

  // Snapshot the roster (clientIds with proposals on this day) BEFORE deletion.
  // These clients had a confirmed slot — if the optimizer can't reschedule them after
  // re-running, they're flagged as "unserved" (distinct from ordinary unscheduled clients).
  // CLIENT-cancelled clients are excluded: they chose not to come, so missing them is expected.
  const sameDayProposals = await prisma.proposedSession.findMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { gte: targetDayStart, lt: targetDayEnd },
      OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
    },
    select: { clientId: true },
  });

  const clientCancelledOnTargetDay = new Set(
    bookedSessions
      .filter(
        (s) =>
          s.cancelledBy === "CLIENT" &&
          s.clientId &&
          s.startTime >= targetDayStart &&
          s.startTime < targetDayEnd
      )
      .map((s) => s.clientId!)
  );

  const lockedClientIds = [
    ...new Set(
      sameDayProposals
        .map((p) => p.clientId)
        .filter((id): id is string => !!id && !clientCancelledOnTargetDay.has(id))
    ),
  ];

  // Clear PENDING and APPROVED proposals for this specific day before re-running.
  // Auto Complete always produces a fully optimized schedule for the target day —
  // APPROVED proposals from prior runs are re-evaluated so that newly freed providers
  // (e.g. an RBT freed by a client cancellation) can be assigned to clients who were
  // previously paired with a less-preferred provider (e.g. a BCBA).
  // Scope to our active clients OR providers to avoid touching unrelated proposals.
  await prisma.proposedSession.deleteMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startTime: { gte: targetDayStart, lt: targetDayEnd },
      OR: [
        { clientId: { in: clientIds } },
        { providerId: { in: providerIds } },
      ],
    },
  });

  // Delete stale Drive Time sessions for the target day so Auto Complete always
  // rebuilds them fresh. Without this, old drive time sessions from a prior run
  // survive and may reflect outdated drive data or wrong pairings.
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

  // Collect existing HOME sessions on the target day from prior runs.
  // These are paired with new HOME proposals in runScheduler so that drive time
  // blocks are created between ALL consecutive home visits, not just pairs that
  // happen to land in the same run.
  // Only include actual booked sessions (SCHEDULED/IN_PROGRESS) — approved proposals
  // are excluded because they were just deleted above and will be replaced by this run.
  // Filter by locationType (not sessionTypeId) — old sessions created before
  // "Direct Therapy Home" was set up may have the CENTER session type ID but
  // locationType = HOME, so sessionTypeId matching would silently exclude them.
  const existingHomeSessions = [...bookedSessions]
    .filter(
      (s) =>
        s.clientId &&
        s.locationType === "HOME" &&
        s.startTime >= targetDayStart &&
        s.startTime < targetDayEnd
    )
    .map((s) => ({
      providerId: s.providerId,
      clientId: s.clientId!,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

  // Build cancellation context for the target day.
  // displacedClientIds: clients whose provider cancelled (they need a new session)
  // freedProviderIds:   providers whose client cancelled (their slot is open)
  // Rule: displaced clients can ONLY be matched with freed providers (and vice versa).
  // If only one side is present (single cancellation), no new proposals are created.
  const displacedClientIds = bookedSessions
    .filter(
      (s) =>
        s.cancelledBy === "PROVIDER" &&
        s.clientId &&
        s.startTime >= targetDayStart &&
        s.startTime < targetDayEnd
    )
    .map((s) => s.clientId!);

  const freedProviderIds = bookedSessions
    .filter(
      (s) =>
        s.cancelledBy === "CLIENT" &&
        s.startTime >= targetDayStart &&
        s.startTime < targetDayEnd
    )
    .map((s) => s.providerId);

  const cancellationContext =
    displacedClientIds.length > 0 || freedProviderIds.length > 0
      ? { displacedClientIds, freedProviderIds }
      : undefined;

  // Run the scheduler — restricted to the target date only
  const result = await runScheduler({
    weekOf,
    targetDate,
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
    notBefore,
    lockedClientIds,
    cancellationContext,
  });

  const allWarnings = [...result.warnings];
  if (driveTimeFailed) {
    allWarnings.push(`Drive time unavailable — Maps API error: ${driveTimeError || "unknown error"}. Sessions scheduled with minimum gap only.`);
  }

  // Warn for any provider without a geocodable address — they were assigned driveMinutes = 0
  // to all clients, meaning distance was not a real factor in their ranking.
  const providerAddressMapForWarn = new Map(rawProviders.map((p) => [
    p.id,
    [p.street, p.city, p.state, p.zip].filter(Boolean).join(", ") || null,
  ]));
  const noAddressProviders = schedulerProviders.filter(
    (p) => !providerAddressMapForWarn.get(p.id)
  );
  if (!driveTimeFailed && noAddressProviders.length > 0) {
    allWarnings.push(
      `No address on file for ${noAddressProviders.length} provider(s): ${noAddressProviders.map((p) => `${p.lastName}, ${p.firstName}`).join("; ")}. Drive time was not factored into their assignments.`
    );
  }

  return NextResponse.json({
    ...result,
    warnings: allWarnings,
    unservedRosterClients: result.unservedRosterClients ?? [],
    // Debug counts — visible in browser DevTools network tab
    _debug: {
      clientsLoaded: schedulerClients.length,
      providersLoaded: schedulerProviders.length,
      targetDate,
      sessionTypeCenter: defaultSessionType.name,
      sessionTypeHome: homeSessionType?.name ?? "(fallback to center type)",
      driveTimeSessionType: driveTimeSessionType?.name ?? "(not found — Drive Time sessions will not be created)",
      driveTimeFailed,
      driveTimeError,
      // Sample of client→client drive minutes to verify API is returning data
      clientToClientSample: schedulerClients.slice(0, 3).map(a => ({
        from: `${a.lastName}, ${a.firstName}`,
        to: schedulerClients.filter(b => b.id !== a.id).slice(0, 2).map(b => ({
          name: `${b.lastName}, ${b.firstName}`,
          mins: driveMinutes[a.id]?.[b.id] ?? "n/a",
        })),
      })),
      // Booked windows going into the optimizer — helps diagnose why clients/providers are blocked
      clientBookedWindows: schedulerClients.map(c => ({
        id: c.id,
        name: `${c.lastName}, ${c.firstName}`,
        bookedWindows: c.bookedWindows,
      })),
      providerBookedWindows: schedulerProviders.map(p => ({
        id: p.id,
        name: `${p.lastName}, ${p.firstName}`,
        bookedWindows: p.bookedWindows,
      })),
    },
  });
}
