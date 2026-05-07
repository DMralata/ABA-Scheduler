// Test data seed — adds providers, clients, availability windows, authorizations,
// and ApprovedHome links to exercise the Auto Complete scheduler.
//
// Safe to run multiple times — all records use upsert via externalId.
// Run with:  npx tsx prisma/seed-test-data.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Authorization dates: covers a rolling 2-year window so they're always valid
const AUTH_START = new Date(new Date().getFullYear() - 1 + "-01-01");
const AUTH_END   = new Date(new Date().getFullYear() + 1 + "-12-31");

async function main() {
  // ─── Center ──────────────────────────────────────────────────────────────────
  // Find the first center or create a default one
  let center = await prisma.center.findFirst();
  if (!center) {
    center = await prisma.center.create({
      data: {
        name: "Main Center",
        street: "100 Weston Pkwy",
        city: "Cary",
        state: "NC",
        zip: "27513",
        timezone: "America/New_York",
        defaultSessionHours: 4.0,
      },
    });
    console.log("Created center:", center.name);
  } else {
    center = await prisma.center.update({
      where: { id: center.id },
      data: {
        street: "100 Weston Pkwy",
        city: "Cary",
        state: "NC",
        zip: "27513",
        timezone: "America/New_York",
        defaultSessionHours: 4.0,
      },
    });
    console.log("Updated center:", center.name);
  }

  const centerId = center.id;

  // ─── Providers ───────────────────────────────────────────────────────────────
  // Mix of positions, RBT levels, genders, and Spanish-speaking to test constraints

  const providerData = [
    {
      externalId: "TEST-P-001",
      firstName: "Maria",
      lastName: "Rodriguez",
      position: "RBT" as const,
      rbtLevel: "II" as const,
      gender: "Female",
      spanish: true,
      street: "215 SE Maynard Rd",
      city: "Cary",
      state: "NC",
      zip: "27511",
      payRateHourly: 22.0,
      // Availability: Mon–Fri 8am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
    },
    {
      externalId: "TEST-P-002",
      firstName: "Tyler",
      lastName: "Johnson",
      position: "RBT" as const,
      rbtLevel: "I" as const,
      gender: "Male",
      spanish: false,
      street: "780 Chatham St",
      city: "Cary",
      state: "NC",
      zip: "27511",
      payRateHourly: 19.0,
      // Availability: Mon–Thu 9am–6pm, Fri 9am–1pm (limited Friday)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "18:00" },
        { day: "TUESDAY",   start: "09:00", end: "18:00" },
        { day: "WEDNESDAY", start: "09:00", end: "18:00" },
        { day: "THURSDAY",  start: "09:00", end: "18:00" },
        { day: "FRIDAY",    start: "09:00", end: "13:00" },
      ],
    },
    {
      externalId: "TEST-P-003",
      firstName: "Ashley",
      lastName: "Chen",
      position: "RBT" as const,
      rbtLevel: "III" as const,
      gender: "Female",
      spanish: false,
      street: "402 Weston Pkwy",
      city: "Cary",
      state: "NC",
      zip: "27513",
      payRateHourly: 26.0,
      // Availability: Mon–Fri 8am–4pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
    },
    {
      externalId: "TEST-P-004",
      firstName: "Marcus",
      lastName: "Williams",
      position: "RBT" as const,
      rbtLevel: "II" as const,
      gender: "Male",
      spanish: false,
      street: "1055 High House Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      payRateHourly: 22.0,
      // Availability: Tue–Sat 10am–7pm (shifted schedule)
      availability: [
        { day: "TUESDAY",   start: "10:00", end: "19:00" },
        { day: "WEDNESDAY", start: "10:00", end: "19:00" },
        { day: "THURSDAY",  start: "10:00", end: "19:00" },
        { day: "FRIDAY",    start: "10:00", end: "19:00" },
        { day: "SATURDAY",  start: "10:00", end: "15:00" },
      ],
    },
    {
      externalId: "TEST-P-005",
      firstName: "Sarah",
      lastName: "Patel",
      position: "BCBA" as const,
      rbtLevel: null,
      gender: "Female",
      spanish: true,
      street: "320 Evans Rd",
      city: "Cary",
      state: "NC",
      zip: "27513",
      payRateHourly: 65.0,
      // Availability: Mon–Fri 8am–6pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
    },

    // ── New providers ──────────────────────────────────────────────────────────

    {
      externalId: "TEST-P-006",
      firstName: "Jordan",
      lastName: "Kim",
      position: "BCaBA" as const,
      rbtLevel: null,
      gender: "Female",
      spanish: false,
      street: "890 Kildaire Farm Rd",
      city: "Cary",
      state: "NC",
      zip: "27511",
      payRateHourly: 38.0,
      // Availability: Mon–Fri 8am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
    },
    {
      externalId: "TEST-P-007",
      firstName: "Devon",
      lastName: "Brooks",
      position: "RBT" as const,
      rbtLevel: "I" as const,
      gender: "Male",
      spanish: false,
      street: "450 Ten-Ten Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      payRateHourly: 18.0,
      // Availability: Mon–Thu 9am–6pm, Fri 9am–12pm (very limited Friday)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "18:00" },
        { day: "TUESDAY",   start: "09:00", end: "18:00" },
        { day: "WEDNESDAY", start: "09:00", end: "18:00" },
        { day: "THURSDAY",  start: "09:00", end: "18:00" },
        { day: "FRIDAY",    start: "09:00", end: "12:00" },
      ],
    },
    {
      externalId: "TEST-P-008",
      firstName: "Elena",
      lastName: "Vasquez",
      position: "RBT" as const,
      rbtLevel: "II" as const,
      gender: "Female",
      spanish: true,
      street: "1145 Cary Pkwy",
      city: "Cary",
      state: "NC",
      zip: "27511",
      payRateHourly: 23.0,
      // Availability: Mon–Fri 8am–4pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
    },
    {
      externalId: "TEST-P-009",
      firstName: "Chris",
      lastName: "OBrien",
      position: "RBT" as const,
      rbtLevel: "III" as const,
      gender: "Male",
      spanish: false,
      street: "333 Walnut St",
      city: "Cary",
      state: "NC",
      zip: "27511",
      payRateHourly: 27.0,
      // Availability: Tue–Sat 10am–7pm (shifted schedule, adds Saturday depth)
      availability: [
        { day: "TUESDAY",   start: "10:00", end: "19:00" },
        { day: "WEDNESDAY", start: "10:00", end: "19:00" },
        { day: "THURSDAY",  start: "10:00", end: "19:00" },
        { day: "FRIDAY",    start: "10:00", end: "19:00" },
        { day: "SATURDAY",  start: "10:00", end: "16:00" },
      ],
    },
    {
      externalId: "TEST-P-010",
      firstName: "David",
      lastName: "Park",
      position: "BCBA" as const,
      rbtLevel: null,
      gender: "Male",
      spanish: false,
      street: "2220 NW Maynard Rd",
      city: "Cary",
      state: "NC",
      zip: "27513",
      payRateHourly: 68.0,
      // Availability: Mon–Fri 9am–6pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "18:00" },
        { day: "TUESDAY",   start: "09:00", end: "18:00" },
        { day: "WEDNESDAY", start: "09:00", end: "18:00" },
        { day: "THURSDAY",  start: "09:00", end: "18:00" },
        { day: "FRIDAY",    start: "09:00", end: "18:00" },
      ],
    },
  ];

  const providers: Record<string, { id: string; name: string }> = {};

  for (const p of providerData) {
    const record = await prisma.provider.upsert({
      where: { externalId: p.externalId },
      update: { centerId, status: "ACTIVE", street: p.street, city: p.city, state: p.state, zip: p.zip },
      create: {
        externalId: p.externalId,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        rbtLevel: p.rbtLevel,
        gender: p.gender,
        spanish: p.spanish,
        street: p.street,
        city: p.city,
        state: p.state,
        zip: p.zip,
        payRateHourly: p.payRateHourly,
        status: "ACTIVE",
        centerId,
      },
    });

    // Upsert availability windows
    await prisma.providerAvailability.deleteMany({ where: { providerId: record.id } });
    await prisma.providerAvailability.createMany({
      data: p.availability.map((a) => ({
        providerId: record.id,
        dayOfWeek: a.day as import("@prisma/client").DayOfWeek,
        startTime: a.start,
        endTime: a.end,
      })),
    });

    providers[p.externalId] = { id: record.id, name: `${p.firstName} ${p.lastName}` };
    console.log(`Upserted provider: ${p.firstName} ${p.lastName} (${p.position})`);
  }

  // ─── Clients ─────────────────────────────────────────────────────────────────
  // Each client has different constraints to test the scheduler thoroughly.
  // preferredLocation controls HOME vs CENTER session routing.

  const clientData: Array<{
    externalId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
    gender: string;
    spanish: boolean;
    femaleProviderOnly: boolean;
    minimumRbtLevel: "I" | "II" | "III" | null;
    insurance: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    approvedHoursPerWeek: number;
    preferredLocation: "HOME" | "CENTER";
    availability: { day: string; start: string; end: string }[];
    approvedProviders: string[]; // externalIds — only used for HOME clients
  }> = [
    {
      externalId: "TEST-C-001",
      firstName: "Liam",
      lastName: "Torres",
      dateOfBirth: new Date("2018-03-15"),
      gender: "Male",
      spanish: true,            // Spanish-speaking required
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Aetna",
      street: "540 Lochmere Dr N",
      city: "Cary",
      state: "NC",
      zip: "27511",
      approvedHoursPerWeek: 20,
      preferredLocation: "HOME",
      // Availability: Mon–Fri 8am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // Only Spanish-speaking providers can serve: Maria (P-001) or Sarah (P-005)
      approvedProviders: ["TEST-P-001"],
    },
    {
      externalId: "TEST-C-002",
      firstName: "Emma",
      lastName: "Johnson",
      dateOfBirth: new Date("2016-07-22"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: true,  // Female provider required
      minimumRbtLevel: null,
      insurance: "United Healthcare",
      street: "830 Mills Park Dr",
      city: "Cary",
      state: "NC",
      zip: "27513",
      approvedHoursPerWeek: 16,
      preferredLocation: "HOME",
      // Availability: Mon/Wed/Fri 9am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // Approved for home: Ashley (P-003, female) and Maria (P-001, female, Spanish)
      approvedProviders: ["TEST-P-001", "TEST-P-003"],
    },
    {
      externalId: "TEST-C-003",
      firstName: "Noah",
      lastName: "Williams",
      dateOfBirth: new Date("2017-11-08"),
      gender: "Male",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: "II" as const,  // RBT Level II or higher required
      insurance: "Cigna",
      street: "1220 Old Apex Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 25,
      preferredLocation: "HOME",
      // Availability: Tue–Fri 10am–6pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // Tyler (P-002, Level I) will be filtered by the Level II constraint automatically.
      // Broad approved list so multiple Level II+ providers are eligible.
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-004",
      firstName: "Olivia",
      lastName: "Davis",
      dateOfBirth: new Date("2019-01-30"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Blue Cross Blue Shield",
      street: "675 Walnut St",
      city: "Cary",
      state: "NC",
      zip: "27511",
      approvedHoursPerWeek: 20,
      preferredLocation: "HOME",
      // Availability: Mon–Thu 8am–2pm (narrow window)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-005",
      firstName: "Aiden",
      lastName: "Martinez",
      dateOfBirth: new Date("2020-05-14"),
      gender: "Male",
      spanish: false,            // No language constraint
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Medicaid",
      street: "390 Highcroft Dr",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 15,
      preferredLocation: "HOME",
      // Availability: Mon–Wed 9am–5pm (only 3 days)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-006",
      firstName: "Sofia",
      lastName: "Brown",
      dateOfBirth: new Date("2015-09-03"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false,  // No gender constraint
      minimumRbtLevel: null,      // No level constraint
      insurance: "Kaiser",
      street: "1400 Green Level Church Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 18,
      preferredLocation: "HOME",
      // Availability: Mon–Fri 8am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },

    // ── New clients ────────────────────────────────────────────────────────────

    {
      externalId: "TEST-C-007",
      firstName: "Lucas",
      lastName: "Anderson",
      dateOfBirth: new Date("2017-04-20"),
      gender: "Male",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Aetna",
      street: "600 Tryon Rd",
      city: "Cary",
      state: "NC",
      zip: "27511",
      approvedHoursPerWeek: 20,
      preferredLocation: "CENTER",
      // Availability: Mon–Fri 9am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      approvedProviders: [], // CENTER — not enforced
    },
    {
      externalId: "TEST-C-008",
      firstName: "Isabella",
      lastName: "White",
      dateOfBirth: new Date("2019-08-11"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false, // No gender constraint
      minimumRbtLevel: null,
      insurance: "United Healthcare",
      street: "1050 Regency Pkwy Dr",
      city: "Cary",
      state: "NC",
      zip: "27518",
      approvedHoursPerWeek: 15,
      preferredLocation: "CENTER",
      // Availability: Mon/Wed/Fri 8am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      approvedProviders: [], // CENTER — not enforced
    },
    {
      externalId: "TEST-C-009",
      firstName: "Mateo",
      lastName: "Gonzalez",
      dateOfBirth: new Date("2018-12-05"),
      gender: "Male",
      spanish: false,            // No language constraint
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Medicaid",
      street: "425 Cary Towne Blvd",
      city: "Cary",
      state: "NC",
      zip: "27513",
      approvedHoursPerWeek: 20,
      preferredLocation: "HOME",
      // Availability: Mon–Thu 9am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-010",
      firstName: "Ava",
      lastName: "Thompson",
      dateOfBirth: new Date("2016-02-28"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,     // No level constraint
      insurance: "Cigna",
      street: "810 Penny Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 25,
      preferredLocation: "HOME",
      // Availability: Mon–Fri 10am–6pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-011",
      firstName: "Ethan",
      lastName: "Harris",
      dateOfBirth: new Date("2020-06-17"),
      gender: "Male",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Blue Cross Blue Shield",
      street: "1300 Buck Jones Rd",
      city: "Cary",
      state: "NC",
      zip: "27513",
      approvedHoursPerWeek: 12,
      preferredLocation: "CENTER",
      // Availability: Tue–Thu 8am–4pm (narrow mid-week window)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      approvedProviders: [], // CENTER — not enforced
    },
    {
      externalId: "TEST-C-012",
      firstName: "Mia",
      lastName: "Jackson",
      dateOfBirth: new Date("2015-11-30"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Kaiser",
      street: "220 Reedy Creek Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 30,
      preferredLocation: "HOME",
      // Availability: Mon–Fri 8am–6pm (wide window, high hours — stress test)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-013",
      firstName: "James",
      lastName: "Lee",
      dateOfBirth: new Date("2018-07-09"),
      gender: "Male",
      spanish: false,            // No language constraint
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Aetna",
      street: "540 Carpenter Fire Station Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 15,
      preferredLocation: "CENTER",
      // Availability: Mon/Wed/Fri 9am–5pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      approvedProviders: [], // CENTER — not enforced
    },
    {
      externalId: "TEST-C-014",
      firstName: "Charlotte",
      lastName: "Moore",
      dateOfBirth: new Date("2017-03-14"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false, // No gender constraint
      minimumRbtLevel: null,     // No level constraint
      insurance: "United Healthcare",
      street: "155 SW Cary Pkwy",
      city: "Cary",
      state: "NC",
      zip: "27511",
      approvedHoursPerWeek: 20,
      preferredLocation: "HOME",
      // Availability: Mon–Fri 8am–4pm
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-015",
      firstName: "Benjamin",
      lastName: "Clark",
      dateOfBirth: new Date("2014-09-22"),
      gender: "Male",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Cigna",
      street: "970 Green Level West Rd",
      city: "Cary",
      state: "NC",
      zip: "27519",
      approvedHoursPerWeek: 35,  // High hours — tests provider capacity under load
      preferredLocation: "HOME",
      // Availability: Mon–Fri 9am–6pm (wide window needed to absorb drive gap after prior sessions)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "18:00" },
        { day: "TUESDAY",   start: "09:00", end: "18:00" },
        { day: "WEDNESDAY", start: "09:00", end: "18:00" },
        { day: "THURSDAY",  start: "09:00", end: "18:00" },
        { day: "FRIDAY",    start: "09:00", end: "18:00" },
      ],
      // No hard constraints — full RBT pool approved
      approvedProviders: ["TEST-P-001", "TEST-P-002", "TEST-P-003", "TEST-P-004", "TEST-P-007", "TEST-P-008", "TEST-P-009"],
    },
    {
      externalId: "TEST-C-016",
      firstName: "Amelia",
      lastName: "Lewis",
      dateOfBirth: new Date("2021-01-08"),
      gender: "Female",
      spanish: false,
      femaleProviderOnly: false,
      minimumRbtLevel: null,
      insurance: "Medicaid",
      street: "715 Lochmere Dr S",
      city: "Cary",
      state: "NC",
      zip: "27511",
      approvedHoursPerWeek: 18,
      preferredLocation: "CENTER",
      // Availability: Mon–Fri 9am–3pm (short days)
      availability: [
        { day: "MONDAY",    start: "09:00", end: "17:00" },
        { day: "TUESDAY",   start: "09:00", end: "17:00" },
        { day: "WEDNESDAY", start: "09:00", end: "17:00" },
        { day: "THURSDAY",  start: "09:00", end: "17:00" },
        { day: "FRIDAY",    start: "09:00", end: "17:00" },
      ],
      approvedProviders: [], // CENTER — not enforced
    },
  ];

  for (const c of clientData) {
    const record = await prisma.client.upsert({
      where: { externalId: c.externalId },
      update: {
        centerId,
        preferredLocation: c.preferredLocation,
        spanish: c.spanish,
        femaleProviderOnly: c.femaleProviderOnly,
        minimumRbtLevel: c.minimumRbtLevel,
        street: c.street,
        city: c.city,
        state: c.state,
        zip: c.zip,
      },
      create: {
        externalId: c.externalId,
        firstName: c.firstName,
        lastName: c.lastName,
        dateOfBirth: c.dateOfBirth,
        gender: c.gender,
        spanish: c.spanish,
        femaleProviderOnly: c.femaleProviderOnly,
        minimumRbtLevel: c.minimumRbtLevel,
        insurance: c.insurance,
        street: c.street,
        city: c.city,
        state: c.state,
        zip: c.zip,
        activeDate: new Date("2024-01-01"),
        terminationDate: null,
        centerId,
        preferredLocation: c.preferredLocation,
      },
    });

    // Authorization for Direct Therapy (97153)
    await prisma.authorization.upsert({
      where: { id: `seed-auth-${c.externalId}` },
      update: { approvedHoursPerWeek: c.approvedHoursPerWeek, endDate: AUTH_END },
      create: {
        id: `seed-auth-${c.externalId}`,
        clientId: record.id,
        authNumber: `AUTH-${c.externalId}`,
        serviceCode: "97153",
        fundingSource: c.insurance,
        approvedHoursPerWeek: c.approvedHoursPerWeek,
        startDate: AUTH_START,
        endDate: AUTH_END,
      },
    });

    // Availability windows
    await prisma.clientAvailability.deleteMany({ where: { clientId: record.id } });
    await prisma.clientAvailability.createMany({
      data: c.availability.map((a) => ({
        clientId: record.id,
        dayOfWeek: a.day as import("@prisma/client").DayOfWeek,
        startTime: a.start,
        endTime: a.end,
      })),
    });

    // ApprovedHome links — delete existing then re-create from seed list
    // (ensures removed providers don't linger from previous runs)
    await prisma.approvedHome.deleteMany({ where: { clientId: record.id } });
    if (c.preferredLocation === "HOME" && c.approvedProviders.length > 0) {
      for (const provExtId of c.approvedProviders) {
        const provRecord = providers[provExtId];
        if (!provRecord) continue;
        await prisma.approvedHome.create({
          data: { clientId: record.id, providerId: provRecord.id, endDate: null },
        });
      }
    }

    console.log(
      `Upserted client: ${c.firstName} ${c.lastName} [${c.preferredLocation}]` +
      (c.spanish ? " [Spanish]" : "") +
      (c.femaleProviderOnly ? " [Female only]" : "") +
      (c.minimumRbtLevel ? ` [Min Level ${c.minimumRbtLevel}]` : "") +
      (c.preferredLocation === "HOME" && c.approvedProviders.length > 0
        ? ` [${c.approvedProviders.length} approved providers]`
        : c.preferredLocation === "HOME" ? " [no provider restriction]" : "")
    );
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n── Constrained clients (3 total) ───────────────────────────────");
  console.log("Liam Torres      HOME  → Spanish required → Maria (P-001) only");
  console.log("Emma Johnson     HOME  → Female only → Maria, Ashley (P-001, P-003)");
  console.log("Noah Williams    HOME  → Level II+ required → Marcus, Maria, Ashley, Elena");
  console.log("\n── Unconstrained HOME clients ──────────────────────────────────");
  console.log("Olivia Davis     HOME  → No restrictions, Mon–Thu 8am–2pm (narrow)");
  console.log("Aiden Martinez   HOME  → No restrictions, Mon–Wed only");
  console.log("Sofia Brown      HOME  → No restrictions, 18hrs/wk");
  console.log("Mateo Gonzalez   HOME  → No restrictions, Mon–Thu 9am–5pm");
  console.log("Ava Thompson     HOME  → No restrictions, 25hrs/wk, 10am–6pm");
  console.log("Mia Jackson      HOME  → No restrictions, 30hrs/wk (high load)");
  console.log("Charlotte Moore  HOME  → No restrictions, Mon–Fri 8am–4pm");
  console.log("Benjamin Clark   HOME  → No restrictions, 35hrs/wk (stress test)");
  console.log("\n── CENTER clients ──────────────────────────────────────────────");
  console.log("Lucas Anderson   CENTER → No restrictions, Mon–Fri 9am–5pm");
  console.log("Isabella White   CENTER → No restrictions, Mon/Wed/Fri");
  console.log("Ethan Harris     CENTER → No restrictions, Tue–Thu only (narrow)");
  console.log("James Lee        CENTER → No restrictions, Mon/Wed/Fri");
  console.log("Amelia Lewis     CENTER → No restrictions, 9am–3pm short days");
  console.log("\n── Providers ───────────────────────────────────────────────────");
  console.log("Maria Rodriguez  RBT II, Female, Spanish   — Mon–Fri 8am–5pm");
  console.log("Tyler Johnson    RBT I,  Male,   No        — Mon–Thu + Fri half-day");
  console.log("Ashley Chen      RBT III,Female, No        — Mon–Fri 8am–4pm");
  console.log("Marcus Williams  RBT II, Male,   No        — Tue–Sat 10am–7pm");
  console.log("Sarah Patel      BCBA,   Female, Spanish   — Mon–Fri 8am–6pm");
  console.log("Jordan Kim       BCaBA,  Female, No        — Mon–Fri 8am–5pm");
  console.log("Devon Brooks     RBT I,  Male,   No        — Mon–Thu + Fri half-day");
  console.log("Elena Vasquez    RBT II, Female, Spanish   — Mon–Fri 8am–4pm");
  console.log("Chris O'Brien    RBT III,Male,   No        — Tue–Sat 10am–7pm");
  console.log("David Park       BCBA,   Male,   No        — Mon–Fri 9am–6pm");
  console.log("────────────────────────────────────────────────────────────────");
  console.log("Run seed-cary-data.ts next to apply real Cary, NC addresses.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
