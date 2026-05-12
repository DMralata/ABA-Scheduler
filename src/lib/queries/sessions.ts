import { prisma } from "@/lib/prisma";
import type { SessionStatus } from "@prisma/client";
import { getClientNameMasker } from "@/lib/maskClient";

// ─── Scheduling Status Constants ─────────────────────────────────────────────
// CANCELLED sessions are ALWAYS invisible to the scheduler.
// These constants enforce that invariant in one place so no query accidentally
// re-admits cancelled sessions.
//
// SESSION_CONFLICT_STATUSES — statuses that occupy a time slot.
//   A CANCELLED session frees its slot. A COMPLETED session is over.
//   Only SCHEDULED and IN_PROGRESS sessions block re-use of a window.
//
// SESSION_BILLABLE_STATUSES — statuses that consume authorization hours.
//   CANCELLED sessions never happened, so they don't count against a client's
//   weekly budget. COMPLETED sessions did happen and must be counted.
export const SESSION_CONFLICT_STATUSES: SessionStatus[] = ["SCHEDULED", "IN_PROGRESS"];
export const SESSION_BILLABLE_STATUSES: SessionStatus[]  = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"];

// Single session by ID
export async function getSessionById(id: string) {
  return prisma.session.findUnique({
    where: { id },
    include: {
      sessionType: true,
      provider: true,
      client: true,
      authorization: true,
    },
  });
}

// All sessions for a provider, optionally filtered by date range
export async function getSessionsByProvider(
  providerId: string,
  from?: Date,
  to?: Date
) {
  return prisma.session.findMany({
    where: {
      providerId,
      ...(from && to
        ? { AND: [{ startTime: { lt: to } }, { endTime: { gt: from } }] }
        : {}),
    },
    include: {
      sessionType: true,
      client: true,
    },
    orderBy: { startTime: "asc" },
  });
}

// All sessions for a client, optionally filtered by date range
export async function getSessionsByClient(
  clientId: string,
  from?: Date,
  to?: Date
) {
  return prisma.session.findMany({
    where: {
      clientId,
      ...(from && to
        ? { AND: [{ startTime: { lt: to } }, { endTime: { gt: from } }] }
        : {}),
    },
    include: {
      sessionType: true,
      provider: true,
      authorization: true,
    },
    orderBy: { startTime: "asc" },
  });
}

// All sessions within a date range — used for the schedule view
// Uses overlap logic: catches sessions that start before `to` AND end after `from`
export async function getSessionsByDateRange(from: Date, to: Date) {
  return prisma.session.findMany({
    where: {
      AND: [
        { startTime: { lt: to } },
        { endTime: { gt: from } },
      ],
    },
    include: {
      sessionType: true,
      provider: true,
      client: true,
    },
    orderBy: { startTime: "asc" },
  });
}

// Check if a provider has any overlapping sessions at a given time — used by validations
// Blocks: SCHEDULED/IN_PROGRESS sessions + CANCELLED sessions where the provider cancelled
// (provider called out sick — their time remains blocked even though the session is cancelled).
// Client-cancelled sessions do NOT block the provider — their slot is freed for re-assignment.
export async function getProviderSessionOverlap(
  providerId: string,
  startTime: Date,
  endTime: Date,
  excludeSessionId?: string
) {
  return prisma.session.findFirst({
    where: {
      providerId,
      OR: [
        { status: { in: SESSION_CONFLICT_STATUSES } },
        { status: "CANCELLED", cancelledBy: "PROVIDER" },
      ],
      id: excludeSessionId ? { not: excludeSessionId } : undefined,
      AND: [
        { startTime: { lt: endTime } },
        { endTime: { gt: startTime } },
      ],
    },
  });
}

// Check if a client has any overlapping sessions at a given time — used by validations
// Blocks: SCHEDULED/IN_PROGRESS sessions + CANCELLED sessions where the client cancelled
// (client said they're not coming — their time remains blocked even though the session is cancelled).
// Provider-cancelled sessions do NOT block the client — they need a new provider for that slot.
export async function getClientSessionOverlap(
  clientId: string,
  startTime: Date,
  endTime: Date,
  excludeSessionId?: string
) {
  return prisma.session.findFirst({
    where: {
      clientId,
      OR: [
        { status: { in: SESSION_CONFLICT_STATUSES } },
        { status: "CANCELLED", cancelledBy: "CLIENT" },
      ],
      id: excludeSessionId ? { not: excludeSessionId } : undefined,
      AND: [
        { startTime: { lt: endTime } },
        { endTime: { gt: startTime } },
      ],
    },
  });
}

