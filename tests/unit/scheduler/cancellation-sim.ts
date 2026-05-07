/**
 * Cancellation Logic Simulation
 *
 * 10 total runs:
 *   Runs 1–5:  Single cancellations (random mix of client-only or provider-only)
 *              Expected: 0 proposals. Single cancellation = nothing auto-fills.
 *              - Client cancel:   provider's slot is freed, but no displaced client exists
 *                                 → freed provider has no one to pair with → stays idle
 *              - Provider cancel: client is displaced, but no freed provider exists
 *                                 → displaced client has no freed provider → stays unscheduled
 *
 *   Runs 6–10: Double cancellations (provider + a DIFFERENT client cancel)
 *              Expected: 1 proposal. Freed provider pairs with displaced client.
 *              - P1 cancels with ClientA → P1 BLOCKED, ClientA displaced (needs session)
 *              - ClientB cancels with P2 → P2 FREED, ClientB doesn't need a session
 *              → Auto-schedule pairs P2 (freed) → ClientA (displaced)
 *
 * Uses the pure optimize() function — no database calls.
 * Run with:  npx tsx tests/unit/scheduler/cancellation-sim.ts
 */

import { optimize, createWorkingState } from "@/lib/scheduler/optimizer";
import type { SchedulerClient, SchedulerProvider, SchedulerInput } from "@/lib/scheduler/types";
import type { DayOfWeek } from "@prisma/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function addMins(hhmm: string, delta: number): string {
  const total = mins(hhmm) + delta;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const WEEK_OF = new Date("2026-03-23T05:00:00Z"); // Monday midnight EST
const TARGET_DATE = "2026-03-23";
const TIMEZONE = "America/New_York";

function makeInput(
  clients: SchedulerClient[],
  providers: SchedulerProvider[],
  overrides: Partial<SchedulerInput> = {}
): SchedulerInput {
  return {
    weekOf: WEEK_OF,
    targetDate: TARGET_DATE,
    timezone: TIMEZONE,
    centerId: null,
    clients,
    providers,
    sessionTypeIds: { CENTER: "dt-center", HOME: "dt-home", SCHOOL: "dt-center" },
    driveTimeSessionTypeId: null,
    driveMinutes: {},
    distanceMeters: {},
    ...overrides,
  };
}

function makeClient(
  id: string,
  availStart: string,
  availEnd: string,
  sessionHrs: number,
  overrides: Partial<SchedulerClient> = {}
): SchedulerClient {
  return {
    id,
    firstName: id,
    lastName: "Test",
    latitude: null,
    longitude: null,
    sessionHours: sessionHrs,
    daysNeeded: 1,
    minimumRbtLevel: null,
    femaleProviderOnly: false,
    spanish: false,
    availability: [{ dayOfWeek: "MONDAY", startTime: availStart, endTime: availEnd }],
    bookedWindows: [],
    blocks: [],
    authorizationId: `auth-${id}`,
    approvedWeeklyHours: 20,
    usedHoursThisWeek: 0,
    approvedProviderIds: [],
    authorizationEndDate: null,
    historicalProviderIds: [],
    hasPriorWeekHistory: false,
    preferredLocation: "HOME",
    ...overrides,
  };
}

function makeProvider(
  id: string,
  bookedWindows: Array<{
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    clientId?: string;
    locationType?: "HOME" | "CENTER";
  }> = [],
  overrides: Partial<SchedulerProvider> = {}
): SchedulerProvider {
  return {
    id,
    firstName: id,
    lastName: "Provider",
    position: "RBT",
    rbtLevel: "II",
    gender: "female",
    spanish: false,
    latitude: null,
    longitude: null,
    availability: [{ dayOfWeek: "MONDAY", startTime: "08:00", endTime: "18:00" }],
    bookedWindows,
    blocks: [],
    weeklyHoursAlreadyScheduled: 0,
    ...overrides,
  };
}

// ─── Result Types ─────────────────────────────────────────────────────────────

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface SimResult {
  runId: number;
  type: "single" | "double";
  cancelledBy: "CLIENT" | "PROVIDER" | "BOTH";
  label: string;
  passed: boolean;
  checks: Check[];
}

function check(checks: Check[], name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
}

const results: SimResult[] = [];

