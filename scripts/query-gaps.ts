/**
 * query-gaps.ts
 * For each under-served/partially scheduled client:
 *   1. Shows day-by-day coverage from the approved provider list
 *   2. Flags days with no approved provider with ≥4h overlap (gap days)
 *   3. Lists providers NOT on the list who could fill those gaps
 *   4. Flags approved providers with partial (< 4h) time overlaps
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const TARGET_LAST_NAMES = ["Clark", "Rivera", "Thompson", "Johnson", "Jackson", "Williams"];
const TODAY = new Date("2026-04-27T12:00:00Z");
const DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"] as const;
const LEVELS = ["I","II","III","IV"] as const;

function mins(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

async function main() {
  const center = await prisma.center.findFirst();
  if (!center) { console.error("No center"); process.exit(1); }

  const allProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId: center.id }, { centerId: null }], status: "ACTIVE" },
    include: { availability: true },
    orderBy: { lastName: "asc" }
  });

  const clients = await prisma.client.findMany({
    where: {
      AND: [
        { OR: [{ centerId: center.id }, { centerId: null }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gt: TODAY } }] },
        { lastName: { in: TARGET_LAST_NAMES } },
      ]
    },
    include: {
      availability: true,
      approvedHomeProviders: {
        where: { endDate: null },
        include: {
          provider: { include: { availability: true } }
        }
      },
      authorizations: {
        where: { startDate: { lte: TODAY }, endDate: { gte: TODAY } },
        orderBy: { startDate: "desc" },
        take: 1
      }
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
  });

  for (const client of clients) {
    const authHrs = client.authorizations[0]?.approvedHoursPerWeek ?? 0;
    const approvedIds = new Set(client.approvedHomeProviders.map(ah => ah.provider.id));

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${client.lastName}, ${client.firstName} | [${client.preferredLocation}] | auth=${authHrs}h/wk`);
    console.log(`  RBT≥${client.minimumRbtLevel ?? "any"} | female=${client.femaleProviderOnly} | spanish=${client.spanish}`);
    console.log(`  Availability: ${client.availability.map(a => `${a.dayOfWeek.slice(0,3)} ${a.startTime}-${a.endTime}`).join(" | ")}`);

    // ── Day-by-day coverage ─────────────────────────────────────────────────
    const gapDays: string[] = [];
    console.log(`\n  COVERAGE:`);
    for (const day of DAYS) {
      const ca = client.availability.find(a => a.dayOfWeek === day);
      if (!ca) { console.log(`    ${day.slice(0,3)}: client not available`); continue; }
      const cS = mins(ca.startTime), cE = mins(ca.endTime);

      const ok: string[] = [];
      const partial: string[] = [];
      for (const ah of client.approvedHomeProviders) {
        const p = ah.provider;
        const pa = p.availability.find(a => a.dayOfWeek === day);
        if (!pa) continue;
        const overlap = Math.min(cE, mins(pa.endTime)) - Math.max(cS, mins(pa.startTime));
        if (overlap >= 240) ok.push(p.lastName);
        else if (overlap > 0) partial.push(`${p.lastName}(${overlap}min)`);
      }

      if (ok.length === 0) {
        console.log(`    ${day.slice(0,3)}: *** GAP *** ${partial.length > 0 ? `(partial: ${partial.join(", ")})` : "(no overlap)"}`);
        gapDays.push(day);
      } else {
        console.log(`    ${day.slice(0,3)}: ${ok.join(", ")}${partial.length > 0 ? ` | partial: ${partial.join(", ")}` : ""}`);
      }
    }

    // ── Candidates to add ───────────────────────────────────────────────────
    if (gapDays.length > 0) {
      const candidates: string[] = [];
      for (const prov of allProviders) {
        if (approvedIds.has(prov.id)) continue;

        // Hard constraints
        if (client.minimumRbtLevel) {
          const reqIdx = LEVELS.indexOf(client.minimumRbtLevel as typeof LEVELS[number]);
          const pIdx = prov.rbtLevel ? LEVELS.indexOf(prov.rbtLevel as typeof LEVELS[number]) : -1;
          if (pIdx < reqIdx) continue;
        }
        if (client.femaleProviderOnly && prov.gender !== "F") continue;
        if (client.spanish && !prov.spanish) continue;

        const fills: string[] = [];
        for (const day of gapDays) {
          const ca = client.availability.find(a => a.dayOfWeek === day);
          if (!ca) continue;
          const cS = mins(ca.startTime), cE = mins(ca.endTime);
          const pa = prov.availability.find(a => a.dayOfWeek === day);
          if (!pa) continue;
          if (Math.min(cE, mins(pa.endTime)) - Math.max(cS, mins(pa.startTime)) >= 240) {
            fills.push(day.slice(0,3));
          }
        }
        if (fills.length > 0) {
          candidates.push(`    ADD: ${prov.lastName}, ${prov.firstName} [${prov.position} ${prov.rbtLevel ?? ""}] — covers gap on: ${fills.join(", ")}`);
        }
      }
      if (candidates.length > 0) {
        console.log(`\n  PROVIDERS TO ADD (not on list, pass constraints, fill gaps):`);
        candidates.forEach(c => console.log(c));
      } else {
        console.log(`\n  NO ELIGIBLE CANDIDATES found for gap days — availability window adjustment needed`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
