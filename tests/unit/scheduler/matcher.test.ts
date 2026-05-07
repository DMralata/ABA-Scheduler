/**
 * Unit tests for scheduler/matcher.ts — provider ranking and eligibility.
 *
 * Covers:
 *   - Position tier: RBT preferred over BCaBA over BCBA (margin)
 *   - Drive time: shorter drive wins within same tier
 *   - Position tier beats drive time (don't use BCBA just because they're closer)
 *   - Hard constraint filtering (gender, spanish, rbtLevel)
 *   - No-slot elimination when availability doesn't overlap
 */

import { describe, it, expect } from "vitest";
import { findEligibleProviders } from "@/lib/scheduler/matcher";
import { makeClient, makeRbt, makeBcaBA, makeBcba, makeWorkingState, WEEK_DATES_MON } from "./fixtures";

// ─── Position Tier ────────────────────────────────────────────────────────────

describe("position tier — BCBA as last resort", () => {
  it("prefers RBT over BCBA when both are eligible", () => {
    const client = makeClient();
    const rbt  = makeRbt({ id: "rbt-1" });
    const bcba = makeBcba({ id: "bcba-1" });
    const state = makeWorkingState();

    const { ranked } = findEligibleProviders(client, [rbt, bcba], WEEK_DATES_MON, {}, state);

    expect(ranked.length).toBe(2);
    expect(ranked[0].provider.id).toBe("rbt-1");
    expect(ranked[1].provider.id).toBe("bcba-1");
  });

  it("prefers BCaBA over BCBA when both are eligible", () => {
    const client = makeClient();
    const bcaba = makeBcaBA({ id: "bcaba-1" });
    const bcba  = makeBcba({ id: "bcba-1" });
    const state = makeWorkingState();

    const { ranked } = findEligibleProviders(client, [bcaba, bcba], WEEK_DATES_MON, {}, state);

    expect(ranked.length).toBe(2);
    expect(ranked[0].provider.id).toBe("bcaba-1");
    expect(ranked[1].provider.id).toBe("bcba-1");
  });

  it("orders all three positions correctly: RBT → BCaBA → BCBA", () => {
    const client = makeClient();
    const providers = [
      makeBcba({ id: "bcba-1" }),
      makeBcaBA({ id: "bcaba-1" }),
      makeRbt({ id: "rbt-1" }),
    ];
    const state = makeWorkingState();

    const { ranked } = findEligibleProviders(client, providers, WEEK_DATES_MON, {}, state);

    expect(ranked.map(r => r.provider.id)).toEqual(["rbt-1", "bcaba-1", "bcba-1"]);
  });

  it("still assigns a BCBA when they are the only eligible provider", () => {
    const client = makeClient();
    const bcba = makeBcba({ id: "bcba-1" });
    const state = makeWorkingState();

    const { ranked, failures } = findEligibleProviders(client, [bcba], WEEK_DATES_MON, {}, state);

    expect(ranked.length).toBe(1);
    expect(ranked[0].provider.id).toBe("bcba-1");
    expect(failures.length).toBe(0);
  });

  it("position tier takes priority over drive time — RBT with longer drive beats nearby BCBA", () => {
    const client = makeClient({ id: "client-1" });
    const rbt  = makeRbt({ id: "rbt-1" });
    const bcba = makeBcba({ id: "bcba-1" });
    const state = makeWorkingState();

    // BCBA is 5 min away, RBT is 30 min away
    const driveMinutes = {
      "rbt-1":  { "client-1": 30 },
      "bcba-1": { "client-1": 5  },
    };

    const { ranked } = findEligibleProviders(client, [rbt, bcba], WEEK_DATES_MON, driveMinutes, state);

    // RBT must still be ranked first despite higher drive time
    expect(ranked[0].provider.id).toBe("rbt-1");
    expect(ranked[1].provider.id).toBe("bcba-1");
  });
});

// ─── Drive Time Ranking ───────────────────────────────────────────────────────