// ─── RUNS 1–5: Single Cancellations ──────────────────────────────────────────
//
// Single cancellation = nothing changes on the schedule.
//
// cancelledBy = CLIENT:
//   • P1's slot is FREED (not in bookedWindows)
//   • No displaced clients exist (no provider cancellation)
//   • cancellationContext: { freedProviderIds: ['P1'], displacedClientIds: [] }
//   • Expected: 0 proposals — P1 stays idle (no displaced client to pair with)
//
// cancelledBy = PROVIDER:
//   • P1's slot is BLOCKED (in bookedWindows)
//   • DisplacedClient still needs a session, but no freed provider exists
//   • cancellationContext: { freedProviderIds: [], displacedClientIds: ['DisplacedClient'] }
//   • Expected: 0 proposals — DisplacedClient stays unscheduled (no freed provider)

const singleCancelTypes: Array<"CLIENT" | "PROVIDER"> = [
  "CLIENT",   // Run 1
  "PROVIDER", // Run 2
  "CLIENT",   // Run 3
  "PROVIDER", // Run 4
  "CLIENT",   // Run 5
];

for (let i = 0; i < 5; i++) {
  const runId = i + 1;
  const cancelledBy = singleCancelTypes[i];

  // Vary session start and duration across runs
  const slotStart = addMins("09:00", i * 30);       // 09:00, 09:30, 10:00 …
  const sessionHrs = i % 2 === 0 ? 2 : 1.5;
  const slotEnd = addMins(slotStart, sessionHrs * 60);

  const label = `Run ${runId} [${cancelledBy} cancel] — ${slotStart}–${slotEnd} (${sessionHrs}h) → 0 proposals expected`;

  const checks: Check[] = [];

  if (cancelledBy === "CLIENT") {
    // Client A cancelled → P1's slot is freed (not in bookedWindows).
    // No displaced clients (no provider cancellations happened).
    // The cancelled client is excluded from input — they don't need a session.
    // With no clients needing sessions and no displaced clients to pair with P1,
    // the expected output is 0 proposals (P1's freed slot stays idle).
    // cancellationContext: freed P1, no displaced clients → no pairing → 0 proposals

    const p1 = makeProvider("P1", []); // freed (client cancelled)

    // No clients in input: the only client (who cancelled) is excluded.
    // This tests that with no displaced clients, the freed P1 has no one to pair with.
    const input = makeInput([], [p1], {
      cancellationContext: {
        freedProviderIds: ["P1"],
        displacedClientIds: [],
      },
    });
    const output = optimize(input, createWorkingState());

    check(
      checks,
      "0 proposals — freed P1 has no displaced client to pair with",
      output.proposals.length === 0,
      output.proposals.length === 0
        ? "Correct — freed P1 stays idle with no displaced client"
        : `VIOLATION: ${output.proposals.length} proposal(s) created — expected none. ${output.proposals.map(p => `${p.clientId}→${p.providerId}`).join(", ")}`
    );

    check(
      checks,
      "P1 (freed provider) not used in any proposal",
      !output.proposals.some((p) => p.providerId === "P1"),
      output.proposals.some((p) => p.providerId === "P1")
        ? "VIOLATION: P1 was used despite being a freed provider with no displaced client"
        : "P1 correctly stays idle"
    );

  } else {
    // Provider cancel → P1's slot is BLOCKED (in bookedWindows)
    // DisplacedClient still needs a session, but no freed provider exists
    // cancellationContext: displaced DisplacedClient, no freed providers → no pairing → 0 proposals

    const p1 = makeProvider("P1", [
      { dayOfWeek: "MONDAY", startTime: slotStart, endTime: slotEnd, clientId: "DisplacedClient", locationType: "HOME" },
    ]);
    const p2 = makeProvider("P2", []); // available backup — NOT freed by any client cancellation

    const displacedClient = makeClient("DisplacedClient", "08:00", "18:00", sessionHrs);

    const input = makeInput([displacedClient], [p1, p2], {
      cancellationContext: {
        freedProviderIds: [],          // no provider was freed by a client cancellation
        displacedClientIds: ["DisplacedClient"],
      },
    });
    const output = optimize(input, createWorkingState());

    check(
      checks,
      "0 proposals — no freed provider to pair with displaced client",
      output.proposals.length === 0,
      output.proposals.length === 0
        ? "Correct — DisplacedClient stays unscheduled with no freed provider"
        : `VIOLATION: ${output.proposals.length} proposal(s) created — expected none. ${output.proposals.map(p => `${p.clientId}→${p.providerId}`).join(", ")}`
    );

    check(
      checks,
      "DisplacedClient correctly stays unscheduled",
      !output.proposals.some((p) => p.clientId === "DisplacedClient"),
      output.proposals.some((p) => p.clientId === "DisplacedClient")
        ? `VIOLATION: DisplacedClient was scheduled with ${output.proposals.find(p => p.clientId === "DisplacedClient")?.providerId} — should stay unscheduled`
        : "DisplacedClient correctly not scheduled"
    );

    check(
      checks,
      "P2 (non-freed backup) not used for displaced client",
      !output.proposals.some((p) => p.providerId === "P2" && p.clientId === "DisplacedClient"),
      "P2 correctly blocked from taking displaced client (not a freed provider)"
    );
  }

  results.push({
    runId,
    type: "single",
    cancelledBy,
    label,
    passed: checks.every((c) => c.pass),
    checks,
  });
}

