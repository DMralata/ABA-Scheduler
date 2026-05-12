/**
 * One-shot cleanup for PENDING ProposedSession backlog.
 *
 * Each run of /api/scheduler/propose clears the target day's PENDING +
 * APPROVED proposals before re-running, but PENDINGs from OTHER days are
 * left alone (intentionally — they need to be counted for the weekly auth
 * math to work across days). When a user runs auto-schedule on Mon, then
 * Tue, then Wed, etc. without ever approving or rejecting the results, the
 * PENDING backlog grows and starts pushing `usedHoursThisWeek` past every
 * client's authorization limit. checkRemainingHours then rejects every
 * client before the cancellation-switch logic can run.
 *
 * Reports the count first, then deletes. Limited to PENDING (APPROVED stay
 * — they have backing Sessions). Use --week=YYYY-MM-DD to restrict to a
 * single week's range (Mon 00:00 → next Mon 00:00 UTC); otherwise all
 * PENDING proposals are cleared.
 *
 *   npx tsx scripts/cleanup-stale-pending-proposals.ts
 *   npx tsx scripts/cleanup-stale-pending-proposals.ts --week=2026-05-10
 */

import { prisma } from "../src/lib/prisma";

function parseWeekArg(): { gte: Date; lt: Date } | null {
  const arg = process.argv.find((a) => a.startsWith("--week="));
  if (!arg) return null;
  const dateStr = arg.slice("--week=".length);
  const start = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid --week value: ${dateStr}`);
  }
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { gte: start, lt: end };
}

async function main() {
  const range = parseWeekArg();
  const where = range
    ? { status: "PENDING" as const, startTime: range }
    : { status: "PENDING" as const };

  const found = await prisma.proposedSession.findMany({
    where,
    select: { id: true, clientId: true, startTime: true, endTime: true },
    orderBy: { startTime: "asc" },
  });

  console.log(
    range
      ? `Found ${found.length} PENDING proposals in week ${range.gte.toISOString().slice(0, 10)}.`
      : `Found ${found.length} PENDING proposals (all weeks).`,
  );
  if (found.length === 0) return;

  // Per-client tally so the magnitude is obvious before we delete.
  const tally = new Map<string, { hours: number; count: number }>();
  for (const p of found) {
    const hrs = (p.endTime.getTime() - p.startTime.getTime()) / 3_600_000;
    const cur = tally.get(p.clientId) ?? { hours: 0, count: 0 };
    cur.hours += hrs;
    cur.count += 1;
    tally.set(p.clientId, cur);
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1].hours - a[1].hours);
  console.log("Top clients by PENDING hours:");
  for (const [clientId, v] of sorted.slice(0, 10)) {
    console.log(`  client=${clientId}  ${v.count} proposals  ${v.hours.toFixed(1)}h`);
  }

  const result = await prisma.proposedSession.deleteMany({ where });
  console.log(`Deleted ${result.count} PENDING proposals.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
