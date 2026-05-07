import { PrismaClient } from "@prisma/client";

const sessionTypes = [
  { name: "Direct Therapy",     billable: true,  serviceCode: "97153" },
  { name: "BCBA Supervision",   billable: true,  serviceCode: "97155" },
  { name: "Assessment",         billable: true,  serviceCode: null    },
  { name: "Parent Training",    billable: true,  serviceCode: "97156" },
  { name: "Administrative",     billable: false, serviceCode: null    },
  { name: "Driving",            billable: false, serviceCode: null    },
  { name: "Lunch",              billable: false, serviceCode: null    },
  { name: "Break",              billable: false, serviceCode: null    },
  { name: "Nap",                billable: false, serviceCode: null    },
];

const prisma = new PrismaClient();

async function main() {
  const client = await prisma.client.upsert({
    where: { externalId: "000001" },
    update: {},
    create: {
      externalId: "000001",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: new Date("2015-06-12"),
      activeDate: new Date("2024-01-08"),
      terminationDate: null,
      insurance: "Blue Cross Blue Shield",
      street: "4821 Maplewood Drive",
      city: "Portland",
      state: "OR",
      zip: "97201",
      gender: "Male",
      spanish: false,
    },
  });

  console.log("Created test client:", client);

  // Seed a sample authorization for the test client
  await prisma.authorization.upsert({
    where: { id: "seed-auth-000001" },
    update: {},
    create: {
      id: "seed-auth-000001",
      clientId: client.id,
      authNumber: "AUTH-2025-001",
      serviceCode: "97153",
      fundingSource: "Blue Cross Blue Shield",
      approvedHoursPerWeek: 20,
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-12-31"),
    },
  });

  const provider = await prisma.provider.upsert({
    where: { externalId: "000001" },
    update: {},
    create: {
      externalId: "000001",
      firstName: "Jane",
      lastName: "Smith",
      position: "RBT",
      rbtLevel: "II",
      gender: "Female",
      spanish: true,
      street: "1130 NE Broadway St",
      city: "Portland",
      state: "OR",
      zip: "97232",
      payRateHourly: 22.50,
    },
  });

  console.log("Created test provider:", provider);

  const link = await prisma.approvedHome.upsert({
    where: {
      clientId_providerId: {
        clientId: client.id,
        providerId: provider.id,
      },
    },
    update: {},
    create: {
      clientId: client.id,
      providerId: provider.id,
    },
  });

  console.log("Linked client and provider for home visits:", link);

  for (const type of sessionTypes) {
    await prisma.sessionType.upsert({
      where: { name: type.name },
      update: {},
      create: type,
    });
  }

  console.log("Seeded session types:", sessionTypes.map((t) => t.name).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
