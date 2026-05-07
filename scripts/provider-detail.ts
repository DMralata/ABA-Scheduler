import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const LEVELS = ["I","II","III","IV"] as const;

async function main() {
  const providers = await prisma.provider.findMany({
    where: { status: "ACTIVE" },
    include: { availability: true },
    orderBy: { lastName: "asc" }
  });

  console.log("Female providers:");
  providers.filter(p => p.gender?.toLowerCase() === "female")
    .forEach(p => console.log(`  ${p.lastName}, ${p.firstName} | Lvl:${p.rbtLevel} | spanish:${p.spanish} | ${p.availability.map(a => a.dayOfWeek.slice(0,3)+":"+a.startTime+"-"+a.endTime).join(" | ")}`));

  console.log("\nFemale+Spanish+Lvl≥II (Rivera Alexia pool):");
  providers.filter(p => p.gender?.toLowerCase()==="female" && p.spanish && p.rbtLevel && LEVELS.indexOf(p.rbtLevel as typeof LEVELS[number]) >= 1)
    .forEach(p => console.log(`  ${p.lastName}, ${p.firstName} | Lvl:${p.rbtLevel}`));

  console.log("\nSantos full availability:");
  const santos = providers.find(p => p.lastName === "Santos");
  santos?.availability.forEach(a => console.log(`  ${a.dayOfWeek} ${a.startTime}-${a.endTime}`));

  console.log("\nJohnson Emma approved list:");
  const emma = await prisma.client.findFirst({
    where: { firstName: "Emma", lastName: "Johnson" },
    include: { approvedHomeProviders: { where: { endDate: null }, include: { provider: { include: { availability: true } } } } }
  });
  emma?.approvedHomeProviders.forEach(ah => {
    const p = ah.provider;
    console.log(`  ${p.lastName}, ${p.firstName} | gender:${p.gender} | Lvl:${p.rbtLevel}`);
    p.availability.forEach(a => console.log(`    ${a.dayOfWeek} ${a.startTime}-${a.endTime}`));
  });
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); process.exit(1); });
