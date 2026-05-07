/**
 * fix-coverage-gaps.ts
 *
 * Targeted data fixes to improve schedule coverage for under-served clients:
 *
 * 1. Johnson, Emma — add all female providers to approved HOME list (was: Santos only)
 * 2. Santos, Jamie  — extend Thursday window (12:00→14:00) + add Friday 09:00-14:00
 * 3. Williams, Noah — add OBrien (Level III, passes RBT≥II) to approved HOME list
 * 4. Clark, Jackson, Thompson — add BCBAs/BCaBA (Kim, Patel, Park) as last-resort fallback
 * 5. Williams, Noah — also add Kim/Park/Patel as last-resort
 */
import { PrismaClient, DayOfWeek } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // ── Fetch all relevant people ─────────────────────────────────────────────
  const [emma, clark, jackson, thompson, noahW, santos] = await Promise.all([
    prisma.client.findFirst({ where: { firstName: "Emma", lastName: "Johnson" } }),
    prisma.client.findFirst({ where: { firstName: "Benjamin", lastName: "Clark" } }),
    prisma.client.findFirst({ where: { firstName: "Mia", lastName: "Jackson" } }),
    prisma.client.findFirst({ where: { firstName: "Ava", lastName: "Thompson" } }),
    prisma.client.findFirst({ where: { firstName: "Noah", lastName: "Williams" } }),
    prisma.provider.findFirst({ where: { lastName: "Santos" } }),
  ]);

  const [chen, kim, patel, riveraAlex, rodriguez, vasquez, obrien, park] =
    await Promise.all([
      prisma.provider.findFirst({ where: { firstName: "Ashley", lastName: "Chen" } }),
      prisma.provider.findFirst({ where: { firstName: "Jordan", lastName: "Kim" } }),
      prisma.provider.findFirst({ where: { firstName: "Sarah", lastName: "Patel" } }),
      prisma.provider.findFirst({ where: { firstName: "Alex", lastName: "Rivera" } }),
      prisma.provider.findFirst({ where: { firstName: "Maria", lastName: "Rodriguez" } }),
      prisma.provider.findFirst({ where: { firstName: "Elena", lastName: "Vasquez" } }),
      prisma.provider.findFirst({ where: { firstName: "Chris", lastName: "OBrien" } }),
      prisma.provider.findFirst({ where: { firstName: "David", lastName: "Park" } }),
    ]);

  const required = { emma, clark, jackson, thompson, noahW, santos, chen, kim, patel, riveraAlex, rodriguez, vasquez, obrien, park };
  for (const [name, val] of Object.entries(required)) {
    if (!val) { console.error(`Not found: ${name}`); process.exit(1); }
  }
  // TypeScript narrowing after null check above
  const e = emma!, c = clark!, j = jackson!, t = thompson!, n = noahW!, s = santos!;
  const aChen = chen!, aKim = kim!, aPatel = patel!, aRivera = riveraAlex!, aRodriguez = rodriguez!, aVasquez = vasquez!, aOBrien = obrien!, aPark = park!;

  // Helper: upsert an ApprovedHome record (idempotent — safe to re-run)
  async function addToApproved(clientId: string, providerId: string, label: string) {
    const existing = await prisma.approvedHome.findFirst({ where: { clientId, providerId, endDate: null } });
    if (existing) { console.log(`  skip (already exists): ${label}`); return; }
    await prisma.approvedHome.create({ data: { clientId, providerId } });
    console.log(`  + added: ${label}`);
  }

  // ── 1. Johnson Emma: add all female providers ─────────────────────────────
  console.log("\n[1] Johnson, Emma — adding female providers to approved HOME list:");
  await addToApproved(e.id, aChen.id,     "Chen, Ashley");
  await addToApproved(e.id, aKim.id,      "Kim, Jordan (BCaBA)");
  await addToApproved(e.id, aPatel.id,    "Patel, Sarah (BCBA)");
  await addToApproved(e.id, aRivera.id,   "Rivera, Alex");
  await addToApproved(e.id, aRodriguez.id,"Rodriguez, Maria");
  await addToApproved(e.id, aVasquez.id,  "Vasquez, Elena");

  // ── 2. Santos availability: extend Thursday + add Friday ──────────────────
  console.log("\n[2] Santos, Jamie — aligning Thursday window and adding Friday:");

  // Extend Thursday 09:00-12:00 → 09:00-14:00
  const thuMorning = await prisma.providerAvailability.findFirst({
    where: { providerId: s.id, dayOfWeek: "THURSDAY", startTime: "09:00", endTime: "12:00" }
  });
  if (thuMorning) {
    await prisma.providerAvailability.update({ where: { id: thuMorning.id }, data: { endTime: "14:00" } });
    console.log("  + Thursday 09:00-12:00 → 09:00-14:00");
  } else {
    const existing = await prisma.providerAvailability.findFirst({ where: { providerId: s.id, dayOfWeek: "THURSDAY", startTime: "09:00" } });
    if (existing) {
      console.log(`  skip Thursday (already ${existing.startTime}-${existing.endTime})`);
    } else {
      await prisma.providerAvailability.create({ data: { providerId: s.id, dayOfWeek: "THURSDAY", startTime: "09:00", endTime: "14:00" } });
      console.log("  + Thursday 09:00-14:00 created");
    }
  }

  // Add Friday 09:00-14:00
  const existingFri = await prisma.providerAvailability.findFirst({ where: { providerId: s.id, dayOfWeek: "FRIDAY" } });
  if (!existingFri) {
    await prisma.providerAvailability.create({ data: { providerId: s.id, dayOfWeek: "FRIDAY", startTime: "09:00", endTime: "14:00" } });
    console.log("  + Friday 09:00-14:00 added");
  } else {
    console.log(`  skip Friday (already ${existingFri.startTime}-${existingFri.endTime})`);
  }

  // ── 3. Williams, Noah — add OBrien (Level III, passes RBT≥II) ────────────
  console.log("\n[3] Williams, Noah — adding OBrien and BCBAs/BCaBA:");
  await addToApproved(n.id, aOBrien.id, "OBrien, Chris (Level III)");
  await addToApproved(n.id, aKim.id,   "Kim, Jordan (BCaBA)");
  await addToApproved(n.id, aPark.id,  "Park, David (BCBA)");
  await addToApproved(n.id, aPatel.id, "Patel, Sarah (BCBA)");

  // ── 4. Clark, Jackson, Thompson — add BCBAs/BCaBA as last-resort ─────────
  console.log("\n[4] Clark, Jackson, Thompson — adding Kim/Patel/Park as last-resort:");
  for (const [client, name] of [[c, "Clark"], [j, "Jackson"], [t, "Thompson"]] as [typeof c, string][]) {
    console.log(`  ${name}:`);
    await addToApproved(client.id, aKim.id,   "Kim, Jordan (BCaBA)");
    await addToApproved(client.id, aPatel.id, "Patel, Sarah (BCBA)");
    await addToApproved(client.id, aPark.id,  "Park, David (BCBA)");
  }

  console.log("\nDone. Run the simulation to validate.");
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
