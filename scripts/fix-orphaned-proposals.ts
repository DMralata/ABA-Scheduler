/**
 * Fix orphaned APPROVED proposals — proposals that were approved but have no
 * linked sessionId (session was never created or was later deleted).
 * These ghost approvals block provider timelines without any real session backing them.
 *
 * Usage: npx tsx scripts/fix-orphaned-proposals.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(dryRun ? "=== DRY RUN — no changes will be made ===\n" : "=== FIXING orphaned APPROVED proposals ===\n");

  // Find all APPROVED proposals with no linked session
  const orphaned = await prisma.proposedSession.findMany({
    where: {
      status: "APPROVED",
      sessionId: null,
    },
    include: {
      client: { select: { firstName: true, lastName: true } },
      provider: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startTime: "asc" },
  });

  if (orphaned.length === 0) {
    console.log("No orphaned APPROVED proposals found. Nothing to fix.");
    return;
  }

  console.log(`Found ${orphaned.length} orphaned APPROVED proposal(s):\n`);
  for (const p of orphaned) {
    const client = p.client ? `${p.clientId ? p.client.lastName + ", " + p.client.firstName : "Unknown client"}` : "Unknown client";
    const provider = p.provider ? `${p.provider.lastName}, ${p.provider.firstName}` : "Unknown provider";
    const start = p.startTime.toISOString().replace("T", " ").slice(0, 16);
    const end = p.endTime.toISOString().replace("T", " ").slice(0, 16);
    console.log(`  [${p.id.slice(-8)}] ${client} ← ${provider} | ${start} → ${end}`);
  }

  if (dryRun) {
    console.log("\nDry run — would REJECT the above proposals. Re-run without --dry-run to apply.");
    return;
  }

  const ids = orphaned.map((p) => p.id);
  const result = await prisma.proposedSession.updateMany({
    where: { id: { in: ids } },
    data: { status: "REJECTED" },
  });

  console.log(`\nMarked ${result.count} orphaned proposal(s) as REJECTED.`);
  console.log("Maria Rodriguez's timeline will now correctly reflect her actual availability.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
