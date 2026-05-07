import Link from "next/link";
import { getExpiringSoonAuthorizations } from "@/lib/queries/authorizations";
import { getWeeklyDashboardStats, getDashboardSessions } from "@/lib/queries/sessions";
import type { DashboardSession } from "@/lib/queries/sessions";
import { getRBTAvailabilityData } from "@/lib/queries/providers";
import type { RBTAvailabilityData } from "@/lib/queries/providers";
import { DashboardChart } from "@/components/dashboard/DashboardChart";
import { formatCancellationReason } from "@/lib/utils";
import type { Bucket, DashboardChartData } from "@/components/dashboard/DashboardChart";
import { ProviderSummaryTable } from "@/components/dashboard/ProviderSummaryTable";
import type { ProviderStat, ProviderSummaryData } from "@/components/dashboard/ProviderSummaryTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { getWeekBoundaries } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { AlertTriangle, Clock, BarChart2, XCircle } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function daysUntil(date: Date): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Returns "YYYY-MM-DD" string for the given date in the given timezone
function localDateStr(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

// Adds `days` to a "YYYY-MM-DD" string, returns new "YYYY-MM-DD" string
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// ─── RBT Availability Map ─────────────────────────────────────────────────────
// Maps "YYYY-MM-DD" → total RBT available hours for that day.
// Built once for the full YTD range; bucket computation sums the relevant days.

const DOW_TO_UTC: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

function timeToHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

function buildDailyAvailabilityMap(
  yearStartStr: string,
  todayStr: string,
  { windows, blocks }: RBTAvailabilityData,
  tz: string
): Record<string, number> {
  // Sum availability window hours per day-of-week across all RBT providers
  const windowsByDow: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const w of windows) {
    const dow = DOW_TO_UTC[w.dayOfWeek];
    windowsByDow[dow] += timeToHours(w.endTime) - timeToHours(w.startTime);
  }

  // Index blocks by local date string for fast lookup
  const blocksByDate: Record<string, number> = {};
  for (const b of blocks) {
    const ds = localDateStr(b.date, tz);
    blocksByDate[ds] = (blocksByDate[ds] ?? 0) + (timeToHours(b.endTime) - timeToHours(b.startTime));
  }

  // Walk every day from year start to today, building the map
  const map: Record<string, number> = {};
  let current = yearStartStr;
  while (current <= todayStr) {
    const dow = new Date(`${current}T12:00:00Z`).getUTCDay();
    const available = Math.max(0, windowsByDow[dow] - (blocksByDate[current] ?? 0));
    map[current] = available;
    current = addDays(current, 1);
  }
  return map;
}

// ─── Bucket Computation ───────────────────────────────────────────────────────

type BucketDef = { label: string; startStr: string; endStr: string };

