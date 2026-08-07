// ─── Billing Export Import (CentralReach) ────────────────────────────────────
// Seeds clients, providers, and a week of sessions from a CentralReach
// "Weekly Billing" CSV export. Richer + more authoritative than the RBT
// schedule workbook: real CentralReach IDs, full names, insurance, exact
// session times, procedure codes, and service locations.
//
// What it does:
//   1. ACTIVE CLIENTS = clients with a 97153 (direct therapy) entry within
//      --active-days (default 14) of the newest date in the file. Existing DB
//      records are matched by CentralReach ID, then full name, then
//      first-name/initial (upgrading stub records from the sheet import) —
//      matched records get their real name, external ID, and insurance.
//   2. ACTIVE PROVIDERS = providers with any entry in the active window.
//      Position: BCBA if they billed 97155/97151, else RBT.
//   3. SESSIONS for the week starting --week-start (Mon, default = the last
//      7 days of data): exact billed times, session type from the procedure
//      code, location from the place-of-service code.
//   4. AVAILABILITY per active client from their billed patterns that week.
//   5. --sync-roster: deactivates active DB clients/providers NOT in the
//      active window (mirrors the app's deactivate actions; nothing deleted).
//
// Usage:
//   npx tsx scripts/import-billing-export.ts \
//     --file "Weekly Billing v7.31.26.csv" [--active-days 14] \
//     [--week-start 2026-07-27] [--sync-roster] [--dry-run]

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const FILE = arg("file");
const ACTIVE_DAYS = parseInt(arg("active-days") ?? "14", 10);
const WEEK_START = arg("week-start"); // Monday YYYY-MM-DD; default = last 7 days of data
const DRY = process.argv.includes("--dry-run");
const SYNC_ROSTER = process.argv.includes("--sync-roster");

