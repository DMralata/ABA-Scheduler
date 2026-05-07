import { prisma } from "@/lib/prisma";
import { SESSION_BILLABLE_STATUSES } from "./sessions";

function getWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMon);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const SCHEDULABLE_DAYS = new Set(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]);
const RBT_RANK: Record<string, number> = { I: 1, II: 2, III: 3 };

export async function getCoverageAuditData() {
  const { start: weekStart, end: weekEnd } = getWeekBounds();

  const [providers, clients, sessionsThisWeek] = await Promise.all([
    prisma.provider.findMany({
      where: { status: "ACTIVE" },
      include: {
        availability: true,
        approvedClients: { where: { endDate: null } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.client.findMany({
      where: {
        OR: [{ terminationDate: null }, { terminationDate: { gt: new Date() } }],
        preferredLocation: { in: ["HOME", "HYBRID"] },
      },
      include: {
        approvedHomeProviders: {
          where: { endDate: null },
          select: { providerId: true },
        },
        authorizations: {
          orderBy: { startDate: "desc" },
          take: 1,
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.session.findMany({
      where: {
        startTime: { gte: weekStart, lte: weekEnd },
        status: { in: SESSION_BILLABLE_STATUSES },
      },
      select: {
        providerId: true,
        clientId: true,
        startTime: true,
        endTime: true,
      },
    }),
  ]);

  // Accumulate scheduled hours this week per provider and client
  const providerScheduledHours = new Map<string, number>();
  const clientScheduledHours = new Map<string, number>();
  for (const s of sessionsThisWeek) {
    const dur = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
    if (s.providerId) {
      providerScheduledHours.set(s.providerId, (providerScheduledHours.get(s.providerId) ?? 0) + dur);
    }
    if (s.clientId) {
      clientScheduledHours.set(s.clientId, (clientScheduledHours.get(s.clientId) ?? 0) + dur);
    }
  }

  // Build provider audit rows
  const providerRows = providers.map((p) => {
    const availHours = p.availability
      .filter((w) => SCHEDULABLE_DAYS.has(w.dayOfWeek))
      .reduce((sum, w) => sum + (parseHHMM(w.endTime) - parseHHMM(w.startTime)) / 60, 0);
    const scheduledHours = providerScheduledHours.get(p.id) ?? 0;
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position as string,
      gender: p.gender,
      rbtLevel: p.rbtLevel as string | null,
      spanish: p.spanish,
      availableHoursPerWeek: availHours,
      scheduledHoursThisWeek: scheduledHours,
      utilization: availHours > 0 ? scheduledHours / availHours : 0,
      approvedClientCount: p.approvedClients.length,
    };
  });

  // Build client audit rows — compute suggestions from the provider pool
  const clientRows = clients.map((c) => {
    const auth = c.authorizations[0] ?? null;
    const authorizedWeeklyHours = auth?.approvedHoursPerWeek ?? 0;
    const scheduledHours = clientScheduledHours.get(c.id) ?? 0;
    const approvedProviderIds = new Set(c.approvedHomeProviders.map((a) => a.providerId));

    // Suggested providers: not on approved list, pass hard constraints, have open capacity
    const suggested = providerRows
      .filter((p) => {
        if (approvedProviderIds.has(p.id)) return false;
        if (p.position === "BCBA") return false;
        if (c.femaleProviderOnly && p.gender.toLowerCase() !== "female") return false;
        if (c.spanish && !p.spanish) return false;
        if (c.minimumRbtLevel && p.position === "RBT" && p.rbtLevel) {
          if ((RBT_RANK[p.rbtLevel] ?? 0) < (RBT_RANK[c.minimumRbtLevel] ?? 0)) return false;
        }
        return p.utilization < 0.85;
      })
      .sort((a, b) => a.utilization - b.utilization)
      .slice(0, 5);

    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      preferredLocation: c.preferredLocation as string,
      femaleProviderOnly: c.femaleProviderOnly,
      spanish: c.spanish,
      minimumRbtLevel: c.minimumRbtLevel as string | null,
      authorizedWeeklyHours,
      scheduledHoursThisWeek: scheduledHours,
      coverage: authorizedWeeklyHours > 0 ? scheduledHours / authorizedWeeklyHours : 0,
      approvedProviderCount: approvedProviderIds.size,
      suggestedProviders: suggested.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        rbtLevel: p.rbtLevel,
        availableHoursPerWeek: p.availableHoursPerWeek,
        scheduledHoursThisWeek: p.scheduledHoursThisWeek,
        utilization: p.utilization,
      })),
    };
  });

  return { providers: providerRows, clients: clientRows, weekStart };
}

export type CoverageAuditData = Awaited<ReturnType<typeof getCoverageAuditData>>;
export type ClientAuditRow = CoverageAuditData["clients"][number];
export type ProviderAuditRow = CoverageAuditData["providers"][number];
