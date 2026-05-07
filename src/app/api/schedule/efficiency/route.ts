// GET /api/schedule/efficiency?date=ISO&centerId=ID
//
// Returns schedule efficiency for a single calendar day:
//   rbtAvailableHours  — sum of all active RBT provider availability hours for this day of week
//   scheduledHours     — billable hours scheduled or proposed on this specific day
//   efficiencyPct      — scheduledHours / rbtAvailableHours × 100
//   scheduledClients   — distinct clients with at least one billable session/proposal today

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { DayOfWeek } from "@prisma/client";

export async function GET(request: NextRequest) {
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

  const { searchParams } = request.nextUrl;
  const dateStr = searchParams.get("date");
  const centerId = searchParams.get("centerId");

  if (!dateStr || !centerId) {
    return NextResponse.json({ error: "date and centerId are required" }, { status: 400 });
  }

  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const center = await prisma.center.findUnique({ where: { id: centerId } });
  if (!center) return NextResponse.json({ error: "Center not found" }, { status: 404 });

  const timezone = center.timezone;

  // ── Day boundaries in center's timezone ────────────────────────────────────
  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(dateObj);

  const noonUTC = new Date(`${localDateStr}T12:00:00Z`);
  const noonParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(noonUTC);
  const nh = parseInt(noonParts.find(p => p.type === "hour")?.value ?? "12");
  const nm = parseInt(noonParts.find(p => p.type === "minute")?.value ?? "0");
  const offsetMs = (nh === 24 ? 0 : nh) * 3_600_000 + nm * 60_000;
  const dayStart = new Date(noonUTC.getTime() - offsetMs);
  const dayEnd   = new Date(dayStart.getTime() + 24 * 3_600_000);

  // Day of week for availability lookup
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "long",
  }).format(dayStart).toUpperCase() as DayOfWeek;

  // ── RBT available hours (denominator) ──────────────────────────────────────
  // Sum availability windows for active RBT providers who are actually working today.
  // Providers with no sessions/proposals today are excluded — their idle time should
  // not inflate the denominator and make working providers look under-utilized.
  // Drive time is also subtracted: providers aren't paid for it, so it reduces the
  // true billable ceiling.
  const rbtProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId }, { centerId: null }], status: "ACTIVE", position: "RBT" },
    select: {
      id: true,
      availability: {
        where: { dayOfWeek },
        select: { startTime: true, endTime: true },
      },
    },
  });
  const rbtProviderIds = rbtProviders.map((p) => p.id);

  // ── Scheduled billable hours (numerator) ───────────────────────────────────
  // Confirmed sessions + pending proposals so auto-complete results are reflected
  // immediately, before the user approves each proposal.
  const [scheduledSessions, pendingProposals, driveTimeSessions] = await Promise.all([
    prisma.session.findMany({
      where: {
        OR: [{ client: { centerId } }, { client: { centerId: null } }],
        billable: true,
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        startTime: { gte: dayStart, lt: dayEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [{ client: { centerId } }, { client: { centerId: null } }],
        status: "PENDING",
        startTime: { gte: dayStart, lt: dayEnd },
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true },
    }),
    // Drive Time sessions for RBT providers today — non-billable, reduces true capacity
    prisma.session.findMany({
      where: {
        providerId: { in: rbtProviderIds },
        billable: false,
        sessionType: { name: "Drive Time" },
        startTime: { gte: dayStart, lt: dayEnd },
      },
      select: { providerId: true, startTime: true, endTime: true },
    }),
  ]);

  // Providers working today = those with at least one session or proposal
  const workingRbtIds = new Set<string>(
    [...scheduledSessions, ...pendingProposals]
      .map((s) => s.providerId)
      .filter((id) => rbtProviderIds.includes(id))
  );

  // Sum available hours for working RBTs only, then subtract their drive time
  let rbtAvailableHours = 0;
  for (const p of rbtProviders) {
    if (!workingRbtIds.has(p.id)) continue;
    for (const a of p.availability) {
      const [sh, sm] = a.startTime.split(":").map(Number);
      const [eh, em] = a.endTime.split(":").map(Number);
      rbtAvailableHours += (eh * 60 + em - sh * 60 - sm) / 60;
    }
  }
  for (const dt of driveTimeSessions) {
    rbtAvailableHours -= (dt.endTime.getTime() - dt.startTime.getTime()) / 3_600_000;
  }
  rbtAvailableHours = Math.max(0, rbtAvailableHours);

  let scheduledHours = 0;
  const scheduledClientIds = new Set<string>();

  for (const s of [...scheduledSessions, ...pendingProposals]) {
    scheduledHours += (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    if (s.clientId) scheduledClientIds.add(s.clientId);
  }

  const efficiencyPct =
    rbtAvailableHours > 0
      ? Math.min(100, Math.round((scheduledHours / rbtAvailableHours) * 1000) / 10)
      : 0;

  return NextResponse.json({
    rbtAvailableHours: Math.round(rbtAvailableHours * 10) / 10,
    scheduledHours:    Math.round(scheduledHours * 10) / 10,
    efficiencyPct,
    scheduledClients:  scheduledClientIds.size,
    totalRbtProviders: rbtProviders.length,
  });
}
