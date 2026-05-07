// Adds a "Daycare" SessionType row.
// Daycare is a billable, 1:1 RBT session type delivered at the center — not a medical/therapy
// service, so it carries no CPT/service code. Idempotent: safe to re-run.
//
// Run with: npx tsx prisma/scripts/seed-daycare-session-type.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.sessionType.findUnique({ where: { name: "Daycare" } });
  if (existing) {
    console.log(`Daycare session type already exists (id=${existing.id}). Nothing to do.`);
    return;
  }
  const created = await prisma.sessionType.create({
    data: {
      name: "Daycare",
      serviceCode: null,
      billable: true,
      requiresBcba: false,
    },
  });
  console.log(`Created Daycare session type (id=${created.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