describe("drive time ranking within the same position tier", () => {
  it("prefers the RBT with shorter drive time when loads are equal", () => {
    const client = makeClient({ id: "client-1" });
    const rbtNear = makeRbt({ id: "rbt-near", lastName: "Near" });
    const rbtFar  = makeRbt({ id: "rbt-far",  lastName: "Far"  });
    const state = makeWorkingState();

    const driveMinutes = {
      "rbt-near": { "client-1": 10 },
      "rbt-far":  { "client-1": 40 },
    };

    const { ranked } = findEligibleProviders(client, [rbtFar, rbtNear], WEEK_DATES_MON, driveMinutes, state);

    expect(ranked[0].provider.id).toBe("rbt-near");
    expect(ranked[1].provider.id).toBe("rbt-far");
  });

  it("exposes driveMinutes on each ranked entry for reasoning output", () => {
    const client = makeClient({ id: "client-1" });
    const rbt = makeRbt({ id: "rbt-1" });
    const driveMinutes = { "rbt-1": { "client-1": 22 } };
    const state = makeWorkingState();

    const { ranked } = findEligibleProviders(client, [rbt], WEEK_DATES_MON, driveMinutes, state);

    expect(ranked[0].driveMinutes).toBe(22);
  });

  it("treats missing drive matrix entry as 0 minutes (co-located fallback)", () => {
    const client = makeClient({ id: "client-1" });
    const rbt = makeRbt({ id: "rbt-1" });
    const state = makeWorkingState();

    // No drive matrix at all
    const { ranked } = findEligibleProviders(client, [rbt], WEEK_DATES_MON, {}, state);

    expect(ranked[0].driveMinutes).toBe(0);
  });

  it("committed hours rank above both position tier and drive time", () => {
    // An RBT with 4h already committed should lose to a BCBA with 0h committed.
    // This keeps load balanced even if it means using a more expensive provider.
    const client = makeClient({ id: "client-1" });
    const rbt  = makeRbt({ id: "rbt-1" });
    const bcba = makeBcba({ id: "bcba-1" });
    const state = makeWorkingState();

    // Give the RBT 4 committed hours this run
    state.providerHoursCommitted.set("rbt-1", 4);

    const { ranked } = findEligibleProviders(client, [rbt, bcba], WEEK_DATES_MON, {}, state);

    // BCBA has 0 committed hours → ranked first despite being lower tier
    expect(ranked[0].provider.id).toBe("bcba-1");
    expect(ranked[1].provider.id).toBe("rbt-1");
  });
});

// ─── Hard Constraint Filtering ────────────────────────────────────────────────

describe("hard constraint filtering", () => {
  it("excludes providers that fail the female-only requirement", () => {
    const client = makeClient({ femaleProviderOnly: true });
    const male   = makeRbt({ id: "rbt-male",   gender: "male"   });
    const female = makeRbt({ id: "rbt-female", gender: "female" });
    const state  = makeWorkingState();

    const { ranked, failures } = findEligibleProviders(client, [male, female], WEEK_DATES_MON, {}, state);

    expect(ranked.length).toBe(1);
    expect(ranked[0].provider.id).toBe("rbt-female");
    expect(failures.length).toBe(1);
    expect(failures[0].providerId).toBe("rbt-male");
  });

  it("excludes RBTs below the client's minimum RBT level", () => {
    const client    = makeClient({ minimumRbtLevel: "III" });
    const levelII   = makeRbt({ id: "rbt-level-ii",  rbtLevel: "II"  });
    const levelIII  = makeRbt({ id: "rbt-level-iii", rbtLevel: "III" });
    const state     = makeWorkingState();

    const { ranked, failures } = findEligibleProviders(client, [levelII, levelIII], WEEK_DATES_MON, {}, state);

    expect(ranked.map(r => r.provider.id)).toEqual(["rbt-level-iii"]);
    expect(failures[0].providerId).toBe("rbt-level-ii");
  });

  it("BCBAs pass the RBT level check regardless of level requirement", () => {
    // BCBAs are exempt from the RBT level hierarchy
    const client = makeClient({ minimumRbtLevel: "III" });
    const bcba   = makeBcba({ id: "bcba-1" });
    const state  = makeWorkingState();

    const { ranked } = findEligibleProviders(client, [bcba], WEEK_DATES_MON, {}, state);

    expect(ranked.length).toBe(1);
  });

  it("excludes non-Spanish providers when client requires Spanish", () => {
    const client      = makeClient({ spanish: true });
    const nonSpanish  = makeRbt({ id: "rbt-en", spanish: false });
    const spanishRbt  = makeRbt({ id: "rbt-es", spanish: true  });
    const state       = makeWorkingState();

    const { ranked } = findEligibleProviders(client, [nonSpanish, spanishRbt], WEEK_DATES_MON, {}, state);

    expect(ranked.map(r => r.provider.id)).toEqual(["rbt-es"]);
  });

  it("eliminates a provider with no overlapping availability and records the reason", () => {
    const client = makeClient({
      availability: [{ dayOfWeek: "MONDAY", startTime: "08:00", endTime: "10:00" }],
    });
    // Provider only available in the afternoon
    const rbt = makeRbt({
      id: "rbt-pm",
      availability: [{ dayOfWeek: "MONDAY", startTime: "14:00", endTime: "18:00" }],
    });
    const state = makeWorkingState();

    const { ranked, failures } = findEligibleProviders(client, [rbt], WEEK_DATES_MON, {}, state);

    expect(ranked.length).toBe(0);
    expect(failures[0].reason).toMatch(/No overlapping availability/);
  });
});
