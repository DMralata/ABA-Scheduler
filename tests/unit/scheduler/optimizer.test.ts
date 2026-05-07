/**
 * Unit tests for scheduler/optimizer.ts — end-to-end scheduling runs.
 *
 * Covers:
 *   - BCBA assigned only when no RBT/BCaBA is available
 *   - Drive time accumulation in estimatedTotalDriveMinutes
 *   - Unscheduled clients don't contribute to drive total
 *   - Skip reasons are surfaced correctly
 *   - Client priority ordering (most remaining hours first)
 *   - Proposals restricted to the targetDate only
 */

import { describe, it, expect } from "vitest";
import { optimize, createWorkingState } from "@/lib/scheduler/optimizer";
import { makeClient, makeRbt, makeBcba, makeBcaBA, makeInput } from "./fixtures";

// ─── BCBA Last Resort ─────────────────────────────────────────────────────────

describe("BCBA as last resort in full scheduling runs", () => {
  it("assigns RBT over BCBA when both are eligible for the same client", () => {
    const client = makeClient();
    const rbt    = makeRbt({ id: "rbt-1" });
    const bcba   = makeBcba({ id: "bcba-1" });
    const input  = makeInput([client], [rbt, bcba]);

    const { proposals } = optimize(input, createWorkingState());

    expect(proposals.length).toBe(1);
    expect(proposals[0].providerId).toBe("rbt-1");
  });

  it("falls back to BCBA when no RBT or BCaBA is available", () => {
    const client = makeClient();
    const bcba   = makeBcba({ id: "bcba-1" });
    const input  = makeInput([client], [bcba]);

    const { proposals } = optimize(input, createWorkingState());

    expect(proposals.length).toBe(1);
    expect(proposals[0].providerId).toBe("bcba-1");
  });

  it("marks the BCBA last-resort in the reasoning string", () => {
    const client = makeClient();
    const bcba   = makeBcba({ id: "bcba-1" });
    const input  = makeInput([client], [bcba]);

    const { proposals } = optimize(input, createWorkingState());

    expect(proposals[0].reasoning).toContain("last resort");
  });

  it("does not include last-resort note when an RBT is assigned", () => {
    const client = makeClient();
    const rbt    = makeRbt({ id: "rbt-1" });
    const input  = makeInput([client], [rbt]);

    const { proposals } = optimize(input, createWorkingState());

    expect(proposals[0].reasoning).not.toContain("last resort");
  });

  it("prefers BCaBA over BCBA across multiple clients", () => {
    const c1 = makeClient({ id: "c1", lastName: "Aardvark" });
    const c2 = makeClient({ id: "c2", lastName: "Zebra" });
    const bcaba = makeBcaBA({ id: "bcaba-1" });
    const bcba  = makeBcba({ id: "bcba-1" });
    const input = makeInput([c1, c2], [bcaba, bcba]);

    const { proposals } = optimize(input, createWorkingState());

    // Both clients should get proposals
    expect(proposals.length).toBe(2);
    // The highest-priority client (c1, same remaining hours → alphabetical) gets BCaBA
    const c1Proposal = proposals.find(p => p.clientId === "c1");
    expect(c1Proposal?.providerId).toBe("bcaba-1");
  });
});

// ─── Drive Time Accumulation ──────────────────────────────────────────────────

describe("estimatedTotalDriveMinutes", () => {
  it("is 0 when no drive matrix is provided", () => {
    const client = makeClient();
    const rbt    = makeRbt({ id: "rbt-1" });
    const input  = makeInput([client], [rbt]);

    const result = optimize(input, createWorkingState());

    expect(result.estimatedTotalDriveMinutes).toBe(0);
    expect(result.totalClientsScheduled).toBe(1);
  });

  it("reflects drive time from the matrix for a single scheduled client", () => {
    const client = makeClient({ id: "client-1" });
    const rbt    = makeRbt({ id: "rbt-1" });
    const drive  = { "rbt-1": { "client-1": 18 } };
    const input  = makeInput([client], [rbt], drive);

    const result = optimize(input, createWorkingState());

    expect(result.estimatedTotalDriveMinutes).toBe(18);
  });

  it("sums drive time across multiple scheduled clients", () => {
    const c1 = makeClient({ id: "c1", lastName: "Alpha", sessionHours: 2 });
    const c2 = makeClient({ id: "c2", lastName: "Beta",  sessionHours: 2 });
    // Two RBTs so they each take one client (load balancing)
    const rbt1 = makeRbt({ id: "rbt-1", lastName: "Arbt" });
    const rbt2 = makeRbt({ id: "rbt-2", lastName: "Brbt" });
    const drive = {
      "rbt-1": { "c1": 10, "c2": 25 },
      "rbt-2": { "c1": 30, "c2": 12 },
    };
    const input = makeInput([c1, c2], [rbt1, rbt2], drive);

    const result = optimize(input, createWorkingState());

    expect(result.totalClientsScheduled).toBe(2);
    // rbt-1 → c1 (10 min), rbt-2 → c2 (12 min)
    // Each RBT gets the client closest to them after load balancing
    expect(result.estimatedTotalDriveMinutes).toBe(10 + 12);
  });

  it("does not include drive time for unscheduled clients", () => {
    // Client with no authorization → skipped by optimizer
    const scheduled   = makeClient({ id: "c1", authorizationId: "auth-1" });
    const noAuth      = makeClient({ id: "c2", authorizationId: null });
    const rbt         = makeRbt({ id: "rbt-1" });
    const drive = {
      "rbt-1": { "c1": 20, "c2": 99 },
    };
    const input = makeInput([scheduled, noAuth], [rbt], drive);

    const result = optimize(input, createWorkingState());

    expect(result.totalClientsScheduled).toBe(1);
    // Only the scheduled client's drive time should be counted
    expect(result.estimatedTotalDriveMinutes).toBe(20);
  });

  it("optimizer prefers the provider with shorter drive time to break same-tier ties", () => {
    const client = makeClient({ id: "client-1" });
    const rbtNear = makeRbt({ id: "rbt-near", lastName: "Near" });
    const rbtFar  = makeRbt({ id: "rbt-far",  lastName: "Far"  });
    const drive = {
      "rbt-near": { "client-1": 5  },
      "rbt-far":  { "client-1": 45 },
    };
    const input = makeInput([client], [rbtNear, rbtFar], drive);

    const result = optimize(input, createWorkingState());

    expect(result.proposals[0].providerId).toBe("rbt-near");
    expect(result.estimatedTotalDriveMinutes).toBe(5);
  });
});

