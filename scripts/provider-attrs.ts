import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.provider.findMany({
    where: { status: "ACTIVE" },
    include: { availability: true },
    orderBy: { lastName: "asc" }
  });

  console.log("ALL ACTIVE PROVIDERS");
  console.log("Name                  | Pos   | Lvl | Gender | Spanish | Days available");
  console.log("-".repeat(90));
  for (const p of providers) {
    const days = [...new Set(p.availability.map(a => a.dayOfWeek.slice(0,3)))].join(",");
    console.log(
      `${(p.lastName+", "+p.firstName).padEnd(22)}| ${p.position.padEnd(5)} | ${(p.rbtLevel??"-").padEnd(3)} | ${(p.gender??"?").padEnd(6)} | ${String(p.spanish).padEnd(7)} | ${days}`
    );
  }

  // Female providers specifically
  console.log("\n\nFEMALE PROVIDERS:");
  const female = providers.filter(p => p.gender === "F");
  for (const p of female) {
    console.log(`  ${p.lastName}, ${p.firstName} [${p.position} ${p.rbtLevel ?? ""}] spanish=${p.spanish}`);
    for (const a of p.availability) {
      console.log(`    ${a.dayOfWeek} ${a.startTime}-${a.endTime}`);
    }
  }

  // RBT Level II+ providers
  console.log("\n\nRBT LEVEL II+ PROVIDERS:");
  const lvl2plus = providers.filter(p => {
    const LEVELS = ["I","II","III","IV"];
    return p.rbtLevel && LEVELS.indexOf(p.rbtLevel) >= 1;
  });
  for (const p of lvl2plus) {
    const days = p.availability.map(a => a.dayOfWeek.slice(0,3)+":"+a.startTime+"-"+a.endTime).join(" | ");
    console.log(`  ${p.lastName}, ${p.firstName} [Lvl ${p.rbtLevel}] ${days}`);
  }

  // Female + Spanish + RBT≥II (Rivera Alexia pool)
  console.log("\n\nFEMALE + SPANISH + RBT≥II (Rivera Alexia eligible pool):");
  const pool = providers.filter(p => {
    const LEVELS = ["I","II","III","IV"];
    const lvlOk = p.rbtLevel && LEVELS.indexOf(p.rbtLevel) >= 1;
    return p.gender === "F" && p.spanish && lvlOk;
  });
  for (const p of pool) {
    const days = p.availability.map(a => a.dayOfWeek.slice(0,3)+":"+a.startTime+"-"+a.endTime).join(" | ");
    console.log(`  ${p.lastName}, ${p.firstName} [${p.position} Lvl ${p.rbtLevel}] | ${days}`);
  }
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); process.exit(1); });
