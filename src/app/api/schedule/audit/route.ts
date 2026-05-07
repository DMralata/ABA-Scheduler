// GET /api/schedule/audit?date=ISO&centerId=ID
//
// Runs the AUDIT_GOD four-pass schedule audit for the calendar week
// containing `date`. Returns compliance violations, per-RBT utilization,
// client coverage, and a composite schedule quality score.
//
// Pass 1 — Compliance:    double-bookings, auth hours exceeded
// Pass 2 — Utilization:   per-RBT available vs scheduled hours
// Pass 3 — Coverage:      per-client authorized vs scheduled hours
// Pass 4 — Score:         weighted composite (0–100)

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getWeekBoundaries } from "@/lib/utils";
import type { DayOfWeek } from "@prisma/client";

const WEEKDAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function sessionHours(startTime: Date, endTime: Date): number {
  return (endTime.getTime() - startTime.getTime()) / 3_600_000;
}

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
  const { weekStart, weekEnd } = getWeekBoundaries(dateObj, timezone);

  // ── Load all data in parallel ──────────────────────────────────────────────
  const [centerProviders, centerClients] = await Promise.all([
    prisma.provider.findMany({
      where: { OR: [{ centerId }, { centerId: null }], status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        availability: {
          where: { dayOfWeek: { in: WEEKDAYS } },
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
      },
    }),
    prisma.client.findMany({
      where: {
        AND: [
          { OR: [{ centerId }, { centerId: null }] },
          { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        authorizations: {
          where: {
            startDate: { lte: weekEnd },
            endDate: { gte: weekStart },
          },
          orderBy: { startDate: "desc" },
          take: 1,
          select: { id: true, approvedHoursPerWeek: true, endDate: true },
        },
      },
    }),
  ]);

  const providerIds = centerProviders.map((p) => p.id);
  const clientIds = centerClients.map((c) => c.id);

  const [weekSessions, weekProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        providerId: { in: providerIds },
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: {
        id: true,
        providerId: true,
        clientId: true,
        authorizationId: true,
        startTime: true,
        endTime: true,
        billable: true,
        locationType: true,
        notes: true,
        provider: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
        sessionType: { select: { name: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [
          { clientId: { in: clientIds } },
          { providerId: { in: providerIds } },
        ],
        status: "PENDING",
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: {
        clientId: true,
        providerId: true,
        authorizationId: true,
        startTime: true,
        endTime: true,
      },
    }),
  ]);

  // ── PASS 1: COMPLIANCE ─────────────────────────────────────────────────────
  type Violation = {
    clientName: string;
    providerName: string;
    rule: string;
    detail: string;
    severity: "CRITICAL" | "HIGH";
  };
  const violations: Violation[] = [];

  // Separate Drive Time sessions up front so compliance/utilization checks ignore them.
  // (Drive Time sessions have no clientId and are non-billable — they'd skew both checks.)
  // Note: driveTimeSessions and therapySessions are defined later after the weekSessions
  // query; here we do a quick inline split for the compliance pass.
  const driveTimeSessions_p1 = weekSessions.filter((s) => s.sessionType?.name === "Drive Time");
  const therapySessions_p1 = weekSessions.filter((s) => s.sessionType?.name !== "Drive Time");

  // Provider double-booking (therapy sessions only)
  const sessionsByProvider = new Map<string, typeof therapySessions_p1>();
  for (const s of therapySessions_p1) {
    if (!sessionsByProvider.has(s.providerId)) sessionsByProvider.set(s.providerId, []);
    sessionsByProvider.get(s.providerId)!.push(s);
  }
  for (const [, sessions] of sessionsByProvider) {
    const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endTime > sorted[i + 1].startTime) {
        const p = sorted[i].provider;
        const c1 = sorted[i].client;
        const c2 = sorted[i + 1].client;
        violations.push({
          clientName: c1 ? `${c1.lastName}, ${c1.firstName}` : "Unknown",
          providerName: `${p.lastName}, ${p.firstName}`,
          rule: "No provider double-booking",
          detail: `${p.lastName}, ${p.firstName} has overlapping sessions (${c1?.lastName ?? "?"} and ${c2?.lastName ?? "?"})`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // Client double-booking (therapy sessions only)
  const sessionsByClient = new Map<string, typeof therapySessions_p1>();
  for (const s of therapySessions_p1) {
    if (!s.clientId) continue;
    if (!sessionsByClient.has(s.clientId)) sessionsByClient.set(s.clientId, []);
    sessionsByClient.get(s.clientId)!.push(s);
  }
  for (const [, sessions] of sessionsByClient) {
    const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endTime > sorted[i + 1].startTime) {
        const c = sorted[i].client;
        violations.push({
          clientName: c ? `${c.lastName}, ${c.firstName}` : "Unknown",
          providerName: sorted[i].provider.lastName,
          rule: "No client double-booking",
          detail: `${c?.lastName ?? "?"}, ${c?.firstName ?? "?"} has overlapping sessions`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // Authorization hours exceeded (therapy sessions only)
  const hoursByAuth = new Map<string, number>();
  for (const s of therapySessions_p1) {
    if (!s.authorizationId || !s.billable) continue;
    hoursByAuth.set(s.authorizationId, (hoursByAuth.get(s.authorizationId) ?? 0) + sessionHours(s.startTime, s.endTime));
  }
  const authIds = [...hoursByAuth.keys()];
  if (authIds.length > 0) {
    const auths = await prisma.authorization.findMany({
      where: { id: { in: authIds } },
      select: { id: true, approvedHoursPerWeek: true, clientId: true },
    });
    for (const auth of auths) {
      const used = hoursByAuth.get(auth.id) ?? 0;
      if (used > auth.approvedHoursPerWeek + 0.05) {
        const c = centerClients.find((cl) => cl.id === auth.clientId);
        violations.push({
          clientName: c ? `${c.lastName}, ${c.firstName}` : "Unknown",
          providerName: "",
          rule: "Weekly authorized hours not exceeded",
          detail: `${c ? `${c.lastName}, ${c.firstName}` : "Unknown"}: ${used.toFixed(1)}h scheduled vs ${auth.approvedHoursPerWeek}h authorized`,
          severity: "HIGH",
        });
      }
    }
  }

  // ── PASS 1 (continued): TRAVEL COMPLIANCE ─────────────────────────────────
  // AUDIT_GOD rule: for every provider with consecutive HOME sessions at different
  // client addresses, drive time must not exceed the gap between them.
  // We detect compliance by checking whether a Drive Time session exists in the gap,
  // and whether its duration covers the scheduled travel time.

  // Reuse the split computed in the compliance pass header above
  const driveTimeSessions = driveTimeSessions_p1;
  const therapySessions = therapySessions_p1;

  // Group therapy HOME sessions by provider
  const homeSessionsByProvider = new Map<string, typeof therapySessions>();
  for (const s of therapySessions) {
    if (s.locationType !== "HOME" || !s.clientId) continue;
    if (!homeSessionsByProvider.has(s.providerId)) homeSessionsByProvider.set(s.providerId, []);
    homeSessionsByProvider.get(s.providerId)!.push(s);
  }

  let homePairsTotal = 0;
  let homePairsCovered = 0;
  for (const [, sessions] of homeSessionsByProvider) {
    const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      // Only check consecutive pairs with a real gap
      if (a.endTime >= b.startTime) continue;
      // Skip pairs that span calendar days — no drive time is needed overnight
      const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
      if (fmtDay(a.startTime) !== fmtDay(b.startTime)) continue;
      homePairsTotal++;

      // Find a Drive Time session for this provider that starts within 60 seconds of a.endTime.
      // Exact-ms matching is fragile if the scheduler writes the drive block with slight drift.
      const aEndMs = a.endTime.getTime();
      const dtSession = driveTimeSessions.find(
        d => d.providerId === a.providerId && Math.abs(d.startTime.getTime() - aEndMs) <= 60_000
      );
      if (!dtSession) {
        // No Drive Time session means the scheduler had no coordinates/Maps data for this
        // pair and skipped creating one (apiMins === 0). No data → no violation.
        // Count the pair as covered so it doesn't penalize the travel score.
        homePairsCovered++;
      } else {
        homePairsCovered++;
        // Check if the gap actually fits the drive time session
        const gapMins = (b.startTime.getTime() - a.endTime.getTime()) / 60_000;
        if (dtSession.notes) {
          try {
            const meta = JSON.parse(dtSession.notes) as { driveMinutes?: number };
            if (meta.driveMinutes && gapMins < meta.driveMinutes) {
              const p = a.provider;
              violations.push({
                clientName: a.client ? `${a.client.lastName}, ${a.client.firstName}` : "Unknown",
                providerName: `${p.lastName}, ${p.firstName}`,
                rule: "Sufficient gap required for drive time",
                detail: `${p.lastName}, ${p.firstName}: gap between sessions (${gapMins.toFixed(0)} min) is less than estimated drive time (${meta.driveMinutes} min)`,
                severity: "HIGH",
              });
            }
          } catch { /* notes not valid JSON — skip detailed check */ }
        }
      }
    }
  }

  // ── PASS 2: RBT UTILIZATION ────────────────────────────────────────────────

  // Drive time hours per provider — providers aren't paid for drive time, so it
  // reduces the billable ceiling for the day. Sum Drive Time session durations.
  const driveTimeHoursByProvider = new Map<string, number>();
  for (const s of driveTimeSessions) {
    driveTimeHoursByProvider.set(
      s.providerId,
      (driveTimeHoursByProvider.get(s.providerId) ?? 0) + sessionHours(s.startTime, s.endTime)
    );
  }

  // Working days per provider — only count availability on days the provider
  // is actually scheduled. A provider available Mon–Fri but only working Mon/Wed/Fri
  // should not have Tue/Thu availability inflate their denominator.
  function toLocalDay(date: Date): DayOfWeek {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" })
      .format(date).toUpperCase() as DayOfWeek;
  }
  const workingDaysByProvider = new Map<string, Set<DayOfWeek>>();
  for (const s of weekSessions) {
    if (!workingDaysByProvider.has(s.providerId)) workingDaysByProvider.set(s.providerId, new Set());
    workingDaysByProvider.get(s.providerId)!.add(toLocalDay(s.startTime));
  }
  for (const p of weekProposals) {
    if (!workingDaysByProvider.has(p.providerId)) workingDaysByProvider.set(p.providerId, new Set());
    workingDaysByProvider.get(p.providerId)!.add(toLocalDay(p.startTime));
  }

  const rbtProviders = centerProviders.filter((p) => p.position === "RBT");
  const rbtIdSet = new Set(rbtProviders.map((p) => p.id));

  const rbtHoursScheduled = new Map<string, number>();
  for (const s of therapySessions) {
    if (!rbtIdSet.has(s.providerId) || !s.billable) continue;
    rbtHoursScheduled.set(s.providerId, (rbtHoursScheduled.get(s.providerId) ?? 0) + sessionHours(s.startTime, s.endTime));
  }
  // Include pending proposals (shows auto-complete results before approval)
  for (const p of weekProposals) {
    if (!rbtIdSet.has(p.providerId)) continue;
    rbtHoursScheduled.set(p.providerId, (rbtHoursScheduled.get(p.providerId) ?? 0) + sessionHours(p.startTime, p.endTime));
  }

  const rbtReport = rbtProviders.map((p) => {
    // Available hours on working days only
    const workingDays = workingDaysByProvider.get(p.id) ?? new Set<DayOfWeek>();
    const workingDayAvailHours = p.availability
      .filter((a) => workingDays.has(a.dayOfWeek))
      .reduce((sum, a) => sum + (parseHHMM(a.endTime) - parseHHMM(a.startTime)) / 60, 0);
    // Subtract drive time — non-billable, unavoidable, reduces true billable ceiling
    const driveTimeHours = driveTimeHoursByProvider.get(p.id) ?? 0;
    const billableCapacity = Math.max(0, workingDayAvailHours - driveTimeHours);
    const scheduled = rbtHoursScheduled.get(p.id) ?? 0;
    const utilizationPct = billableCapacity > 0
      ? Math.round((scheduled / billableCapacity) * 1000) / 10
      : 0;
    return {
      name: `${p.lastName}, ${p.firstName}`,
      availableHours: Math.round(billableCapacity * 10) / 10,
      scheduledHours: Math.round(scheduled * 10) / 10,
      utilizationPct,
      gapHours: Math.round(Math.max(0, billableCapacity - scheduled) * 10) / 10,
    };
  }).sort((a, b) => a.utilizationPct - b.utilizationPct); // lowest utilization first

  // Build per-provider scheduled hours for ALL positions (display only — score uses RBT-only above).
  const allProviderHoursScheduled = new Map<string, number>();
  for (const s of therapySessions) {
    if (!s.billable) continue;
    allProviderHoursScheduled.set(s.providerId, (allProviderHoursScheduled.get(s.providerId) ?? 0) + sessionHours(s.startTime, s.endTime));
  }
  for (const p of weekProposals) {
    allProviderHoursScheduled.set(p.providerId, (allProviderHoursScheduled.get(p.providerId) ?? 0) + sessionHours(p.startTime, p.endTime));
  }

  const allProvidersReport = centerProviders.map((p) => {
    const workingDays = workingDaysByProvider.get(p.id) ?? new Set<DayOfWeek>();
    const workingDayAvailHours = p.availability
      .filter((a) => workingDays.has(a.dayOfWeek))
      .reduce((sum, a) => sum + (parseHHMM(a.endTime) - parseHHMM(a.startTime)) / 60, 0);
    const driveTimeHours = driveTimeHoursByProvider.get(p.id) ?? 0;
    const billableCapacity = Math.max(0, workingDayAvailHours - driveTimeHours);
    const scheduled = allProviderHoursScheduled.get(p.id) ?? 0;
    const utilizationPct = billableCapacity > 0
      ? Math.round((scheduled / billableCapacity) * 1000) / 10
      : 0;
    return {
      name: `${p.lastName}, ${p.firstName}`,
      position: p.position as string,
      availableHours: Math.round(billableCapacity * 10) / 10,
      scheduledHours: Math.round(scheduled * 10) / 10,
      utilizationPct,
      gapHours: Math.round(Math.max(0, billableCapacity - scheduled) * 10) / 10,
      scoredInUtilization: rbtIdSet.has(p.id),
    };
  }).sort((a, b) => {
    // RBTs (scored) first, then BCaBA, then BCBA; within each group by utilization asc
    if (a.scoredInUtilization !== b.scoredInUtilization) return a.scoredInUtilization ? -1 : 1;
    const posOrder: Record<string, number> = { RBT: 0, BCaBA: 1, BCBA: 2 };
    const ao = posOrder[a.position] ?? 3;
    const bo = posOrder[b.position] ?? 3;
    if (ao !== bo) return ao - bo;
    return a.utilizationPct - b.utilizationPct;
  });

  const totalAvailable = rbtReport.reduce((s, r) => s + r.availableHours, 0);
  const totalScheduled = rbtReport.reduce((s, r) => s + r.scheduledHours, 0);
  const aggregateUtilization = totalAvailable > 0
    ? Math.round((totalScheduled / totalAvailable) * 1000) / 10
    : 0;
  const hoursLeftOnTable = Math.max(0, totalAvailable - totalScheduled);

  // ── PASS 3: CLIENT COVERAGE ────────────────────────────────────────────────
  // Key by authorizationId so scheduled hours are compared against the
  // same authorization's limit — not a cross-auth total vs single-auth cap.
  const authBillableHours = new Map<string, number>();
  for (const s of therapySessions) {
    if (!s.authorizationId || !s.billable) continue;
    authBillableHours.set(s.authorizationId, (authBillableHours.get(s.authorizationId) ?? 0) + sessionHours(s.startTime, s.endTime));
  }
  for (const p of weekProposals) {
    if (!p.authorizationId) continue;
    authBillableHours.set(p.authorizationId, (authBillableHours.get(p.authorizationId) ?? 0) + sessionHours(p.startTime, p.endTime));
  }

  const now = new Date();
  const clientsWithAuth = centerClients.filter((c) => c.authorizations.length > 0);
  const coverageReport = clientsWithAuth.map((c) => {
    const auth = c.authorizations[0];
    const scheduled = authBillableHours.get(auth.id) ?? 0;
    const coveragePct = auth.approvedHoursPerWeek > 0
      ? Math.round((scheduled / auth.approvedHoursPerWeek) * 1000) / 10
      : 0;
    const status = coveragePct >= 90 ? "OPTIMAL" : coveragePct >= 70 ? "ACCEPTABLE" : "UNDER_SERVED";
    const daysUntilExpiry = Math.ceil((auth.endDate.getTime() - now.getTime()) / 86_400_000);
    const flags: string[] = [];
    if (coveragePct < 70 && scheduled > 0) flags.push("Under-served — <70% of authorized hours");
    if (scheduled === 0) flags.push("No sessions scheduled this week");
    if (daysUntilExpiry >= 0 && daysUntilExpiry <= 30) flags.push(`Auth expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`);
    if (daysUntilExpiry < 0) flags.push("Authorization expired");
    return {
      name: `${c.lastName}, ${c.firstName}`,
      authorizedWeekly: auth.approvedHoursPerWeek,
      scheduledHours: Math.round(scheduled * 10) / 10,
      coveragePct,
      status,
      authExpiry: auth.endDate.toISOString().slice(0, 10),
      daysUntilExpiry,
      flags,
    };
  }).sort((a, b) => a.coveragePct - b.coveragePct); // lowest coverage first

  const fullyCovered = coverageReport.filter((c) => c.coveragePct >= 90).length;
  const underServed = coverageReport.filter((c) => c.coveragePct < 70).length;
  const overServed = coverageReport.filter((c) => c.coveragePct > 105).length;
  const expiringAuths = coverageReport.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 30).length;
  const clientsNoAuth = centerClients.filter((c) => c.authorizations.length === 0).length;

  // ── PASS 4: COMPOSITE SCORE ────────────────────────────────────────────────
  const criticalCount = violations.filter((v) => v.severity === "CRITICAL").length;
  const highCount = violations.filter((v) => v.severity === "HIGH").length;
  const complianceScore = criticalCount > 0 ? 0 : highCount > 0 ? Math.max(0, 100 - highCount * 15) : 100;

  const utilizationScore = Math.min(100, aggregateUtilization);

  const coverageScore = clientsWithAuth.length > 0
    ? Math.round((fullyCovered / clientsWithAuth.length) * 100)
    : 100;

  // Consistency: % of sessions this week using same provider as prior 4 weeks
  // Consistency: compare this week's assigned providers (sessions + proposals)
  // against each client's most recent provider from the prior 4 weeks.
  // Including proposals ensures the score is meaningful even before proposals
  // are approved — a proposal-only week would otherwise default to 100.
  let consistencyScore = 100;
  const allWeekClientIds = new Set([
    ...[...sessionsByClient.keys()],
    ...weekProposals.filter(p => p.clientId).map(p => p.clientId!),
  ]);
  const allWeekClientIdList = [...allWeekClientIds];
  if (allWeekClientIdList.length > 0) {
    const fourWeeksAgo = new Date(weekStart.getTime() - 28 * 24 * 3_600_000);
    const priorSessions = await prisma.session.findMany({
      where: {
        clientId: { in: allWeekClientIdList },
        startTime: { gte: fourWeeksAgo, lt: weekStart },
        status: { in: ["SCHEDULED", "COMPLETED", "IN_PROGRESS"] },
      },
      select: { clientId: true, providerId: true, startTime: true },
      orderBy: { startTime: "desc" },
    });
    const priorProviderByClient = new Map<string, string>();
    for (const s of priorSessions) {
      if (!s.clientId || priorProviderByClient.has(s.clientId)) continue;
      priorProviderByClient.set(s.clientId, s.providerId);
    }
    let consistent = 0;
    let total = 0;
    // Check scheduled sessions
    for (const s of therapySessions) {
      if (!s.clientId) continue;
      const prior = priorProviderByClient.get(s.clientId);
      if (prior === undefined) continue;
      total++;
      if (s.providerId === prior) consistent++;
    }
    // Check proposals for clients not already covered by a scheduled session
    const clientsCoveredBySessions = new Set(therapySessions.map(s => s.clientId).filter(Boolean));
    for (const p of weekProposals) {
      if (!p.clientId || !p.providerId || clientsCoveredBySessions.has(p.clientId)) continue;
      const prior = priorProviderByClient.get(p.clientId);
      if (prior === undefined) continue;
      total++;
      if (p.providerId === prior) consistent++;
    }
    consistencyScore = total > 0 ? Math.round((consistent / total) * 100) : 100;
  }

  // Travel score: % of consecutive HOME session pairs that have a Drive Time session.
  // 100 when all pairs are covered; degrades proportionally when pairs are missing.
  const travelScore = homePairsTotal === 0
    ? 100
    : Math.round((homePairsCovered / homePairsTotal) * 100);

  const compositeScore = Math.round(
    complianceScore * 0.30 +
    utilizationScore * 0.30 +
    coverageScore * 0.25 +
    consistencyScore * 0.10 +
    travelScore * 0.05
  );

  const scoreLabel =
    compositeScore >= 90 ? "Excellent" :
    compositeScore >= 75 ? "Good" :
    compositeScore >= 60 ? "Fair" : "Poor";

  // Top actions to improve the score
  const topActions: string[] = [];
  if (criticalCount > 0) {
    topActions.push(`Fix ${criticalCount} critical double-booking violation${criticalCount > 1 ? "s" : ""}`);
  }
  if (underServed > 0) {
    topActions.push(`Schedule additional hours for ${underServed} under-served client${underServed > 1 ? "s" : ""} (below 70% of authorized hours)`);
  }
  if (hoursLeftOnTable >= 1) {
    const lowest = rbtReport.find((r) => r.availableHours > 0);
    const who = lowest ? ` — ${lowest.name} (${lowest.utilizationPct}%)` : "";
    topActions.push(`Capture ${hoursLeftOnTable.toFixed(1)}h of unclaimed RBT capacity${who}`);
  }
  if (expiringAuths > 0 && topActions.length < 3) {
    topActions.push(`Renew ${expiringAuths} authorization${expiringAuths > 1 ? "s" : ""} expiring within 30 days`);
  }
  if (consistencyScore < 70 && topActions.length < 3) {
    topActions.push(`Improve provider consistency — ${consistencyScore}% of clients seeing their regular provider`);
  }

  // Week label for display
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
  const weekLabel = `${fmt(weekStart)} – ${fmt(new Date(weekEnd.getTime() - 1))}`;

  return NextResponse.json({
    weekOf: weekLabel,
    score: compositeScore,
    scoreLabel,
    compliance: {
      result: violations.length === 0 ? "PASS" : "FAIL",
      violations,
    },
    utilization: {
      rbtProviders: rbtReport,
      allProviders: allProvidersReport,
      aggregate: {
        totalAvailable: Math.round(totalAvailable * 10) / 10,
        totalScheduled: Math.round(totalScheduled * 10) / 10,
        utilizationPct: aggregateUtilization,
        hoursLeftOnTable: Math.round(hoursLeftOnTable * 10) / 10,
      },
    },
    coverage: {
      clients: coverageReport,
      summary: { fullyCovered, underServed, overServed, expiringAuths, clientsNoAuth },
    },
    scoreBreakdown: {
      compliance: complianceScore,
      utilization: utilizationScore,
      coverage: coverageScore,
      consistency: consistencyScore,
      travel: travelScore,
    },
    topActions: topActions.slice(0, 3),
  });
}
