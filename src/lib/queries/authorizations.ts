import { prisma } from "@/lib/prisma";
import { getWeekBoundaries } from "@/lib/utils";

// All authorizations for a client, ordered by most recent start date first
export async function getClientAuthorizations(clientId: string) {
  return prisma.authorization.findMany({
    where: { clientId },
    orderBy: { startDate: "desc" },
  });
}

// Active authorizations for a client on a given date.
// An authorization is active if: startDate <= date <= endDate.
// If serviceCode is provided, returns authorizations that match it OR have no service code (catch-all).
// If serviceCode is omitted, returns all active authorizations.
export async function getActiveAuthorizationsForClient(
  clientId: string,
  date: Date,
  serviceCode?: string | null
) {
  return prisma.authorization.findMany({
    where: {
      clientId,
      startDate: { lte: date },
      endDate: { gte: date },
      ...(serviceCode !== undefined
        ? { OR: [{ serviceCode }, { serviceCode: null }] }
        : {}),
    },
    orderBy: { startDate: "desc" },
  });
}

// Authorizations expiring within `withinDays` days from now, with client info.
// Only returns currently active authorizations (started in the past, not yet expired).
// Used by the dashboard to surface upcoming expirations.
export async function getExpiringSoonAuthorizations(withinDays: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 24 * 3_600_000);

  return prisma.authorization.findMany({
    where: {
      startDate: { lte: now },
      endDate: { gte: now, lte: cutoff },
    },
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { endDate: "asc" },
  });
}

// Single authorization by ID
export async function getAuthorizationById(id: string) {
  return prisma.authorization.findUnique({
    where: { id },
    include: { client: true },
  });
}

// Derive the current status of an authorization based on its dates and session hours.
// This is computed at call time — status is never stored as a mutable field.
//
// timezone: IANA timezone string for the practice (e.g. "America/New_York").
// Auth dates and "today" must be compared in the practice's local timezone so that
// an auth expiring on Dec 31 isn't marked EXPIRED at 7 pm ET (midnight UTC).
export async function getAuthorizationStatus(
  authorizationId: string,
  timezone = "America/New_York"
): Promise<"PENDING" | "ACTIVE" | "EXPIRING_SOON" | "EXHAUSTED" | "EXPIRED"> {
  const auth = await prisma.authorization.findUnique({
    where: { id: authorizationId },
  });

  if (!auth) throw new Error("Authorization not found");

  const now = new Date();

  // Compare dates as "YYYY-MM-DD" strings in the practice timezone — avoids UTC offset errors.
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const todayStr    = fmt(now);
  const authEndStr  = fmt(auth.endDate);
  const authStartStr = fmt(auth.startDate);

  if (authEndStr < todayStr) return "EXPIRED";
  if (authStartStr > todayStr) return "PENDING";

  // Check if expiring within 30 days
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 3_600_000);
  const expiringSoon = authEndStr <= fmt(thirtyDaysFromNow);

  // Compute hours used this week against the authorization, using practice-local week boundaries.
  const { weekStart, weekEnd } = getWeekBoundaries(now, timezone);

  const sessions = await prisma.session.findMany({
    where: {
      authorizationId,
      status: { in: ["SCHEDULED", "COMPLETED"] },
      startTime: { gte: weekStart, lt: weekEnd },
    },
    select: { startTime: true, endTime: true },
  });

  const usedHours = sessions.reduce((total, s) => {
    return total + (s.endTime.getTime() - s.startTime.getTime()) / (1000 * 60 * 60);
  }, 0);

  if (usedHours >= auth.approvedHoursPerWeek) return "EXHAUSTED";
  if (expiringSoon) return "EXPIRING_SOON";
  return "ACTIVE";
}