function buildBuckets(
  sessions: DashboardSession[],
  bucketDefs: BucketDef[],
  tz: string,
  availabilityMap: Record<string, number>,
  now: Date
): Bucket[] {
  return bucketDefs.map(({ label, startStr, endStr }) => {
    const inBucket = sessions.filter((s) => {
      const ds = localDateStr(s.startTime, tz);
      return ds >= startStr && ds < endStr;
    });

    // Sum available RBT hours for every day in this bucket
    let rbtAvailableHours = 0;
    let current = startStr;
    while (current < endStr) {
      rbtAvailableHours += availabilityMap[current] ?? 0;
      current = addDays(current, 1);
    }

    let billedHours = 0;
    let unbillableHours = 0;
    let rbtBilledHours = 0;
    let cancellations = 0;
    let supervisionHours = 0;
    let parentTrainingHours = 0;
    let assessmentHours = 0;
    let driveTimeHours = 0;
    let billedDirectTherapy = 0;
    let billedDirectTherapyHome = 0;
    let scheduledDirectTherapy = 0;
    let scheduledDirectTherapyHome = 0;
    let scheduledSupervision = 0;
    let scheduledParentTraining = 0;
    let scheduledAssessment = 0;

    // Maps: name → count, for client-initiated and provider-initiated separately
    const clientCancelMap: Record<string, number> = {};
    const providerCancelMap: Record<string, number> = {};
    // Map: reason → { clientCount, providerCount }
    const reasonMap: Record<string, { clientCount: number; providerCount: number }> = {};

    for (const s of inBucket) {
      if (s.status === "CANCELLED") {
        cancellations++;
        const reason = s.cancellationReason?.trim()
          ? formatCancellationReason(s.cancellationReason.trim())
          : "No reason given";
        if (!reasonMap[reason]) reasonMap[reason] = { clientCount: 0, providerCount: 0 };

        if (s.cancelledBy === "CLIENT") {
          const name = s.clientName ?? "Unknown client";
          clientCancelMap[name] = (clientCancelMap[name] ?? 0) + 1;
          reasonMap[reason].clientCount++;
        } else if (s.cancelledBy === "PROVIDER") {
          const name = s.providerName ?? "Unknown provider";
          providerCancelMap[name] = (providerCancelMap[name] ?? 0) + 1;
          reasonMap[reason].providerCount++;
        } else {
          // cancelledBy is null — treat as unknown, still track reason
          reasonMap[reason].clientCount++;
        }
        continue;
      }
      if (!["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(s.status)) continue;
      if (s.endTime > now) continue; // session hasn't completed yet

      const hours = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
      if (s.billable) {
        billedHours += hours;
        if (s.providerPosition === "RBT") rbtBilledHours += hours;
      } else {
        unbillableHours += hours;
      }

      switch (s.sessionTypeName) {
        case "Direct Therapy":      billedDirectTherapy     += hours; break;
        case "Direct Therapy Home": billedDirectTherapyHome += hours; break;
        case "Supervision":         supervisionHours        += hours; break;
        case "Parent Training":     parentTrainingHours     += hours; break;
        case "Assessment":          assessmentHours         += hours; break;
      }
    }

    // Drive Time — computed from the gap between consecutive HOME sessions per provider.
    // Drive Time session records aren't persisted (only shown as pseudo-events on the
    // calendar), so we derive the metric from the schedule itself: any gap between a
    // HOME session's endTime and the next session's startTime for the same provider,
    // where the gap has already elapsed (endTime of the drive gap <= now).
    const homeEligible = inBucket.filter(
      (s) => !["CANCELLED"].includes(s.status) && s.locationType === "HOME" && s.endTime <= now
    );
    const byProvider = new Map<string, typeof homeEligible>();
    for (const s of homeEligible) {
      if (!byProvider.has(s.providerId)) byProvider.set(s.providerId, []);
      byProvider.get(s.providerId)!.push(s);
    }
    for (const provSessions of byProvider.values()) {
      const sorted = provSessions.slice().sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = (sorted[i + 1].startTime.getTime() - sorted[i].endTime.getTime()) / 3_600_000;
        if (gap > 0 && gap <= 2) driveTimeHours += gap; // only count realistic drive gaps (≤ 2 h)
      }
    }

    // Scheduled Hours metric — includes all non-cancelled sessions (future + past)
    // to show the full picture of committed billable schedule time, broken down by type.
    for (const s of inBucket) {
      if (!["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(s.status)) continue;
      const hrs = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;
      switch (s.sessionTypeName) {
        case "Direct Therapy":      scheduledDirectTherapy     += hrs; break;
        case "Direct Therapy Home": scheduledDirectTherapyHome += hrs; break;
        case "Supervision":         scheduledSupervision       += hrs; break;
        case "Parent Training":     scheduledParentTraining    += hrs; break;
        case "Assessment":          scheduledAssessment        += hrs; break;
        // Non-billable types (Drive Time, Admin, Break, etc.) are excluded
      }
    }

    const topClients = Object.entries(clientCancelMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topProviders = Object.entries(providerCancelMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const byReason = Object.entries(reasonMap)
      .map(([reason, counts]) => ({ reason, ...counts }))
      .sort((a, b) => (b.clientCount + b.providerCount) - (a.clientCount + a.providerCount));

    return {
      label,
      billedHours,
      unbillableHours,
      rbtBilledHours,
      rbtAvailableHours,
      cancellations,
      billedDirectTherapy,
      billedDirectTherapyHome,
      supervisionHours,
      parentTrainingHours,
      assessmentHours,
      driveTimeHours,
      scheduledDirectTherapy,
      scheduledDirectTherapyHome,
      scheduledSupervision,
      scheduledParentTraining,
      scheduledAssessment,
      topClientCancellations: topClients,
      topProviderCancellations: topProviders,
      cancellationsByReason: byReason,
    };
  });
}

function buildWTDBuckets(todayStr: string): BucketDef[] {
  // Day of week: 0=Sun via UTC math on the noon anchor
  const dow = new Date(`${todayStr}T12:00:00Z`).getUTCDay();
  const weekSunStr = addDays(todayStr, -dow);
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const defs: BucketDef[] = [];
  for (let i = 0; i <= dow; i++) {
    const startStr = addDays(weekSunStr, i);
    defs.push({ label: DAY_LABELS[i], startStr, endStr: addDays(startStr, 1) });
  }
  return defs;
}

function buildMTDBuckets(todayStr: string): BucketDef[] {
  const [y, m] = todayStr.split("-").map(Number);
  const monthPfx = `${y}-${pad(m)}`;
  const nextMonthStr = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const weeks: BucketDef[] = [
    { label: "1–7",   startStr: `${monthPfx}-01`, endStr: `${monthPfx}-08` },
    { label: "8–14",  startStr: `${monthPfx}-08`, endStr: `${monthPfx}-15` },
    { label: "15–21", startStr: `${monthPfx}-15`, endStr: `${monthPfx}-22` },
    { label: "22–28", startStr: `${monthPfx}-22`, endStr: `${monthPfx}-29` },
    { label: "29+",   startStr: `${monthPfx}-29`, endStr: nextMonthStr },
  ];
  return weeks.filter((w) => w.startStr <= todayStr);
}

function buildYTDBuckets(todayStr: string): BucketDef[] {
  const [y, m] = todayStr.split("-").map(Number);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const defs: BucketDef[] = [];
  for (let mo = 1; mo <= m; mo++) {
    const nextMo = mo === 12 ? 1 : mo + 1;
    const nextY  = mo === 12 ? y + 1 : y;
    defs.push({
      label:    MONTHS[mo - 1],
      startStr: `${y}-${pad(mo)}-01`,
      endStr:   `${nextY}-${pad(nextMo)}-01`,
    });
  }
  return defs;
}

// ─── Provider Stats ───────────────────────────────────────────────────────────

function buildProviderStats(
  sessions: DashboardSession[],
  bucketDefs: BucketDef[],
  tz: string,
  now: Date
): ProviderStat[] {
  if (bucketDefs.length === 0) return [];
  const rangeStart = bucketDefs[0].startStr;
  const rangeEnd   = bucketDefs[bucketDefs.length - 1].endStr;

  const inRange = sessions.filter((s) => {
    const ds = localDateStr(s.startTime, tz);
    return ds >= rangeStart && ds < rangeEnd;
  });

  const providerMap = new Map<string, {
    name: string;
    position: string;
    sessions: DashboardSession[];
  }>();

  for (const s of inRange) {
    if (!s.providerId) continue;
    if (!providerMap.has(s.providerId)) {
      providerMap.set(s.providerId, {
        name: s.providerName ?? "Unknown",
        position: s.providerPosition ?? "Unknown",
        sessions: [],
      });
    }
    providerMap.get(s.providerId)!.sessions.push(s);
  }

  const stats: ProviderStat[] = [];

  for (const [providerId, { name, position, sessions: ps }] of providerMap) {
    let billedHours    = 0;
    let scheduledHours = 0;
    let cancellations  = 0;
    let directTherapy     = 0;
    let directTherapyHome = 0;
    let supervision       = 0;
    let parentTraining    = 0;
    let assessment        = 0;

    for (const s of ps) {
      if (s.status === "CANCELLED") { cancellations++; continue; }
      if (!["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(s.status)) continue;

      const hrs = (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000;

      if (s.billable) {
        scheduledHours += hrs;
        switch (s.sessionTypeName) {
          case "Direct Therapy":      directTherapy     += hrs; break;
          case "Direct Therapy Home": directTherapyHome += hrs; break;
          case "Supervision":         supervision       += hrs; break;
          case "Parent Training":     parentTraining    += hrs; break;
          case "Assessment":          assessment        += hrs; break;
        }
        if (s.endTime <= now) billedHours += hrs;
      }
    }

    // Drive time — gaps between consecutive HOME sessions (≤ 2 h)
    let driveTime = 0;
    const homeCompleted = ps.filter(
      (s) => s.status !== "CANCELLED" && s.locationType === "HOME" && s.endTime <= now
    );
    const sorted = homeCompleted.slice().sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = (sorted[i + 1].startTime.getTime() - sorted[i].endTime.getTime()) / 3_600_000;
      if (gap > 0 && gap <= 2) driveTime += gap;
    }

    stats.push({
      providerId,
      providerName: name,
      position,
      billedHours,
      directTherapy,
      directTherapyHome,
      supervision,
      parentTraining,
      assessment,
      driveTime,
      scheduledHours,
      cancellations,
    });
  }

  // Sort: BCBA → BCaBA → RBT → Other, then alphabetically
  const POS_ORDER = ["BCBA", "BCaBA", "RBT"];
  return stats.sort((a, b) => {
    const ai = POS_ORDER.indexOf(a.position);
    const bi = POS_ORDER.indexOf(b.position);
    const ao = ai === -1 ? 99 : ai;
    const bo = bi === -1 ? 99 : bi;
    if (ao !== bo) return ao - bo;
    return a.providerName.localeCompare(b.providerName);
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const center = await prisma.center.findFirst({ select: { timezone: true } });
  const tz = center?.timezone ?? "America/New_York";
  const { weekStart, weekEnd } = getWeekBoundaries(new Date(), tz);

  const now = new Date();
  const todayStr = localDateStr(now, tz);
  const [y] = todayStr.split("-").map(Number);
  const yearStart = new Date(`${y}-01-01T00:00:00Z`);

  const [stats, expiringSoon, rawSessions, rbtAvailability] = await Promise.all([
    getWeeklyDashboardStats(weekStart, weekEnd),
    getExpiringSoonAuthorizations(30),
    getDashboardSessions(yearStart),
    getRBTAvailabilityData(yearStart),
  ]);

  const yearStartStr = `${y}-01-01`;
  const availabilityMap = buildDailyAvailabilityMap(yearStartStr, todayStr, rbtAvailability, tz);

  // Build chart buckets
  const wtdDefs = buildWTDBuckets(todayStr);
  const mtdDefs = buildMTDBuckets(todayStr);
  const ytdDefs = buildYTDBuckets(todayStr);

  const chartData: DashboardChartData = {
    wtd: buildBuckets(rawSessions, wtdDefs, tz, availabilityMap, now),
    mtd: buildBuckets(rawSessions, mtdDefs, tz, availabilityMap, now),
    ytd: buildBuckets(rawSessions, ytdDefs, tz, availabilityMap, now),
  };

  const providerSummaryData: ProviderSummaryData = {
    wtd: buildProviderStats(rawSessions, wtdDefs, tz, now),
    mtd: buildProviderStats(rawSessions, mtdDefs, tz, now),
    ytd: buildProviderStats(rawSessions, ytdDefs, tz, now),
  };

  // Stat card values
  const totalHours = stats.billableHours + stats.unbillableHours;
  const billablePct = totalHours > 0 ? Math.round((stats.billableHours / totalHours) * 100) : 0;
  const unbillablePct = totalHours > 0 ? 100 - billablePct : 0;

  const weekLabel =
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(weekStart) +
    " – " +
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(new Date(weekEnd.getTime() - 1));

  return (
    <div>
      <PageHeader title="Dashboard" description="Overview of your scheduling operations." />

      <div className="space-y-5">
        {/* Weekly Stat Cards */}
        <div>
          <p className="text-xs text-muted-foreground mb-3">This week &middot; {weekLabel}</p>
          <div className="grid grid-cols-3 gap-4">
            {/* Billed Hours */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock size={14} className="text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Billed Hours</span>
              </div>
              <p className="text-3xl font-semibold text-foreground">{formatHours(stats.billableHours)}</p>
              <p className="text-xs text-muted-foreground mt-1">Scheduled + completed billable sessions</p>
            </div>

            {/* Hour Mix */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 size={14} className="text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hour Mix</span>
              </div>
              {totalHours > 0 ? (
                <>
                  <div className="flex items-end gap-3 mb-3">
                    <div>
                      <p className="text-3xl font-semibold text-foreground">{billablePct}%</p>
                      <p className="text-xs text-muted-foreground">billable</p>
                    </div>
                    <div className="mb-0.5">
                      <p className="text-xl font-medium text-muted-foreground">{unbillablePct}%</p>
                      <p className="text-xs text-muted-foreground">unbillable</p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${billablePct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatHours(stats.billableHours)} billable · {formatHours(stats.unbillableHours)} unbillable
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">No sessions scheduled yet</p>
              )}
            </div>

            {/* Cancellations */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-3">
                <XCircle size={14} className="text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancellations</span>
              </div>
              <p className="text-3xl font-semibold text-foreground">{stats.cancellations}</p>
              <p className="text-xs text-muted-foreground mt-1">Sessions cancelled this week</p>
            </div>
          </div>
        </div>

        {/* Activity Chart */}
        <DashboardChart data={chartData} />

        {/* Provider Summary */}
        <ProviderSummaryTable data={providerSummaryData} />

        {/* Expiring Authorizations */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={15} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-foreground">Authorizations Expiring Within 30 Days</h2>
          </div>

          {expiringSoon.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No authorizations expiring in the next 30 days.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {expiringSoon.map((auth) => {
                const days = daysUntil(auth.endDate);
                const urgency = days <= 7 ? "text-red-600 font-semibold" : "text-amber-600 font-medium";
                return (
                  <div key={auth.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                    <div>
                      <Link href={`/clients/${auth.client.id}`} className="text-sm font-medium hover:underline">
                        {auth.client.lastName}, {auth.client.firstName}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {auth.serviceCode ?? "All services"}
                        {auth.fundingSource && ` · ${auth.fundingSource}`}
                        {" · "}Expires {formatDate(auth.endDate)}
                      </p>
                    </div>
                    <span className={`text-xs shrink-0 ${urgency}`}>
                      {days === 0 ? "Expires today" : `${days}d left`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