// ─── RUNS 6–10: Double Cancellations (Switch) ─────────────────────────────────
//
// Both a provider and a different client cancel on the same day.
//   • P1 cancels with ClientA  → P1 BLOCKED, ClientA displaced (still needs a session)
//   • ClientB cancels with P2  → P2 FREED, ClientB doesn't need a session
//
// cancellationContext: { displacedClientIds: ['ClientA'], freedProviderIds: ['P2'] }
//
// After auto-schedule runs:
//   → P2 (freed) should be proposed for ClientA (displaced) — the switch
//   → P1 should NOT appear in any proposal (blocked)
//   → ClientB should NOT appear in any proposal (not in input — they cancelled)
//   → Exactly 1 proposal total

for (let i = 0; i < 5; i++) {
  const runId = i + 6;

  // Vary start time and duration across runs
  const slotStart = addMins("09:00", i * 30);
  const sessionHrs = i % 2 === 0 ? 2 : 1.5;
  const slotEnd = addMins(slotStart, sessionHrs * 60);

  const label = `Run ${runId} [DOUBLE cancel] — ${slotStart}–${slotEnd} (${sessionHrs}h) → P2→ClientA switch expected`;

  const checks: Check[] = [];

  // P1: cancelled by provider → slot BLOCKED (in bookedWindows)
  const p1 = makeProvider("P1", [
    { dayOfWeek: "MONDAY", startTime: slotStart, endTime: slotEnd, clientId: "ClientA", locationType: "HOME" },
  ]);

  // P2: freed by client cancel → slot NOT in bookedWindows
  const p2 = makeProvider("P2", []);

  // ClientA: displaced by P1's cancellation — still needs a session
  const clientA = makeClient("ClientA", "08:00", "18:00", sessionHrs);

  // ClientB: cancelled — NOT in the input (they don't need a session)

  const input = makeInput([clientA], [p1, p2], {
    cancellationContext: {
      displacedClientIds: ["ClientA"],
      freedProviderIds: ["P2"],
    },
  });
  const output = optimize(input, createWorkingState());

  const proposal = output.proposals.find((p) => p.clientId === "ClientA");

  check(
    checks,
    "Switch detected — ClientA gets rescheduled",
    proposal !== undefined,
    proposal
      ? `ClientA assigned to ${proposal.providerId} at ${proposal.startTime}–${proposal.endTime}`
      : `ClientA NOT rescheduled. Reason: ${output.skipReasons["ClientA"] ?? "unknown"}`
  );

  check(
    checks,
    "P2 (freed provider) fills the switch",
    proposal?.providerId === "P2",
    proposal?.providerId === "P2"
      ? "P2 correctly matched to ClientA — switch succeeded"
      : `Wrong provider: ${proposal?.providerId ?? "none"} — expected P2`
  );

  check(
    checks,
    "P1 (blocked) not used in any proposal",
    !output.proposals.some((p) => p.providerId === "P1"),
    output.proposals.some((p) => p.providerId === "P1")
      ? "VIOLATION: P1 (who cancelled) was used in a proposal"
      : "P1 correctly excluded"
  );

  check(
    checks,
    "ClientB (who cancelled) not rescheduled",
    !output.proposals.some((p) => p.clientId === "ClientB"),
    output.proposals.some((p) => p.clientId === "ClientB")
      ? "UNEXPECTED: ClientB received a proposal"
      : "ClientB correctly absent from output"
  );

  check(
    checks,
    "Exactly 1 proposal total (the switch)",
    output.proposals.length === 1,
    `${output.proposals.length} proposal(s) — expected exactly 1`
  );

  check(
    checks,
    "Proposed duration matches ClientA's requirement",
    proposal ? Math.abs((mins(proposal.endTime) - mins(proposal.startTime)) - sessionHrs * 60) < 1 : true,
    proposal
      ? `${mins(proposal.endTime) - mins(proposal.startTime)} min proposed vs ${sessionHrs * 60} min required`
      : "N/A"
  );

  results.push({
    runId,
    type: "double",
    cancelledBy: "BOTH",
    label,
    passed: checks.every((c) => c.pass),
    checks,
  });
}