if (!FILE) {
  console.error('Usage: npx tsx scripts/import-billing-export.ts --file <csv> [--active-days 14] [--week-start YYYY-MM-DD] [--sync-roster] [--dry-run]');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase();

// CentralReach exports occasionally carry mojibake (UTF-8 read as cp1252).
function cleanName(s: string): string {
  return s
    .replace(/‚Äî/g, "-").replace(/‚Äô/g, "'").replace(/‚Äì/g, "-")
    .replace(/\u2014|\u2013/g, "-").replace(/\u2019/g, "'")
    .replace(/\s+/g, " ").trim();
}

// "7/31/26" → "2026-07-31"
function isoDate(mdy: string): string {
  const [m, d, y] = mdy.split("/").map((x) => parseInt(x, 10));
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Wall-clock "YYYY-MM-DD" + "HH:MM" in tz → UTC Date
function zonedTimeToUtc(dateStr: string, hm: string, timezone: string): Date {
  const naive = new Date(`${dateStr}T${hm.padStart(5, "0")}:00Z`);
  const inZone = new Date(naive.toLocaleString("en-US", { timeZone: timezone }));
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(naive.getTime() + (asUtc.getTime() - inZone.getTime()));
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

const DOW: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
function dayOfWeek(dateStr: string): DayOfWeek {
  return DOW[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
}

// Place-of-service code → app LocationType
function toLocationType(code: string): "HOME" | "CENTER" | "SCHOOL" | null {
  const c = code.trim().replace(/^0/, "");
  if (c === "12" || c === "10") return "HOME"; // home / telehealth-at-home
  if (c === "11") return "CENTER";
  if (c === "3") return "SCHOOL";
  return null; // 99 / blank — leave unset
}

// Procedure code → { sessionTypeName, billable }
function toSessionType(code: string): { name: string; billable: boolean; serviceCode: string | null } {
  const c = code.trim();
  if (c === "97153") return { name: "Direct Therapy", billable: true, serviceCode: "97153" };
  if (c === "97155") return { name: "BCBA Supervision", billable: true, serviceCode: "97155" };
  if (c === "97156") return { name: "Parent Training", billable: true, serviceCode: "97156" };
  if (c === "97151" || c === "97152") return { name: "Assessment", billable: true, serviceCode: null };
  if (/^(9613\d|90791|90792)$/.test(c)) return { name: "Psych Testing", billable: true, serviceCode: null };
  if (/non-?billable/i.test(c)) return { name: "Administrative", billable: false, serviceCode: null };
  if (/training/i.test(c)) return { name: "Staff Training", billable: false, serviceCode: null };
  if (/fieldwork/i.test(c)) return { name: "BACB Fieldwork", billable: false, serviceCode: null };
  return { name: `Other (${c})`, billable: false, serviceCode: null };
}

interface Row {
  dos: string;               // YYYY-MM-DD
  from: string; to: string;  // HH:MM
  clientId: string; clientFirst: string; clientLast: string;
  providerId: string; providerFirst: string; providerLast: string;
  code: string;
  locationCode: string;
  insurance: string;
  timezone: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const wb = XLSX.read(fs.readFileSync(path.resolve(FILE!)), { type: "buffer", raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

  const get = (r: Record<string, string>, k: string) => String(r[k] ?? r["\uFEFF" + k] ?? "").trim();

  const rows: Row[] = [];
  for (const r of raw) {
    if (get(r, "IsVoid") === "TRUE" || get(r, "IsDeleted") === "TRUE") continue;
    const dosRaw = get(r, "DateOfService").split(" ")[0];
    const fromRaw = get(r, "TimeWorkedFrom").split(" ")[1];
    const toRaw = get(r, "TimeWorkedTo").split(" ")[1];
    if (!dosRaw || !fromRaw || !toRaw) continue;
    rows.push({
      dos: isoDate(dosRaw),
      from: fromRaw, to: toRaw,
      clientId: get(r, "ClientId"),
      clientFirst: cleanName(get(r, "ClientFirstName")),
      clientLast: cleanName(get(r, "ClientLastName")),
      providerId: get(r, "ProviderId"),
      providerFirst: cleanName(get(r, "ProviderFirstName")),
      providerLast: cleanName(get(r, "ProviderLastName")),
      code: get(r, "ProcedureCode"),
      locationCode: get(r, "LocationCode"),
      insurance: get(r, "FirstPrimaryInsuranceOnFile") || get(r, "PayorName").replace(/^P:\s*/, ""),
      timezone: get(r, "Timezone") || "America/New_York",
    });
  }
  const maxDate = rows.map((r) => r.dos).sort().at(-1)!;
  const cutoff = addDaysIso(maxDate, -(ACTIVE_DAYS - 1));
  console.log(`Parsed ${rows.length} billing rows. Data through ${maxDate}; active window starts ${cutoff}.`);

  // ── Active sets ────────────────────────────────────────────────────────────
  const activeClientIds = new Set(
    rows.filter((r) => r.code.trim() === "97153" && r.dos >= cutoff).map((r) => r.clientId)
  );
  const activeProviderIds = new Set(rows.filter((r) => r.dos >= cutoff).map((r) => r.providerId));
  // BCBA heuristic: billed supervision or assessment codes anywhere in the file
  const bcbaProviderIds = new Set(
    rows.filter((r) => ["97155", "97151", "97152"].includes(r.code.trim())).map((r) => r.providerId)
  );
  console.log(`Active clients (97153 in last ${ACTIVE_DAYS}d): ${activeClientIds.size}`);
  console.log(`Active providers (any service in last ${ACTIVE_DAYS}d): ${activeProviderIds.size}`);

  const center = await prisma.center.findFirst();
  const timezone = center?.timezone ?? "America/New_York";

  // ── Upsert clients ─────────────────────────────────────────────────────────
  // Latest row per active client for names/insurance; earliest DOS for activeDate.
  const clientRows = new Map<string, { latest: Row; earliestDos: string; locCounts: Record<string, number> }>();
  for (const r of rows) {
    if (!activeClientIds.has(r.clientId)) continue;
    const cur = clientRows.get(r.clientId);
    if (!cur) clientRows.set(r.clientId, { latest: r, earliestDos: r.dos, locCounts: {} });
    else {
      if (r.dos >= cur.latest.dos) cur.latest = r;
      if (r.dos < cur.earliestDos) cur.earliestDos = r.dos;
    }
    if (r.code.trim() === "97153") {
      const lt = toLocationType(r.locationCode) ?? "CENTER";
      clientRows.get(r.clientId)!.locCounts[lt] = (clientRows.get(r.clientId)!.locCounts[lt] ?? 0) + 1;
    }
  }

  const clientDbId = new Map<string, string>(); // CentralReach ClientId -> DB id
  let clientsCreated = 0, clientsUpgraded = 0;
  for (const [crId, info] of clientRows) {
    const { latest, earliestDos, locCounts } = info;
    const home = locCounts["HOME"] ?? 0, centerN = locCounts["CENTER"] ?? 0;
    const preferredLocation =
      home > 0 && centerN > 0 ? "HYBRID" : home > 0 ? "HOME" : (locCounts["SCHOOL"] ?? 0) > centerN ? "SCHOOL" : "CENTER";

    // 1) by CentralReach ID  2) by full name  3) stub upgrade (first name + initial/placeholder)
    let existing = await prisma.client.findUnique({ where: { externalId: crId }, select: { id: true } });
    if (!existing) {
      const byName = await prisma.client.findFirst({
        where: {
          firstName: { equals: latest.clientFirst, mode: "insensitive" },
          lastName: { equals: latest.clientLast, mode: "insensitive" },
        },
        select: { id: true },
      });
      existing = byName;
    }
    if (!existing) {
      const stubs = await prisma.client.findMany({
        where: { firstName: { equals: latest.clientFirst.split(" ")[0], mode: "insensitive" } },
        select: { id: true, lastName: true, externalId: true },
      });
      const stub = stubs.find(
        (s: { lastName: string; externalId: string | null }) =>
          s.lastName === "(Imported)" ||
          /^[A-Za-z]\.$/.test(s.lastName) && latest.clientLast.toUpperCase().startsWith(s.lastName[0].toUpperCase()) ||
          (s.externalId ?? "").startsWith("IMPORT-")
      );
      existing = stub ? { id: stub.id } : null;
      if (stub) clientsUpgraded++;
    }

    if (DRY) { if (!existing) clientsCreated++; continue; }

    if (existing) {
      await prisma.client.update({
        where: { id: existing.id },
        data: {
          externalId: crId,
          firstName: latest.clientFirst,
          lastName: latest.clientLast,
          insurance: latest.insurance || undefined,
          preferredLocation,
          terminationDate: null, // active per billing
          centerId: center?.id ?? undefined,
        },
      });
      clientDbId.set(crId, existing.id);
    } else {
      const created = await prisma.client.create({
        data: {
          externalId: crId,
          firstName: latest.clientFirst,
          lastName: latest.clientLast,
          dateOfBirth: new Date("2018-01-01T00:00:00Z"), // PLACEHOLDER — not in billing export
          gender: "Unknown",                              // PLACEHOLDER
          insurance: latest.insurance || "TBD (imported)",
          activeDate: new Date(`${earliestDos}T00:00:00Z`),
          preferredLocation,
          centerId: center?.id ?? null,
        },
        select: { id: true },
      });
      clientDbId.set(crId, created.id);
      clientsCreated++;
    }
  }

  // ── Upsert providers ───────────────────────────────────────────────────────
  const providerRows = new Map<string, Row>();
  for (const r of rows) {
    if (!activeProviderIds.has(r.providerId)) continue;
    const cur = providerRows.get(r.providerId);
    if (!cur || r.dos >= cur.dos) providerRows.set(r.providerId, r);
  }
  const providerDbId = new Map<string, string>();
  let providersCreated = 0, providersUpgraded = 0;
  for (const [crId, latest] of providerRows) {
    let existing = await prisma.provider.findUnique({ where: { externalId: crId }, select: { id: true } });
    if (!existing) {
      existing = await prisma.provider.findFirst({
        where: {
          firstName: { equals: latest.providerFirst, mode: "insensitive" },
          lastName: { equals: latest.providerLast, mode: "insensitive" },
        },
        select: { id: true },
      });
    }
    if (!existing) {
      const stubs = await prisma.provider.findMany({
        where: { firstName: { equals: latest.providerFirst.split(" ")[0], mode: "insensitive" } },
        select: { id: true, lastName: true },
      });
      const stub = stubs.find(
        (s: { lastName: string }) =>
          s.lastName === "(Imported)" ||
          (/^[A-Za-z]\.$/.test(s.lastName) && latest.providerLast.toUpperCase().startsWith(s.lastName[0].toUpperCase()))
      );
      existing = stub ? { id: stub.id } : null;
      if (stub) providersUpgraded++;
    }

    if (DRY) { if (!existing) providersCreated++; continue; }

    if (existing) {
      await prisma.provider.update({
        where: { id: existing.id },
        data: {
          externalId: crId,
          firstName: latest.providerFirst,
          lastName: latest.providerLast,
          status: "ACTIVE",
          centerId: center?.id ?? undefined,
        },
      });
      providerDbId.set(crId, existing.id);
    } else {
      const created = await prisma.provider.create({
        data: {
          externalId: crId,
          firstName: latest.providerFirst,
          lastName: latest.providerLast,
          position: bcbaProviderIds.has(crId) ? "BCBA" : "RBT",
          gender: "Unknown", // PLACEHOLDER — not in billing export
          status: "ACTIVE",
          centerId: center?.id ?? null,
        },
        select: { id: true },
      });
      providerDbId.set(crId, created.id);
      providersCreated++;
    }
  }

  // ── Session types ──────────────────────────────────────────────────────────
  const typeIds = new Map<string, string>();
  async function typeId(name: string, billable: boolean, serviceCode: string | null): Promise<string | null> {
    if (typeIds.has(name)) return typeIds.get(name)!;
    let t = await prisma.sessionType.findFirst({ where: { name } });
    if (!t && !DRY) t = await prisma.sessionType.create({ data: { name, billable, serviceCode } });
    if (t) typeIds.set(name, t.id);
    return t?.id ?? null;
  }

  // ── Sessions for the target week ───────────────────────────────────────────
  const weekStart = WEEK_START ?? addDaysIso(maxDate, -6);
  const weekEnd = addDaysIso(weekStart, 7);
  const weekRows = rows.filter((r) => r.dos >= weekStart && r.dos < weekEnd);
  console.log(`\nImporting sessions for ${weekStart} .. ${addDaysIso(weekStart, 6)}: ${weekRows.length} billing rows.`);

  let created = 0, skipped = 0, noPerson = 0;
  for (const r of weekRows) {
    const st = toSessionType(r.code);
    const stId = await typeId(st.name, st.billable, st.serviceCode);
    const provider = providerDbId.get(r.providerId);
    const client = clientDbId.get(r.clientId);
    const startTime = zonedTimeToUtc(r.dos, r.from, r.timezone || timezone);
    let endTime = zonedTimeToUtc(r.dos, r.to, r.timezone || timezone);
    if (endTime <= startTime) endTime = new Date(endTime.getTime() + 24 * 3600 * 1000);

    if (DRY) { created++; continue; }
    if (!stId) continue;
    if (!provider && !client) { noPerson++; continue; }
    // Client not in the active set (e.g., discharged mid-week): session skipped, noted.
    if (!client && r.clientId) {
      noPerson++;
      continue;
    }

    const overlap = await prisma.session.findFirst({
      where: {
        providerId: provider ?? undefined,
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
      },
      select: { id: true, clientId: true, name: true },
    });
    if (overlap) {
      skipped++;
      if (overlap.clientId !== client) {
        console.warn(`  ⚠ SKIPPED (provider already booked: "${overlap.name}") — ${r.clientFirst} ${r.clientLast} with ${r.providerFirst} ${r.dos} ${r.from}–${r.to}`);
      }
      continue;
    }

    await prisma.session.create({
      data: {
        name: `${r.clientFirst} ${r.clientLast} — ${st.name}`,
        sessionTypeId: stId,
        providerId: provider ?? null,
        clientId: client ?? null,
        startTime,
        endTime,
        billable: st.billable,
        // Past sessions come in as COMPLETED; today/future stay SCHEDULED.
        status: endTime < new Date() ? "COMPLETED" : "SCHEDULED",
        locationType: toLocationType(r.locationCode),
        centerId: center?.id ?? null,
        timezone: r.timezone || timezone,
      },
    });
    created++;
  }

  // ── Availability from the week's direct-therapy patterns ───────────────────
  const availability = new Map<string, Map<DayOfWeek, { start: string; end: string }>>();
  for (const r of weekRows) {
    if (r.code.trim() !== "97153") continue;
    const dbId = clientDbId.get(r.clientId);
    if (!dbId && !DRY) continue;
    const key = r.clientId;
    if (!availability.has(key)) availability.set(key, new Map());
    const day = dayOfWeek(r.dos);
    const cur = availability.get(key)!.get(day);
    const from = r.from.padStart(5, "0"), to = r.to.padStart(5, "0");
    if (!cur) availability.get(key)!.set(day, { start: from, end: to });
    else {
      if (from < cur.start) cur.start = from;
      if (to > cur.end) cur.end = to;
    }
  }
  if (!DRY) {
    for (const [crId, byDay] of availability) {
      const dbId = clientDbId.get(crId);
      if (!dbId) continue;
      for (const [day, w] of byDay) {
        await prisma.$transaction([
          prisma.clientAvailability.deleteMany({ where: { clientId: dbId, dayOfWeek: day } }),
          prisma.clientAvailability.createMany({
            data: [{ clientId: dbId, dayOfWeek: day, startTime: w.start, endTime: w.end }],
          }),
        ]);
      }
    }
  }

  // ── Roster sync ────────────────────────────────────────────────────────────
  let deactClients: string[] = [], deactProviders: string[] = [];
  if (SYNC_ROSTER && !DRY) {
    const now = new Date();
    const keepClientIds = new Set(clientDbId.values());
    const activeDb = await prisma.client.findMany({
      where: { OR: [{ terminationDate: null }, { terminationDate: { gt: now } }] },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const c of activeDb) {
      if (keepClientIds.has(c.id)) continue;
      deactClients.push(`${c.lastName}, ${c.firstName}`);
      await prisma.$transaction([
        prisma.client.update({ where: { id: c.id }, data: { terminationDate: now } }),
        prisma.session.updateMany({
          where: { clientId: c.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startTime: { gte: now } },
          data: { status: "CANCELLED", cancelledBy: "CLIENT", cancellationReason: "CLIENT_DEACTIVATED" },
        }),
        prisma.approvedHome.updateMany({ where: { clientId: c.id, endDate: null }, data: { endDate: now } }),
        prisma.proposedSession.updateMany({
          where: { clientId: c.id, status: "PENDING" },
          data: { status: "REJECTED", rejectionReason: "Client deactivated (billing sync)", rejectedAt: now },
        }),
      ]);
    }
    const keepProviderIds = new Set(providerDbId.values());
    const activeDbP = await prisma.provider.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const p of activeDbP) {
      if (keepProviderIds.has(p.id)) continue;
      deactProviders.push(`${p.lastName}, ${p.firstName}`);
      await prisma.$transaction([
        prisma.provider.update({ where: { id: p.id }, data: { status: "INACTIVE" } }),
        prisma.session.updateMany({
          where: { providerId: p.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startTime: { gte: now } },
          data: { status: "CANCELLED", cancelledBy: "PROVIDER", cancellationReason: "PROVIDER_DEACTIVATED" },
        }),
        prisma.approvedHome.updateMany({ where: { providerId: p.id, endDate: null }, data: { endDate: now } }),
        prisma.providerAvailability.deleteMany({ where: { providerId: p.id } }),
        prisma.providerBlock.deleteMany({ where: { providerId: p.id, date: { gte: now } } }),
        prisma.proposedSession.updateMany({
          where: { providerId: p.id, status: "PENDING" },
          data: { status: "REJECTED", rejectionReason: "Provider deactivated (billing sync)", rejectedAt: now },
        }),
      ]);
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n${DRY ? "[DRY RUN] Would apply" : "Applied"}:`);
  console.log(`  Clients:   ${clientRows.size} active (${clientsCreated} new, ${clientsUpgraded} stub records upgraded to full names)`);
  console.log(`  Providers: ${providerRows.size} active (${providersCreated} new, ${providersUpgraded} upgraded)`);
  console.log(`  Sessions:  ${created} created, ${skipped} already present/overlapping, ${noPerson} skipped (person not in active set)`);
  console.log(`  Availability set for ${availability.size} clients from the week's billed patterns.`);
  if (SYNC_ROSTER) {
    console.log(`  Deactivated ${deactClients.length} clients: ${deactClients.join("; ") || "none"}`);
    console.log(`  Deactivated ${deactProviders.length} providers: ${deactProviders.join("; ") || "none"}`);
  }
  console.log(`\n⚠ Newly created people have PLACEHOLDER DOB/gender (not in billing exports).`);
  console.log(`  Authorizations are not created — add them in the app (billing has auth IDs but not hours/weeks).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