// Sum of billable hours for a client against a specific authorization in a given week.
// Scoped to authorizationId so different service codes are tracked independently.
// Counts both confirmed sessions (SESSION_BILLABLE_STATUSES) AND in-flight
// PENDING/APPROVED proposals that have not yet been converted to sessions
// (sessionId IS NULL). Counting in-flight proposals is what keeps manual booking
// from accidentally pushing the client over their weekly cap when the scheduler
// has already earmarked hours that haven't been formally accepted yet.
export async function getClientBillableHoursForWeek(
  clientId: string,
  authorizationId: string,
  weekStart: Date,
  weekEnd: Date,
  excludeSessionId?: string
): Promise<number> {
  const [sessions, proposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        clientId,
        authorizationId,
        billable: true,
        status: { in: SESSION_BILLABLE_STATUSES },
        id: excludeSessionId ? { not: excludeSessionId } : undefined,
        // Overlap logic: catches sessions spanning the week boundary
        AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: weekStart } }],
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        clientId,
        authorizationId,
        status: { in: ["PENDING", "APPROVED"] },
        sessionId: null, // skip proposals already turned into sessions (counted above)
        AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: weekStart } }],
      },
      select: { startTime: true, endTime: true },
    }),
  ]);

  const sumHours = (arr: Array<{ startTime: Date; endTime: Date }>) =>
    arr.reduce(
      (total, s) => total + (s.endTime.getTime() - s.startTime.getTime()) / (1000 * 60 * 60),
      0,
    );
  return sumHours(sessions) + sumHours(proposals);
}

// Billable hours used this week per authorization, as a map of authorizationId → hours.
// Used by the AuthorizationsPanel to show weekly usage for each auth.
export async function getWeeklyHoursMap(
  authorizationIds: string[],
  weekStart: Date,
  weekEnd: Date
): Promise<Record<string, number>> {
  if (authorizationIds.length === 0) return {};

  const sessions = await prisma.session.findMany({
    where: {
      authorizationId: { in: authorizationIds },
      billable: true,
      status: { in: SESSION_BILLABLE_STATUSES },
      // Overlap logic: catches sessions that start before weekEnd AND end after weekStart.
      // Avoids under-counting sessions that span a week boundary (e.g. start Sun 11:59pm).
      AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: weekStart } }],
    },
    select: { authorizationId: true, startTime: true, endTime: true },
  });

  const map: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.authorizationId) continue;
    const hours = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    map[s.authorizationId] = (map[s.authorizationId] ?? 0) + hours;
  }
  return map;
}

// ─── Dashboard Chart Data ─────────────────────────────────────────────────────
// Raw session rows for the dashboard analytics chart. Fetches all sessions from
// the given start date forward — the caller slices into WTD/MTD/YTD buckets.
export type DashboardSession = {
  startTime: Date;
  endTime: Date;
  billable: boolean;
  status: string;
  sessionTypeName: string;
  locationType: string | null;
  providerId: string;
  clientName: string | null;
  providerName: string | null;
  providerPosition: string | null;
  cancelledBy: "CLIENT" | "PROVIDER" | null;
  cancellationReason: string | null;
};