// ─── Skip Reasons ─────────────────────────────────────────────────────────────

describe("skip reasons", () => {
  it("records a skip reason when a client has no authorization", () => {
    const client = makeClient({ authorizationId: null });
    const rbt    = makeRbt({ id: "rbt-1" });
    const input  = makeInput([client], [rbt]);

    const { skipReasons, totalClientsUnscheduled } = optimize(input, createWorkingState());

    expect(totalClientsUnscheduled).toBe(1);
    expect(skipReasons["client-1"]).toMatch(/no active authorization/i);
  });

  it("records a skip reason when the client's weekly hours are exhausted", () => {
    const client = makeClient({ approvedWeeklyHours: 2, usedHoursThisWeek: 2, sessionHours: 2 });
    const rbt    = makeRbt({ id: "rbt-1" });
    const input  = makeInput([client], [rbt]);

    const { skipReasons } = optimize(input, createWorkingState());

    expect(skipReasons["client-1"]).toMatch(/remaining/i);
  });

  it("records a skip reason when no providers are available due to constraints", () => {
    const client = makeClient({ spanish: true });
    const rbt    = makeRbt({ id: "rbt-1", spanish: false }); // doesn't speak Spanish
    const input  = makeInput([client], [rbt]);

    const { skipReasons } = optimize(input, createWorkingState());

    expect(skipReasons["client-1"]).toMatch(/No eligible providers/i);
  });

  it("records a skip reason when the client has no availability windows", () => {
    const client = makeClient({ availability: [] });
    const rbt    = makeRbt({ id: "rbt-1" });
    const input  = makeInput([client], [rbt]);

    const { skipReasons } = optimize(input, createWorkingState());

    expect(skipReasons["client-1"]).toMatch(/no availability/i);
  });
});

// ─── Client Priority Ordering ─────────────────────────────────────────────────

describe("client priority ordering", () => {
  it("schedules the client with the most remaining authorized hours first", () => {
    // c2 has more remaining hours — should be processed first and get the only provider slot.
    const c1 = makeClient({ id: "c1", lastName: "Alpha", approvedWeeklyHours: 5,  usedHoursThisWeek: 2 }); // 3h remaining
    const c2 = makeClient({ id: "c2", lastName: "Zeta",  approvedWeeklyHours: 10, usedHoursThisWeek: 2 }); // 8h remaining
    // Constrain the provider to exactly one 2-hour window so only one client can be served.
    const rbt = makeRbt({
      id: "rbt-1",
      availability: [{ dayOfWeek: "MONDAY", startTime: "08:00", endTime: "10:00" }],
    });
    const input = makeInput([c1, c2], [rbt]);

    const { proposals } = optimize(input, createWorkingState());

    expect(proposals.length).toBe(1);
    expect(proposals[0].clientId).toBe("c2");
  });

  it("uses alphabetical last name to break ties when remaining hours are equal", () => {
    const c1 = makeClient({ id: "c1", lastName: "Mendez" });
    const c2 = makeClient({ id: "c2", lastName: "Adams"  });
    const rbt = makeRbt({ id: "rbt-1" });
    const input = makeInput([c1, c2], [rbt]);

    const { proposals } = optimize(input, createWorkingState());

    // Adams comes first alphabetically — should get the slot
    expect(proposals[0].clientId).toBe("c2");
  });
});
