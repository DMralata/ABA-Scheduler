/**
 * audit-week.ts
 * Runs the AUDIT_GOD four-pass schedule audit directly against the DB,
 * bypassing HTTP auth — for CLI/admin use only.
 *
 * Usage: npx tsx --env-file=.env.local scripts/audit-week.ts
 */

import { PrismaClient, DayOfWeek } from "@prisma/client";
import { getWeekBoundaries } from "../src/lib/utils";

const prisma = new PrismaClient();
const WEEKDAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function sessionHrs(s: Date, e: Date) { return (e.getTime() - s.getTime()) / 3_600_000; }

async function main() {
  const center = await prisma.center.findFirst({ select: { id: true, name: true, timezone: true } });
  if (!center) { console.error("No center found"); process.exit(1); }

  const timezone = center.timezone;
  const dateObj = new Date("2026-04-07T12:00:00Z");
  const { weekStart, weekEnd } = getWeekBoundaries(dateObj, timezone);

  console.log(`\nAudit: ${center.name} — Week of ${weekStart.toDateString()} → ${weekEnd.toDateString()}`);

  const [centerProviders, centerClients] = await Promise.all([
    prisma.provider.findMany({
      where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true, position: true,
        availability: { where: { dayOfWeek: { in: WEEKDAYS } }, select: { dayOfWeek: true, startTime: true, endTime: true } },
      },
    }),
    prisma.client.findMany({
      where: {
        AND: [
          { OR: [{ centerId: center.id }, { centerId: null }] },
          { OR: [{ terminationDate: null }, { terminationDate: { gt: weekStart } }] },
        ],
      },
      select: {
        id: true, firstName: true, lastName: true,
        authorizations: {
          where: { startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
          orderBy: { startDate: "desc" },
          take: 1,
          select: { id: true, approvedHoursPerWeek: true, endDate: true, serviceCode: true },
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
        id: true, providerId: true, clientId: true, authorizationId: true,
        startTime: true, endTime: true, billable: true, locationType: true, notes: true,
        provider: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
        sessionType: { select: { name: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [{ clientId: { in: clientIds } }, { providerId: { in: providerIds } }],
        status: "PENDING",
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { clientId: true, providerId: true, authorizationId: true, startTime: true, endTime: true },
    }),
  ]);

  const driveTimeSessions = weekSessions.filter((s) => s.sessionType?.name === "Drive Time");
  const therapySessions = weekSessions.filter((s) => s.sessionType?.name !== "Drive Time");

  // ── PASS 1: COMPLIANCE ──────────────────────────────────────────────────────
  type Violation = { clientName: string; providerName: string; rule: string; detail: string; severity: "CRITICAL" | "HIGH" };
  const violations: Violation[] = [];

  // Provider double-booking
  const sessionsByProvider = new Map<string, typeof therapySessions>();
  for (const s of therapySessions) {
    if (!sessionsByProvider.has(s.providerId)) sessionsByProvider.set(s.providerId, []);
    sessionsByProvider.get(s.providerId)!.push(s);
  }
  for (const [, sessions] of sessionsByProvider) {
    const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endTime > sorted[i + 1].startTime) {
        violations.push({
          clientName: sorted[i].client ? `${sorted[i].client!.lastName}, ${sorted[i].client!.firstName}` : "Unknown",
          providerName: `${sorted[i].provider.lastName}, ${sorted[i].provider.firstName}`,
          rule: "No provider double-booking",
          detail: `${sorted[i].provider.lastName} overlaps: ${sorted[i].client?.lastName ?? "?"} and ${sorted[i + 1].client?.lastName ?? "?"}`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // Client double-booking
  const sessionsByClient = new Map<string, typeof therapySessions>();
  for (const s of therapySessions) {
    if (!s.clientId) continue;
    if (!sessionsByClient.has(s.clientId)) sessionsByClient.set(s.clientId, []);
    sessionsByClient.get(s.clientId)!.push(s);
  }
  for (const [, sessions] of sessionsByClient) {
    const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].endTime > sorted[i + 1].startTime) {
        violations.push({
          clientName: sorted[i].client ? `${sorted[i].client!.lastName}, ${sorted[i].client!.firstName}` : "Unknown",
          providerName: sorted[i].provider.lastName,
          rule: "No client double-booking",
          detail: `${sorted[i].client?.lastName ?? "?"} has overlapping sessions`,
          severity: "CRITICAL",
        });
      }
    }
  }

  // Auth hours exceeded
  const hoursByAuth = new Map<string, number>();
  for (const s of therapySessions) {
    if (!s.authorizationId || !s.billable) continue;
    hoursByAuth.set(s.authorizationId, (hoursByAuth.get(s.authorizationId) ?? 0) + sessionHrs(s.startTime, s.endTime));
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

  // Travel compliance
  const homeSessionsByProvider = new Map<string, typeof therapySessions>();
  for (const s of therapySessions) {
    if (s.locationType !== "HOME" || !s.clientId) continue;
    if (!homeSessionsByProvider.has(s.providerId)) homeSessionsByProvider.set(s.providerId, []);
    homeSessionsByProvider.get(s.providerId)!.push(s);
  }
  let homePairsTotal = 0, homePairsCovered = 0;
  const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
  for (const [, sessions] of homeSessionsByProvider) {
    const sorted = [...sessions].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (a.endTime >= b.startTime) continue;
      if (fmtDay(a.startTime) !== fmtDay(b.startTime)) continue;
      homePairsTotal++;
      const dtSession = driveTimeSessions.find(
        d => d.providerId === a.providerId && Math.abs(d.startTime.getTime() - a.endTime.getTime()) <= 60_000
      );
      homePairsCovered++;
      if (dtSession?.notes) {
        try {
          const meta = JSON.parse(dtSession.notes) as { driveMinutes?: number };
          const gapMins = (b.startTime.getTime() - a.endTime.getTime()) / 60_000;
          if (meta.driveMinutes && gapMins < meta.driveMinutes) {
            violations.push({
              clientName: a.client ? `${a.client.lastName}, ${a.client.firstName}` : "Unknown",
              providerName: `${a.provider.lastName}, ${a.provider.firstName}`,
              rule: "Sufficient gap required for drive time",
              detail: `${a.provider.lastName}: gap ${gapMins.toFixed(0)} min < drive ${meta.driveMinutes} min`,
              severity: "HIGH",
            });
          }
        } catch { /* skip */ }
      }
    }
  }

  // ── PASS 2: RBT UTILIZATION ─────────────────────────────────────────────────
  const rbtProviders = centerProviders.filter((p) => p.position === "RBT");
  const rbtIdSet = new Set(rbtProviders.map((p) => p.id));

  const rbtHoursScheduled = new Map<string, number>();
  for (const s of therapySessions) {
    if (!rbtIdSet.has(s.providerId) || !s.billable) continue;
    rbtHoursScheduled.set(s.providerId, (rbtHoursScheduled.get(s.providerId) ?? 0) + sessionHrs(s.startTime, s.endTime));
  }
  for (const p of weekProposals) {
    if (!rbtIdSet.has(p.providerId)) continue;
    rbtHoursScheduled.set(p.providerId, (rbtHoursScheduled.get(p.providerId) ?? 0) + sessionHrs(p.startTime, p.endTime));
  }

  const rbtReport = rbtProviders.map((p) => {
    const availableHours = p.availability.reduce(
      (sum, a) => sum + (parseHHMM(a.endTime) - parseHHMM(a.startTime)) / 60, 0
    );
    const scheduled = rbtHoursScheduled.get(p.id) ?? 0;
    const utilizationPct = availableHours > 0 ? Math.round((scheduled / availableHours) * 1000) / 10 : 0;
    return {
      name: `${p.lastName}, ${p.firstName}`,
      availableHours: Math.round(availableHours * 10) / 10,
      scheduledHours: Math.round(scheduled * 10) / 10,
      utilizationPct,
      gapHours: Math.round(Math.max(0, availableHours - scheduled) * 10) / 10,
    };
  }).sort((a, b) => a.utilizationPct - b.utilizationPct);

  const totalAvailable = rbtReport.reduce((s, r) => s + r.availableHours, 0);
  const totalScheduled = rbtReport.reduce((s, r) => s + r.scheduledHours, 0);
  const aggregateUtilization = totalAvailable > 0 ? Math.round((totalScheduled / totalAvailable) * 1000) / 10 : 0;
  const hoursLeftOnTable = Math.max(0, totalAvailable - totalScheduled);

  // ── PASS 3: CLIENT COVERAGE ─────────────────────────────────────────────────
  const authBillableHours = new Map<string, number>();
  for (const s of therapySessions) {
    if (!s.authorizationId || !s.billable) continue;
    authBillableHours.set(s.authorizationId, (authBillableHours.get(s.authorizationId) ?? 0) + sessionHrs(s.startTime, s.endTime));
  }
  for (const p of weekProposals) {
    if (!p.authorizationId) continue;
    authBillableHours.set(p.authorizationId, (authBillableHours.get(p.authorizationId) ?? 0) + sessionHrs(p.startTime, p.endTime));
  }

  const now = new Date();
  const clientsWithAuth = centerClients.filter((c) => c.authorizations.length > 0);
  const coverageReport = clientsWithAuth.map((c) => {
    const auth = c.authorizations[0];
    const scheduled = authBillableHours.get(auth.id) ?? 0;
    const coveragePct = auth.approvedHoursPerWeek > 0 ? Math.round((scheduled / auth.approvedHoursPerWeek) * 1000) / 10 : 0;
    const status = coveragePct >= 90 ? "OPTIMAL" : coveragePct >= 70 ? "ACCEPTABLE" : "UNDER_SERVED";
    const daysUntilExpiry = Math.ceil((auth.endDate.getTime() - now.getTime()) / 86_400_000);
    const flags: string[] = [];
    if (coveragePct < 70) flags.push("Under-served <70%");
    if (scheduled === 0) flags.push("No sessions scheduled");
    if (daysUntilExpiry >= 0 && daysUntilExpiry <= 30) flags.push(`Auth expires in ${daysUntilExpiry} days`);
    return { name: `${c.lastName}, ${c.firstName}`, authorizedWeekly: auth.approvedHoursPerWeek, scheduledHours: Math.round(scheduled * 10) / 10, coveragePct, status, authExpiry: auth.endDate.toISOString().slice(0, 10), daysUntilExpiry, flags };
  }).sort((a, b) => a.coveragePct - b.coveragePct);

  const fullyCovered = coverageReport.filter((c) => c.coveragePct >= 90).length;
  const underServed = coverageReport.filter((c) => c.coveragePct < 70).length;
  const overServed = coverageReport.filter((c) => c.coveragePct > 105).length;

  // ── PASS 4: SCORE ──────────────────────────────────────────────────────────
  const criticalCount = violations.filter((v) => v.severity === "CRITICAL").length;
  const highCount = violations.filter((v) => v.severity === "HIGH").length;
  const complianceScore = criticalCount > 0 ? 0 : highCount > 0 ? Math.max(0, 100 - highCount * 15) : 100;
  const utilizationScore = Math.min(100, aggregateUtilization);
  const coverageScore = clientsWithAuth.length > 0 ? Math.round((fullyCovered / clientsWithAuth.length) * 100) : 100;

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
    let consistent = 0, total = 0;
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

  const travelScore = homePairsTotal === 0 ? 100 : Math.round((homePairsCovered / homePairsTotal) * 100);
  const compositeScore = Math.round(complianceScore * 0.30 + utilizationScore * 0.30 + coverageScore * 0.25 + consistencyScore * 0.10 + travelScore * 0.05);
  const scoreLabel = compositeScore >= 90 ? "Excellent" : compositeScore >= 75 ? "Good" : compositeScore >= 60 ? "Fair" : "Poor";

  // ── PRINT REPORT ──────────────────────────────────────────────────────────
  const hr = "═".repeat(64);
  console.log(`\n${hr}`);
  console.log("SCHEDULE AUDIT REPORT — AUDIT_GOD.md");
  console.log(`Week of: Apr 6 – Apr 10, 2026  |  Generated: ${new Date().toLocaleString()}`);
  console.log(`Sessions (SCHEDULED): ${therapySessions.length}  |  Proposals (PENDING): ${weekProposals.length}`);
  console.log(`${hr}`);
  console.log(`\nOVERALL SCORE: ${compositeScore}/100 — ${scoreLabel}`);

  console.log(`\n${"─".repeat(64)}`);
  console.log("PASS 1 — COMPLIANCE");
  console.log(`─`.repeat(64));
  console.log(`Result: ${violations.length === 0 ? "PASS ✓" : "FAIL ✗"}  |  Violations: ${violations.length}`);
  for (const v of violations) {
    console.log(`\n  [${v.severity}] ${v.rule}`);
    console.log(`    Client:  ${v.clientName}`);
    console.log(`    Detail:  ${v.detail}`);
  }
  if (violations.length === 0) console.log("  No violations found.");

  console.log(`\n${"─".repeat(64)}`);
  console.log("PASS 2 — RBT UTILIZATION");
  console.log(`─`.repeat(64));
  for (const r of rbtReport) {
    const bar = "█".repeat(Math.round(r.utilizationPct / 5));
    console.log(`  ${r.name.padEnd(22)} ${String(r.scheduledHours + "h").padStart(5)}/${r.availableHours}h  ${String(r.utilizationPct + "%").padStart(6)}  ${bar}`);
  }
  console.log(`  ${"─".repeat(58)}`);
  console.log(`  ${"AGGREGATE".padEnd(22)} ${String(Math.round(totalScheduled * 10) / 10 + "h").padStart(5)}/${Math.round(totalAvailable * 10) / 10}h  ${String(aggregateUtilization + "%").padStart(6)}`);
  console.log(`  Hours left on table: ${hoursLeftOnTable.toFixed(1)}h`);

  console.log(`\n${"─".repeat(64)}`);
  console.log("PASS 3 — CLIENT COVERAGE");
  console.log(`─`.repeat(64));
  console.log(`  ${"Client".padEnd(22)} ${"Sched".padStart(6)} ${"Auth".padStart(6)} ${"Cov%".padStart(7)}  Status`);
  console.log(`  ${"─".repeat(58)}`);
  for (const c of coverageReport) {
    const flagStr = c.flags.length > 0 ? `  ← ${c.flags.join(", ")}` : "";
    const statusIcon = c.status === "OPTIMAL" ? "✓" : c.status === "ACCEPTABLE" ? "~" : "✗";
    console.log(`  ${statusIcon} ${c.name.padEnd(21)} ${String(c.scheduledHours + "h").padStart(6)} ${String(c.authorizedWeekly + "h").padStart(6)} ${String(c.coveragePct + "%").padStart(7)}${flagStr}`);
  }
  console.log(`\n  Summary: ${fullyCovered} optimal (≥90%) | ${coverageReport.filter(c => c.coveragePct >= 70 && c.coveragePct < 90).length} acceptable (70–89%) | ${underServed} under-served (<70%) | ${overServed} over-served (>105%)`);

  console.log(`\n${"─".repeat(64)}`);
  console.log("PASS 4 — SCORE BREAKDOWN");
  console.log(`─`.repeat(64));
  console.log(`  Compliance:           ${complianceScore}/100  (weight 30%)`);
  console.log(`  RBT Utilization:      ${utilizationScore}/100  (weight 30%)`);
  console.log(`  Client Coverage:      ${coverageScore}/100  (weight 25%)`);
  console.log(`  Provider Consistency: ${consistencyScore}/100  (weight 10%)`);
  console.log(`  Travel Efficiency:    ${travelScore}/100  (weight 5%)`);
  console.log(`\n  COMPOSITE SCORE: ${compositeScore}/100 — ${scoreLabel}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
