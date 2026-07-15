// ─── Opening Schedule Import ─────────────────────────────────────────────────
// Seeds the database from the ATA RBT Schedule workbook (weekly grid tabs).
//
// Sheet layout (per weekly tab, e.g. "7-13"):
//   - Day blocks starting with "Mon"/"Tuesday"/... in column A
//   - Next row: provider first names across columns B..N
//   - Then 30-minute slot rows ("8:00-8:30" .. "5:30-6:00"); cell text like
//     "Luna- Bill" assigns that client to that provider for that half hour.
//   - Non-session codes skipped: "PTO", "open for client", "<name>- out"
//
// What it does:
//   1. Matches providers/clients by first name (+ last initial); CREATES
//      missing ones with clearly-marked placeholder data.
//   2. Merges contiguous half-hour cells into sessions (Direct Therapy,
//      CENTER, billable) for the target week.
//   3. Replaces each imported client's availability windows with the union of
//      their scheduled times per weekday.
//
// Usage:
//   npx tsx scripts/import-opening-schedule.ts \
//     --file "./ATA RBT Schedule.xlsx" --sheet "7-13" --week 2026-07-13 [--dry-run]
//
// Notes:
//   - Sessions are inserted directly (no rule validation) — this is a seed.
//     Created clients get placeholder DOB/insurance and NO authorizations;
//     add real data before relying on validation for future edits.
//   - Idempotent-ish: skips a session if the provider already has an
//     overlapping non-cancelled session at that time.

import { PrismaClient } from "@prisma/client";
import type { DayOfWeek } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

const prisma = new PrismaClient();

// ─── CLI args ─────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const FILE = arg("file");
const SHEET = arg("sheet") ?? "7-13";
const WEEK = arg("week"); // Monday, YYYY-MM-DD
const DRY = process.argv.includes("--dry-run");
// --sync-roster: after importing, deactivate every ACTIVE client and provider
// who does NOT appear on the roster sheets, so the app matches the workbook.
// --roster-sheets "7-13,7-6,6-29" widens the keep-list to the union of several
// weekly tabs (default: just the imported sheet). Deactivation mirrors the
// app's own actions (terminationDate / status INACTIVE, future sessions
// cancelled, approvals ended, proposals rejected). Nothing is hard-deleted.
const SYNC_ROSTER = process.argv.includes("--sync-roster") || !!arg("roster-sheets");
const ROSTER_SHEETS = (arg("roster-sheets") ?? SHEET).split(",").map((x) => x.trim()).filter(Boolean);

if (!FILE || !WEEK || !/^\d{4}-\d{2}-\d{2}$/.test(WEEK)) {
  console.error('Usage: npx tsx scripts/import-opening-schedule.ts --file <xlsx> --week YYYY-MM-DD [--sheet "7-13"] [--dry-run]');
  process.exit(1);
}

// ─── Day / time helpers ───────────────────────────────────────────────────────

const DAY_ALIASES: Record<string, { day: DayOfWeek; offset: number }> = {
  mon: { day: "MONDAY", offset: 0 },    monday: { day: "MONDAY", offset: 0 },
  tue: { day: "TUESDAY", offset: 1 },   tuesday: { day: "TUESDAY", offset: 1 },
  wed: { day: "WEDNESDAY", offset: 2 }, wednesday: { day: "WEDNESDAY", offset: 2 },
  thu: { day: "THURSDAY", offset: 3 },  thursday: { day: "THURSDAY", offset: 3 },
  fri: { day: "FRIDAY", offset: 4 },    friday: { day: "FRIDAY", offset: 4 },
  sat: { day: "SATURDAY", offset: 5 },  saturday: { day: "SATURDAY", offset: 5 },
  sun: { day: "SUNDAY", offset: 6 },    sunday: { day: "SUNDAY", offset: 6 },
};

// "8:00" in a clinic grid means 8 AM; "1:00" means 1 PM. 8–11 → AM, 12 → noon, 1–7 → PM.
function toMinutes(t: string): number {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (h >= 1 && h <= 7) h += 12;
  return h * 60 + m;
}
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

