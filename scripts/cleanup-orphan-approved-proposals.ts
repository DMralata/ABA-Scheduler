/**
 * One-shot cleanup for orphan APPROVED ProposedSession rows whose backing
 * Session was later cancelled.
 *
 * Background: prior to the 2026-05-12 fix, cancelSession / cancelRestOfDay
 * marked the Session CANCELLED but never updated the linked ProposedSession.
 * That left "approved" proposals on the books whose hours kept inflating
 * usedHoursThisWeek in the auto-scheduler, so the cancellation-switch logic
 * was unreachable for any client whose budget appeared full.
 *
 * Run once after deploying the fix:
 *   npx tsx scripts/cleanup-orphan-approved-proposals.ts
 */

import { prisma } from "../src/lib/prisma";

async function main() {
  const orphans = await prisma.proposedSession.findMany({
    where: {
      status: "APPROVED",
      session: { status: "CANCELLED" },
    },
    select: {
      id: true,
      clientId: true,
      providerId: true,
      startTime: true,
      endTime: true,
    },
  });

  console.log(`Found ${orphans.length} orphan APPROVED proposals tied to CANCELLED sessions.`);
  if (orphans.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  const sampleSize = Math.min(orphans.length, 10);
  console.log(`First ${sampleSize}:`);
  for (const p of orphans.slice(0, sampleSize)) {
    console.log(
      `  proposal=${p.id}  client=${p.clientId}  provider=${p.providerId}  ${p.startTime.toISOString()} → ${p.endTime.toISOString()}`,
    );
  }

  const result = await prisma.proposedSession.updateMany({
    where: { id: { in: orphans.map((o) => o.id) } },
    data: {
      status: "REJECTED",
      rejectionReason: "Backfill: session cancelled (orphan cleanup)",
      rejectedAt: new Date(),
    },
  });

  console.log(`Updated ${result.count} proposals to REJECTED.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