export async function getDashboardSessions(from: Date): Promise<DashboardSession[]> {
  const [rows, mask] = await Promise.all([
    prisma.session.findMany({
      where: { startTime: { gte: from } },
      select: {
        startTime: true,
        endTime: true,
        billable: true,
        status: true,
        locationType: true,
        providerId: true,
        cancelledBy: true,
        cancellationReason: true,
        sessionType: { select: { name: true } },
        client: { select: { firstName: true, lastName: true } },
        provider: { select: { firstName: true, lastName: true, position: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    getClientNameMasker(),
  ]);

  return rows.map((s) => ({
    startTime: s.startTime,
    endTime: s.endTime,
    billable: s.billable,
    status: s.status,
    sessionTypeName: s.sessionType.name,
    locationType: s.locationType,
    providerId: s.providerId,
    clientName: s.client ? `${mask(s.client.lastName)}, ${mask(s.client.firstName)}` : null,
    providerName: s.provider ? `${s.provider.lastName}, ${s.provider.firstName}` : null,
    providerPosition: s.provider?.position ?? null,
    cancelledBy: s.cancelledBy as "CLIENT" | "PROVIDER" | null,
    cancellationReason: s.cancellationReason,
  }));
}

// Weekly dashboard stats: billable hours, unbillable hours, and cancellation count.
// Hours only count for sessions that have completed (endTime has passed).
// Cancellations are all CANCELLED sessions that started within the week window.
export async function getWeeklyDashboardStats(
  weekStart: Date,
  weekEnd: Date
): Promise<{ billableHours: number; unbillableHours: number; cancellations: number }> {
  const now = new Date();
  const [sessions, cancellations] = await Promise.all([
    prisma.session.findMany({
      where: {
        status: { in: SESSION_BILLABLE_STATUSES },
        endTime: { lte: now },
        AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: weekStart } }],
      },
      select: { startTime: true, endTime: true, billable: true },
    }),
    prisma.session.count({
      where: {
        status: "CANCELLED",
        AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: weekStart } }],
      },
    }),
  ]);

  let billableHours = 0;
  let unbillableHours = 0;
  for (const s of sessions) {
    const hours = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    if (s.billable) billableHours += hours;
    else unbillableHours += hours;
  }

  return { billableHours, unbillableHours, cancellations };
}

// All session types — used to populate dropdowns in the UI
export async function getSessionTypes() {
  return prisma.sessionType.findMany({
    orderBy: { name: "asc" },
  });
}

// Returns a map of clientId → average CLIENT-cancelled hours per week, measured
// from each client's activeDate. Used by the scheduler to compute an over-scheduling
// buffer that compensates for the client's historical cancellation rate.
// Only CLIENT-initiated cancellations count — provider cancellations are not the
// client's fault and should not inflate their schedule.
export async function getClientAvgWeeklyCancellationHours(
  clients: Array<{ id: string; activeDate: Date | null }>
): Promise<Record<string, number>> {
  const clientIds = clients.map((c) => c.id);

  // Single DB query — fetch all CLIENT-cancelled sessions for the entire batch
  const cancelledSessions = await prisma.session.findMany({
    where: {
      clientId: { in: clientIds },
      status: "CANCELLED",
      cancelledBy: "CLIENT",
    },
    select: { clientId: true, startTime: true, endTime: true },
  });

  // Sum cancelled hours per client
  const hoursByClient: Record<string, number> = {};
  for (const s of cancelledSessions) {
    if (!s.clientId) continue;
    const hrs = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    hoursByClient[s.clientId] = (hoursByClient[s.clientId] ?? 0) + hrs;
  }

  const now = new Date();
  const result: Record<string, number> = {};
  for (const { id, activeDate } of clients) {
    if (!activeDate) { result[id] = 0; continue; }
    const weeksActive = Math.floor(
      (now.getTime() - activeDate.getTime()) / (7 * 24 * 3_600_000)
    );
    result[id] = weeksActive >= 1 ? (hoursByClient[id] ?? 0) / weeksActive : 0;
  }
  return result;
}

// Returns SCHEDULED/IN_PROGRESS sessions for a provider on a given UTC day,
// including client address data for drive time gap validation at booking time.
// Drive Time sessions (clientId = null) are excluded automatically.
export async function getProviderSameDaySessions(
  providerId: string,
  dayStart: Date,
  dayEnd: Date,
  excludeSessionId?: string
) {
  return prisma.session.findMany({
    where: {
      providerId,
      clientId: { not: null },
      status: { in: SESSION_CONFLICT_STATUSES },
      startTime: { gte: dayStart, lt: dayEnd },
      id: excludeSessionId ? { not: excludeSessionId } : undefined,
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      locationType: true,
      client: {
        select: {
          street: true,
          city: true,
          state: true,
          zip: true,
          latitude: true,
          longitude: true,
        },
      },
    },
    orderBy: { startTime: "asc" },
  });
}

// Count pending proposed sessions — used for the nav rail Schedule badge
export async function getProposalCount(): Promise<number> {
  return prisma.proposedSession.count({ where: { status: "PENDING" } });
}