// Wall-clock time in `timezone` on `dateStr` → UTC Date.
function zonedTimeToUtc(dateStr: string, minutes: number, timezone: string): Date {
  const naive = new Date(`${dateStr}T${hhmm(minutes)}:00Z`);
  const inZone = new Date(naive.toLocaleString("en-US", { timeZone: timezone }));
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(naive.getTime() + (asUtc.getTime() - inZone.getTime()));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// ─── Cell parsing ─────────────────────────────────────────────────────────────

const SKIP_EXACT = new Set(["pto", "open for client", "open", "lunch", "break"]);

// "Noah V. - Bill" → { first: "Noah", lastInitial: "V" } | null for non-sessions
function parseCell(raw: unknown): { first: string; lastInitial: string | null } | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (SKIP_EXACT.has(lower)) return null;
  if (/-\s*out\b/.test(lower)) return null;       // "vynell- out"
  if (!/bill/i.test(lower)) return null;           // only billable direct-therapy cells
  const name = v.replace(/-?\s*bill\.?\s*$/i, "").replace(/-\s*$/, "").trim();
  if (!name) return null;
  const parts = name.split(/\s+/);
  const first = parts[0].replace(/[^A-Za-z'-]/g, "");
  const initial = parts[1]?.replace(/[^A-Za-z]/g, "") || null;
  if (!first) return null;
  return {
    first: canonical(first[0].toUpperCase() + first.slice(1)),
    lastInitial: initial ? initial[0].toUpperCase() : null,
  };
}

// Confirmed sheet typos - both spellings are the same person. Applied to every
// parsed first name so import matching, creation, and roster sync all merge them.
const NAME_ALIASES: Record<string, string> = {
  brianta: "Briana", // "Brianta (PT)" on the 7-13 Wednesday header
  nevaeh: "Neveah",  // "Neveah" is the dominant spelling in the workbook (130 vs 20)
};
function canonical(first: string): string {
  return NAME_ALIASES[first.trim().toLowerCase()] ?? first;
}

const norm = (s: string) => s.trim().toLowerCase();

// Small edit-distance check to flag probable typos ("Briana"/"Brianta",
// "Nevaeh"/"Neveah") that would otherwise create duplicate people.
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function warnSimilarNames(kind: string, names: string[]) {
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = norm(names[i]), b = norm(names[j]);
      const pair = [a, b].sort().join("|");
      if (seen.has(pair) || a === b) continue;
      if (a[0] === b[0] && editDistance(a, b) <= 2) {
        seen.add(pair);
        console.warn(`  ⚠ Similar ${kind} names "${names[i]}" / "${names[j]}" — possible typo in the sheet. Both will be imported as separate people; fix the sheet or merge in the app if they're the same person.`);
      }
    }
  }
}

// Reads a sheet into a row grid. blankrows:false guards against tabs with a
// stretched used-range (the "7-6" tab reports 1M rows).
function readGrid(wb: XLSX.WorkBook, name: string): unknown[][] | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: false });
}

type NameRef = { first: string; lastInitial: string | null };

