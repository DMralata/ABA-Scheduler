/**
 * Adds two test RBTs with staggered schedules to fill CENTER client scheduling gaps.
 *
 * - Rivera, Alex  — morning-heavy (7am–3pm Mon–Fri)
 * - Santos, Jamie — afternoon-heavy (1pm–8pm Mon–Fri)
 *
 * Staggered windows ensure coverage across the full day so CENTER clients
 * aren't left with only Kim Jordan (BCaBA) for afternoon/overflow slots.
 *
 * Usage: npx tsx scripts/seed-extra-rbts.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

const NEW_RBTS = [
  {
    externalId: "TEST-P-011",
    firstName: "Alex",
    lastName: "Rivera",
    position: "RBT" as const,
    rbtLevel: "II" as const,
    gender: "Male",
    spanish: false,
    street: "780 Walnut St",
    city: "Cary",
    state: "NC",
    zip: "27511",
    latitude: 35.7900,
    longitude: -78.7830,
    payRateHourly: 22.0,
    // Morning shift: 7am–3pm
    availability: WEEKDAYS.map((day) => ({ day, start: "07:00", end: "15:00" })),
  },
  {
    externalId: "TEST-P-012",
    firstName: "Jamie",
    lastName: "Santos",
    position: "RBT" as const,
    rbtLevel: "I" as const,
    gender: "Female",
    spanish: true,
    street: "340 High House Rd",
    city: "Cary",
    state: "NC",
    zip: "27513",
    latitude: 35.8010,
    longitude: -78.8060,
    payRateHourly: 20.0,
    // Afternoon shift: 1pm–8pm
    availability: WEEKDAYS.map((day) => ({ day, start: "13:00", end: "20:00" })),
  },
];

async function main() {
  console.log("=== Seeding extra RBT providers ===\n");

  const center = await prisma.center.findFirst();
  if (!center) {
    console.error("No center found — run seed-test-data.ts first.");
    process.exit(1);
  }

  for (const rbt of NEW_RBTS) {
    const { availability, ...providerFields } = rbt;

    const provider = await prisma.provider.upsert({
      where: { externalId: rbt.externalId },
      update: {
        ...providerFields,
        centerId: center.id,
        status: "ACTIVE",
      },
      create: {
        ...providerFields,
        centerId: center.id,
        status: "ACTIVE",
      },
    });

    console.log(`  PROVIDER ✓ ${provider.firstName} ${provider.lastName} (${provider.position}) — upserted`);

    // Replace availability windows (delete then recreate for idempotency)
    await prisma.providerAvailability.deleteMany({ where: { providerId: provider.id } });

    for (const w of availability) {
      await prisma.providerAvailability.create({
        data: {
          providerId: provider.id,
          dayOfWeek: w.day,
          startTime: w.start,
          endTime: w.end,
        },
      });
    }

    const shift = availability[0].start === "07:00" ? "7am–3pm" : "1pm–8pm";
    console.log(`    Availability: Mon–Fri ${shift}\n`);
  }

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