// ─── AUDIT_GOD Report ─────────────────────────────────────────────────────────

const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
const passedChecks = results.reduce((n, r) => n + r.checks.filter((c) => c.pass).length, 0);
const allPassed = results.every((r) => r.passed);

const singleResults = results.filter((r) => r.type === "single");
const doubleResults = results.filter((r) => r.type === "double");

const singlePassed = singleResults.filter((r) => r.passed).length;
const doublePassed = doubleResults.filter((r) => r.passed).length;

const complianceScore = Math.round((passedChecks / totalChecks) * 100);
const utilizationScore = Math.round(((singlePassed + doublePassed) / 10) * 100);
const switchScore = Math.round((doublePassed / 5) * 100);
const finalScore = Math.round(complianceScore * 0.40 + utilizationScore * 0.35 + switchScore * 0.25);
const rating = finalScore >= 90 ? "Excellent" : finalScore >= 75 ? "Good" : finalScore >= 60 ? "Fair" : "Poor";

console.log(`
════════════════════════════════════════════════════════════════
SCHEDULE AUDIT REPORT — CANCELLATION LOGIC SIMULATION
Week of: ${TARGET_DATE}
Generated: ${new Date().toISOString()}
Total runs: 10 (5 single cancellations + 5 double cancellations)
════════════════════════════════════════════════════════════════

OVERALL RESULT: ${allPassed ? "PASS ✓" : "FAIL ✗"}
Checks passed: ${passedChecks}/${totalChecks} (${complianceScore}%)

────────────────────────────────────────────────────────────────
PASS 1 — COMPLIANCE VALIDATION
────────────────────────────────────────────────────────────────
COMPLIANCE RESULT: ${allPassed ? "PASS" : "FAIL"}
Violations found: ${results.filter((r) => !r.passed).length}
`);

for (const section of ["single", "double"] as const) {
  const rs = results.filter((r) => r.type === section);
  const passed = rs.filter((r) => r.passed).length;
  const heading = section === "single"
    ? "Single Cancellations (Runs 1–5) — expected: 0 proposals each"
    : "Double Cancellations / Switch (Runs 6–10) — expected: freed provider → displaced client";
  console.log(`  ${heading}`);
  console.log(`  Result: ${passed}/${rs.length} runs passed\n`);

  for (const r of rs) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`    [${status}] ${r.label}`);
    for (const c of r.checks) {
      const mark = c.pass ? "  ✓" : "  ✗";
      console.log(`      ${mark} ${c.name}`);
      if (!c.pass) console.log(`           → ${c.detail}`);
    }
    console.log("");
  }
}

console.log(`────────────────────────────────────────────────────────────────
PASS 2 — SLOT UTILIZATION
────────────────────────────────────────────────────────────────

  Single cancellations:
    Rule: single cancel = nothing changes. Freed/displaced resources stay idle.
    Result: ${singlePassed}/5 runs correctly produced 0 proposals

  Double cancellations:
    Rule: freed provider pairs with displaced client — the switch.
    Switch success rate: ${doublePassed}/5 runs correctly produced 1 proposal (freed→displaced)

────────────────────────────────────────────────────────────────
PASS 3 — CLIENT COVERAGE
────────────────────────────────────────────────────────────────

  Single — no auto-fill for single cancellations:  ${singlePassed === 5 ? "YES ✓" : `PARTIAL (${singlePassed}/5)`}
  Double — displaced client covered by freed provider (switch): ${doublePassed === 5 ? "YES ✓" : `PARTIAL (${doublePassed}/5)`}

────────────────────────────────────────────────────────────────
PASS 4 — OVERALL SCORE
────────────────────────────────────────────────────────────────

SCHEDULE SCORE: ${finalScore}/100 — ${rating}

Breakdown:
  Compliance (check pass rate):  ${complianceScore}/100 (weight: 40%)
  Run pass rate:                 ${utilizationScore}/100 (weight: 35%)
  Switch success rate:           ${switchScore}/100 (weight: 25%)
`);

if (allPassed) {
  console.log("All 10 scenarios passed. Cancellation logic is consistent and correct.\n");
} else {
  const failed = results.filter((r) => !r.passed);
  console.log(`Issues to investigate (${failed.length} failed run(s)):`);
  for (const r of failed) {
    const failedChecks = r.checks.filter((c) => !c.pass);
    console.log(`  • ${r.label}`);
    for (const c of failedChecks) {
      console.log(`    - ${c.name}: ${c.detail}`);
    }
  }
  console.log("");
}

console.log(`════════════════════════════════════════════════════════════════`);

process.exit(allPassed ? 0 : 1);