// Collects every provider (day-header columns) and client (billable cells)
// appearing anywhere on a weekly grid tab.
function collectPeople(grid: unknown[][]): { providers: NameRef[]; clients: NameRef[] } {
  const providers = new Map<string, NameRef>();
  const clients = new Map<string, NameRef>();
  let r = 0;
  while (r < grid.length) {
    const a = String(grid[r]?.[0] ?? "").trim().toLowerCase();
    if (!DAY_ALIASES[a]) { r++; continue; }
    const headerRow = grid[r + 1] ?? [];
    const cols: number[] = [];
    for (let c = 1; c < headerRow.length; c++) {
      const h = String(headerRow[c] ?? "").trim();
      if (!h) continue;
      const tokens = h.replace(/\(.*?\)/g, " ").split(/\s+/).filter(Boolean);
      const first = tokens[0]?.replace(/[^A-Za-z'-]/g, "");
      if (!first) continue;
      const second = tokens[1]?.replace(/[^A-Za-z.]/g, "") ?? "";
      const lastInitial = /^[A-Za-z]\.?$/.test(second) ? second[0].toUpperCase() : null;
      const ref = { first: canonical(first[0].toUpperCase() + first.slice(1)), lastInitial };
      providers.set(`${norm(ref.first)}|${ref.lastInitial ?? ""}`, ref);
      cols.push(c);
    }
    let rr = r + 2;
    for (; rr < grid.length; rr++) {
      const slot = String(grid[rr]?.[0] ?? "").trim();
      if (!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(slot)) break;
      for (const c of cols) {
        const parsed = parseCell(grid[rr]?.[c]);
        if (parsed) clients.set(`${norm(parsed.first)}|${parsed.lastInitial ?? ""}`, parsed);
      }
    }
    r = rr;
  }
  return { providers: [...providers.values()], clients: [...clients.values()] };
}

// True when a DB person matches any sheet name: same first name, and if the
// sheet gave a last initial, the DB last name must start with it. A sheet name
// with no initial keeps every DB person with that first name (first names are
// how the sheet identifies people, so this errs on the side of keeping).
function onRoster(dbFirst: string, dbLast: string, keep: NameRef[]): boolean {
  return keep.some(
    (k) =>
      norm(k.first) === norm(dbFirst) &&
      (!k.lastInitial || dbLast.toUpperCase().startsWith(k.lastInitial))
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Block {
  providerFirst: string;
  providerLastInitial: string | null;
  client: { first: string; lastInitial: string | null };
  day: DayOfWeek;
  dateStr: string;
  startMins: number;
  endMins: number;
}

async function main() {
  const wb = XLSX.read(require("fs").readFileSync(path.resolve(FILE!)), { type: "buffer" });
  const grid = readGrid(wb, SHEET);
  if (!grid) { console.error(`Sheet "${SHEET}" not found. Available: ${wb.SheetNames.join(", ")}`); process.exit(1); }

  // Parse day blocks → merge contiguous slots into Blocks
  const blocks: Block[] = [];
  const skipped: Record<string, number> = {};
  let r = 0;
  while (r < grid.length) {
    const a = String(grid[r]?.[0] ?? "").trim().toLowerCase();
    const dayInfo = DAY_ALIASES[a];
    if (!dayInfo) { r++; continue; }

    const headerRow = grid[r + 1] ?? [];
    const providerCols: { col: number; first: string; lastInitial: string | null }[] = [];
    for (let c = 1; c < headerRow.length; c++) {
      const h = String(headerRow[c] ?? "").trim();
      if (!h) continue;
      // "Logan K (FT)" → first "Logan", initial "K". Ignore (FT)/(PT)/32HR/role words.
      const tokens = h.replace(/\(.*?\)/g, " ").split(/\s+/).filter(Boolean);
      const first = tokens[0]?.replace(/[^A-Za-z'-]/g, "");
      if (!first) continue;
      const second = tokens[1]?.replace(/[^A-Za-z.]/g, "") ?? "";
      // Single letter (optionally with dot) = last-name initial; longer words are role/hours noise.
      const lastInitial = /^[A-Za-z]\.?$/.test(second) ? second[0].toUpperCase() : null;
      providerCols.push({ col: c, first: canonical(first), lastInitial });
    }

    // open[col] = current in-progress block per column
    const open = new Map<number, Block>();
    let rr = r + 2;
    for (; rr < grid.length; rr++) {
      const slot = String(grid[rr]?.[0] ?? "").trim();
      const m = slot.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (!m) break; // end of this day's slot rows
      const start = toMinutes(m[1]);
      const end = toMinutes(m[2]);

      for (const { col, first, lastInitial } of providerCols) {
        const raw = grid[rr]?.[col];
        const parsed = parseCell(raw);
        if (!parsed && typeof raw === "string" && raw.trim() && !/bill/i.test(raw)) {
          skipped[raw.trim()] = (skipped[raw.trim()] ?? 0) + 1;
        }
        const cur = open.get(col);
        const same = cur && parsed &&
          norm(cur.client.first) === norm(parsed.first) &&
          (cur.client.lastInitial ?? "") === (parsed.lastInitial ?? "") &&
          cur.endMins === start;
        if (same) { cur!.endMins = end; continue; }
        if (cur) { blocks.push(cur); open.delete(col); }
        if (parsed) {
          open.set(col, {
            providerFirst: first,
            providerLastInitial: lastInitial,
            client: parsed,
            day: dayInfo.day,
            dateStr: addDays(WEEK!, dayInfo.offset),
            startMins: start,
            endMins: end,
          });
        }
      }
    }
    for (const b of open.values()) blocks.push(b);
    r = rr;
  }

  console.log(`Parsed ${blocks.length} session blocks from sheet "${SHEET}".`);
  for (const [txt, n] of Object.entries(skipped)) console.log(`  skipped (not a session): "${txt}" x${n}`);

  warnSimilarNames("provider", [...new Set(blocks.map((b) => b.providerFirst))]);
  warnSimilarNames("client", [...new Set(blocks.map((b) => b.client.first))]);

  // ── Resolve center / session type ──────────────────────────────────────────
  const center = await prisma.center.findFirst();
  const timezone = center?.timezone ?? "America/New_York";
  let sessionType = await prisma.sessionType.findFirst({ where: { name: "Direct Therapy" } });
  if (!sessionType && !DRY) {
    sessionType = await prisma.sessionType.create({ data: { name: "Direct Therapy", billable: true } });
  }

  // ── Resolve / create providers ─────────────────────────────────────────────
  const providerKey = (first: string, initial: string | null) => `${norm(first)}|${initial ?? ""}`;
  const providerByKey = new Map<string, { id: string }>();
  const createdProviders: string[] = [];
  const uniqueProviders = new Map<string, { first: string; lastInitial: string | null }>();
  for (const b of blocks) {
    uniqueProviders.set(providerKey(b.providerFirst, b.providerLastInitial), {
      first: b.providerFirst, lastInitial: b.providerLastInitial,
    });
  }
  // Duplicate first names without an initial on one of them ("Logan" vs "Logan K")
  // are kept separate; warn so the plain one can be renamed in the sheet if wrong.
  const firstCounts = new Map<string, number>();
  for (const p of uniqueProviders.values()) firstCounts.set(norm(p.first), (firstCounts.get(norm(p.first)) ?? 0) + 1);

  for (const [key, p] of uniqueProviders) {
    const candidates = await prisma.provider.findMany({
      where: { firstName: { equals: p.first, mode: "insensitive" }, status: "ACTIVE" },
      select: { id: true, lastName: true },
    });
    const dupFirst = (firstCounts.get(norm(p.first)) ?? 0) > 1;
    if (dupFirst) {
      console.warn(`  ⚠ Two providers share the first name "${p.first}" — matching on last initial ("${p.lastInitial ?? "none"}").`);
    }
    const match = p.lastInitial
      ? candidates.find((x: { id: string; lastName: string }) => x.lastName.toUpperCase().startsWith(p.lastInitial!))
      : (dupFirst
          ? candidates.find((x: { id: string; lastName: string }) => x.lastName === "(Imported)")
          : candidates.length === 1 ? candidates[0] : candidates[0]);
    if (match) { providerByKey.set(key, match); continue; }
    createdProviders.push(p.lastInitial ? `${p.first} ${p.lastInitial}.` : p.first);
    if (!DRY) {
      const created = await prisma.provider.create({
        data: {
          firstName: p.first,
          lastName: p.lastInitial ? `${p.lastInitial}.` : "(Imported)",
          position: "RBT",
          gender: "Unknown",
          status: "ACTIVE",
          centerId: center?.id ?? null,
        },
        select: { id: true },
      });
      providerByKey.set(key, created);
    }
  }

  // ── Resolve / create clients ───────────────────────────────────────────────
  const clientKey = (c: { first: string; lastInitial: string | null }) => `${norm(c.first)}|${c.lastInitial ?? ""}`;
  const clientById = new Map<string, { id: string }>();
  const createdClients: string[] = [];
  const uniqueClients = new Map<string, { first: string; lastInitial: string | null }>();
  for (const b of blocks) uniqueClients.set(clientKey(b.client), b.client);

  for (const [key, c] of uniqueClients) {
    const candidates = await prisma.client.findMany({
      where: { firstName: { equals: c.first, mode: "insensitive" }, terminationDate: null },
      select: { id: true, lastName: true },
    });
    const match = c.lastInitial
      ? candidates.find((x: { id: string; lastName: string }) => x.lastName.toUpperCase().startsWith(c.lastInitial!))
      : candidates.length === 1 ? candidates[0] : undefined;
    if (match) { clientById.set(key, match); continue; }
    if (candidates.length > 1) {
      console.warn(`  ⚠ Ambiguous client "${c.first}" (${candidates.length} matches, no last initial) — creating a separate record. Merge manually if wrong.`);
    }
    createdClients.push(c.lastInitial ? `${c.first} ${c.lastInitial}.` : c.first);
    if (!DRY) {
      const created = await prisma.client.create({
        data: {
          firstName: c.first,
          lastName: c.lastInitial ? `${c.lastInitial}.` : "(Imported)",
          externalId: `IMPORT-${norm(c.first)}${c.lastInitial ? `-${c.lastInitial.toLowerCase()}` : ""}`,
          dateOfBirth: new Date("2018-01-01T00:00:00Z"), // PLACEHOLDER — fix in app
          gender: "Unknown",
          insurance: "TBD (imported)",                   // PLACEHOLDER — fix in app
          activeDate: new Date(`${WEEK}T00:00:00Z`),
          preferredLocation: "CENTER",
          centerId: center?.id ?? null,
        },
        select: { id: true },
      });
      clientById.set(key, created);
    }
  }

  // ── Create sessions ────────────────────────────────────────────────────────
  let created = 0, skippedOverlap = 0;
  for (const b of blocks) {
    const startTime = zonedTimeToUtc(b.dateStr, b.startMins, timezone);
    const endTime = zonedTimeToUtc(b.dateStr, b.endMins, timezone);
    const provider = providerByKey.get(providerKey(b.providerFirst, b.providerLastInitial));
    const client = clientById.get(clientKey(b.client));
    if (DRY) { created++; continue; }
    if (!provider || !client || !sessionType) continue;

    const overlap = await prisma.session.findFirst({
      where: {
        providerId: provider.id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
      },
      select: { id: true },
    });
    if (overlap) { skippedOverlap++; continue; }

    await prisma.session.create({
      data: {
        name: `${b.client.first} — Direct Therapy`,
        sessionTypeId: sessionType.id,
        providerId: provider.id,
        clientId: client.id,
        startTime,
        endTime,
        billable: true,
        status: "SCHEDULED",
        locationType: "CENTER",
        centerId: center?.id ?? null,
        timezone,
      },
    });
    created++;
  }

  // ── Client availability = union of scheduled windows per weekday ───────────
  const availByClient = new Map<string, Map<DayOfWeek, { startTime: string; endTime: string }[]>>();
  for (const b of blocks) {
    const key = clientKey(b.client);
    if (!availByClient.has(key)) availByClient.set(key, new Map());
    const byDay = availByClient.get(key)!;
    if (!byDay.has(b.day)) byDay.set(b.day, []);
    byDay.get(b.day)!.push({ startTime: hhmm(b.startMins), endTime: hhmm(b.endMins) });
  }
  if (!DRY) {
    for (const [key, byDay] of availByClient) {
      const client = clientById.get(key);
      if (!client) continue;
      for (const [day, windows] of byDay) {
        // merge overlapping/adjacent windows
        const sorted = windows.sort((a, z) => a.startTime.localeCompare(z.startTime));
        const merged: typeof windows = [];
        for (const w of sorted) {
          const last = merged[merged.length - 1];
          if (last && w.startTime <= last.endTime) {
            if (w.endTime > last.endTime) last.endTime = w.endTime;
          } else merged.push({ ...w });
        }
        await prisma.$transaction([
          prisma.clientAvailability.deleteMany({ where: { clientId: client.id, dayOfWeek: day } }),
          prisma.clientAvailability.createMany({
            data: merged.map((w) => ({ clientId: client.id, dayOfWeek: day, ...w })),
          }),
        ]);
      }
    }
  }

  // ── Roster sync ─────────────────────────────────────────────────────────────
  // Keep-list = union of everyone appearing on the roster sheets. Any ACTIVE
  // client or provider in the DB who matches none of those names is deactivated.
  let deactivatedNames: string[] = [];
  let deactivatedProviderNames: string[] = [];
  if (SYNC_ROSTER) {
    const keepClients: NameRef[] = [];
    const keepProviders: NameRef[] = [];
    for (const sheetName of ROSTER_SHEETS) {
      const g = sheetName === SHEET ? grid : readGrid(wb, sheetName);
      if (!g) { console.error(`Roster sheet "${sheetName}" not found — aborting sync so nobody is wrongly removed.`); process.exit(1); }
      const people = collectPeople(g);
      keepClients.push(...people.clients);
      keepProviders.push(...people.providers);
    }
    console.log(`\nRoster sync against sheets [${ROSTER_SHEETS.join(", ")}]: ${keepClients.length} client names, ${keepProviders.length} provider names on the keep-list.`);

    const now = new Date();

    // Clients not on any roster sheet → deactivate (mirrors deactivateClient)
    const activeClients = await prisma.client.findMany({
      where: { OR: [{ terminationDate: null }, { terminationDate: { gt: now } }] },
      select: { id: true, firstName: true, lastName: true },
    });
    const clientsToDrop = activeClients.filter(
      (c: { firstName: string; lastName: string }) => !onRoster(c.firstName, c.lastName, keepClients)
    );
    deactivatedNames = clientsToDrop.map(
      (c: { firstName: string; lastName: string }) => `${c.lastName}, ${c.firstName}`
    );
    if (!DRY) {
      for (const c of clientsToDrop) {
        await prisma.$transaction([
          prisma.client.update({ where: { id: c.id }, data: { terminationDate: now } }),
          prisma.session.updateMany({
            where: { clientId: c.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startTime: { gte: now } },
            data: { status: "CANCELLED", cancelledBy: "CLIENT", cancellationReason: "CLIENT_DEACTIVATED" },
          }),
          prisma.approvedHome.updateMany({
            where: { clientId: c.id, endDate: null },
            data: { endDate: now },
          }),
          prisma.proposedSession.updateMany({
            where: { clientId: c.id, status: "PENDING" },
            data: { status: "REJECTED", rejectionReason: "Client deactivated (roster sync)", rejectedAt: now },
          }),
        ]);
      }
    }

    // Providers not on any roster sheet → set INACTIVE (mirrors deactivateProvider)
    const activeProviders = await prisma.provider.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true },
    });
    const providersToDrop = activeProviders.filter(
      (p: { firstName: string; lastName: string }) => !onRoster(p.firstName, p.lastName, keepProviders)
    );
    deactivatedProviderNames = providersToDrop.map(
      (p: { firstName: string; lastName: string }) => `${p.lastName}, ${p.firstName}`
    );
    if (!DRY) {
      for (const pv of providersToDrop) {
        await prisma.$transaction([
          prisma.provider.update({ where: { id: pv.id }, data: { status: "INACTIVE" } }),
          prisma.session.updateMany({
            where: { providerId: pv.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startTime: { gte: now } },
            data: { status: "CANCELLED", cancelledBy: "PROVIDER", cancellationReason: "PROVIDER_DEACTIVATED" },
          }),
          prisma.approvedHome.updateMany({
            where: { providerId: pv.id, endDate: null },
            data: { endDate: now },
          }),
          prisma.providerAvailability.deleteMany({ where: { providerId: pv.id } }),
          prisma.providerBlock.deleteMany({ where: { providerId: pv.id, date: { gte: now } } }),
          prisma.proposedSession.updateMany({
            where: { providerId: pv.id, status: "PENDING" },
            data: { status: "REJECTED", rejectionReason: "Provider deactivated (roster sync)", rejectedAt: now },
          }),
        ]);
      }
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n${DRY ? "[DRY RUN] Would create" : "Created"}:`);
  console.log(`  Sessions:  ${created}${skippedOverlap ? ` (${skippedOverlap} skipped — provider already booked)` : ""}`);
  console.log(`  Providers: ${createdProviders.length} new — ${createdProviders.join(", ") || "none"}`);
  console.log(`  Clients:   ${createdClients.length} new — ${createdClients.join(", ") || "none"}`);
  console.log(`  Availability windows set for ${availByClient.size} clients.`);
  if (SYNC_ROSTER) {
    console.log(`  ${DRY ? "Would deactivate" : "Deactivated"} ${deactivatedNames.length} client${deactivatedNames.length === 1 ? "" : "s"} not on [${ROSTER_SHEETS.join(", ")}]${deactivatedNames.length ? ":" : "."}`);
    for (const n of deactivatedNames) console.log(`    - ${n}`);
    console.log(`  ${DRY ? "Would deactivate" : "Deactivated"} ${deactivatedProviderNames.length} provider${deactivatedProviderNames.length === 1 ? "" : "s"} not on [${ROSTER_SHEETS.join(", ")}]${deactivatedProviderNames.length ? ":" : "."}`);
    for (const n of deactivatedProviderNames) console.log(`    - ${n}`);
  }
  if (createdClients.length > 0) {
    console.log(`\n⚠ New clients have PLACEHOLDER DOB (2018-01-01), insurance ("TBD (imported)"),`);
    console.log(`  and NO authorizations. Update them in the app before relying on validation.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
