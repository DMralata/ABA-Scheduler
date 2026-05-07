/**
 * Seeds test clients and providers with real Cary, NC addresses and coordinates,
 * and creates the "Direct Therapy Home" session type.
 *
 * Usage: npx tsx scripts/seed-cary-data.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Cary, NC addresses spread across the city for realistic drive time testing
const CLIENT_ADDRESSES = [
  // Original clients
  { name: ["Liam",      "Torres"],    street: "124 Maynard Crossing Ct",      city: "Cary", state: "NC", zip: "27513", lat: 35.7934, lng: -78.7804 },
  { name: ["Emma",      "Johnson"],   street: "501 Lake Pine Dr",              city: "Cary", state: "NC", zip: "27519", lat: 35.8128, lng: -78.8296 },
  { name: ["Noah",      "Williams"],  street: "305 Colonnade Way",             city: "Cary", state: "NC", zip: "27518", lat: 35.7461, lng: -78.7808 },
  { name: ["Olivia",    "Davis"],     street: "1210 Kildaire Farm Rd",         city: "Cary", state: "NC", zip: "27511", lat: 35.7776, lng: -78.7840 },
  { name: ["Aiden",     "Martinez"],  street: "730 E Chatham St",              city: "Cary", state: "NC", zip: "27511", lat: 35.7889, lng: -78.7795 },
  { name: ["Sofia",     "Brown"],     street: "215 High House Rd",             city: "Cary", state: "NC", zip: "27513", lat: 35.8006, lng: -78.8048 },
  // New clients
  { name: ["Lucas",     "Anderson"],  street: "600 Tryon Rd",                  city: "Cary", state: "NC", zip: "27511", lat: 35.7720, lng: -78.7780 },
  { name: ["Isabella",  "White"],     street: "1050 Regency Pkwy Dr",          city: "Cary", state: "NC", zip: "27518", lat: 35.7490, lng: -78.7720 },
  { name: ["Mateo",     "Gonzalez"],  street: "425 Cary Towne Blvd",           city: "Cary", state: "NC", zip: "27511", lat: 35.7830, lng: -78.7670 },
  { name: ["Ava",       "Thompson"],  street: "810 Penny Rd",                  city: "Cary", state: "NC", zip: "27513", lat: 35.7950, lng: -78.8210 },
  { name: ["Ethan",     "Harris"],    street: "1300 Buck Jones Rd",            city: "Cary", state: "NC", zip: "27511", lat: 35.7630, lng: -78.7910 },
  { name: ["Mia",       "Jackson"],   street: "220 Reedy Creek Rd",            city: "Cary", state: "NC", zip: "27519", lat: 35.8080, lng: -78.8180 },
  { name: ["James",     "Lee"],       street: "540 Carpenter Fire Station Rd", city: "Cary", state: "NC", zip: "27519", lat: 35.8150, lng: -78.8310 },
  { name: ["Charlotte", "Moore"],     street: "155 SW Cary Pkwy",              city: "Cary", state: "NC", zip: "27511", lat: 35.7810, lng: -78.8010 },
  { name: ["Benjamin",  "Clark"],     street: "970 Green Level West Rd",       city: "Cary", state: "NC", zip: "27519", lat: 35.8200, lng: -78.8390 },
  { name: ["Amelia",    "Lewis"],     street: "715 Lochmere Dr S",             city: "Cary", state: "NC", zip: "27518", lat: 35.7410, lng: -78.7830 },
];

const PROVIDER_ADDRESSES = [
  // Original providers
  { name: ["Maria",  "Rodriguez"], street: "200 Walnut St",                 city: "Cary", state: "NC", zip: "27511", lat: 35.7916, lng: -78.7825 },
  { name: ["Tyler",  "Johnson"],   street: "412 N Harrison Ave",            city: "Cary", state: "NC", zip: "27511", lat: 35.7890, lng: -78.7845 },
  { name: ["Ashley", "Chen"],      street: "615 Piney Plains Rd",           city: "Cary", state: "NC", zip: "27518", lat: 35.7571, lng: -78.7688 },
  { name: ["Marcus", "Williams"],  street: "1020 Buck Jones Rd",            city: "Cary", state: "NC", zip: "27511", lat: 35.7682, lng: -78.7892 },
  { name: ["Sarah",  "Patel"],     street: "310 Carpenter Fire Station Rd", city: "Cary", state: "NC", zip: "27519", lat: 35.8163, lng: -78.8287 },
  // New providers
  { name: ["Jordan", "Kim"],       street: "890 Kildaire Farm Rd",          city: "Cary", state: "NC", zip: "27511", lat: 35.7740, lng: -78.7825 },
  { name: ["Devon",  "Brooks"],    street: "450 Ten-Ten Rd",                city: "Cary", state: "NC", zip: "27511", lat: 35.7560, lng: -78.7650 },
  { name: ["Elena",  "Vasquez"],   street: "1145 Cary Pkwy",                city: "Cary", state: "NC", zip: "27513", lat: 35.7980, lng: -78.7940 },
  { name: ["Chris",  "OBrien"],    street: "333 Walnut St",                 city: "Cary", state: "NC", zip: "27511", lat: 35.7870, lng: -78.7820 },
  { name: ["David",  "Park"],      street: "2220 NW Maynard Rd",            city: "Cary", state: "NC", zip: "27513", lat: 35.8040, lng: -78.8120 },
];

async function main() {
  console.log("=== Seeding Cary, NC addresses ===\n");

  // Update clients
  for (const addr of CLIENT_ADDRESSES) {
    const client = await prisma.client.findFirst({
      where: { firstName: addr.name[0], lastName: addr.name[1] },
    });
    if (!client) {
      console.log(`  SKIP (not found): ${addr.name[0]} ${addr.name[1]}`);
      continue;
    }
    await prisma.client.update({
      where: { id: client.id },
      data: { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip, latitude: addr.lat, longitude: addr.lng },
    });
    console.log(`  CLIENT   ✓ ${addr.name[0]} ${addr.name[1]} → ${addr.street}, ${addr.city}, ${addr.state}`);
  }

  console.log("");

  // Update providers
  for (const addr of PROVIDER_ADDRESSES) {
    const provider = await prisma.provider.findFirst({
      where: { firstName: addr.name[0], lastName: addr.name[1] },
    });
    if (!provider) {
      console.log(`  SKIP (not found): ${addr.name[0]} ${addr.name[1]}`);
      continue;
    }
    await prisma.provider.update({
      where: { id: provider.id },
      data: { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip, latitude: addr.lat, longitude: addr.lng },
    });
    console.log(`  PROVIDER ✓ ${addr.name[0]} ${addr.name[1]} → ${addr.street}, ${addr.city}, ${addr.state}`);
  }

  console.log("");

  // Create "Direct Therapy Home" session type if it doesn't exist
  const existing = await prisma.sessionType.findFirst({ where: { name: "Direct Therapy Home" } });
  if (existing) {
    console.log("  SESSION TYPE: 'Direct Therapy Home' already exists — skipping.");
  } else {
    await prisma.sessionType.create({
      data: { name: "Direct Therapy Home", billable: true, requiresBcba: false },
    });
    console.log("  SESSION TYPE ✓ Created 'Direct Therapy Home' (billable: true)");
  }

  console.log("\nDone.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
