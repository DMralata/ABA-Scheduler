// Pure constraint predicates for the rules-based scheduling engine.
// Each function takes scheduler types (not Prisma model types) and returns
// synchronously — no database calls, no side effects.

import type { RbtLevel } from "@prisma/client";
import type { SchedulerClient, SchedulerProvider } from "./types";

export interface ConstraintResult {
  pass: boolean;
  reason: string; // empty string when pass === true
}

// ─── RBT Level ───────────────────────────────────────────────────────────────

const RBT_RANK: Record<RbtLevel, number> = { I: 1, II: 2, III: 3 };

export function checkRbtLevel(
  client: Pick<SchedulerClient, "minimumRbtLevel">,
  provider: Pick<SchedulerProvider, "position" | "rbtLevel">
): ConstraintResult {
  if (!client.minimumRbtLevel) return { pass: true, reason: "" };
  // BCBAs and BCaBAs are exempt from the RBT level requirement
  if (provider.position !== "RBT") return { pass: true, reason: "" };

  if (!provider.rbtLevel) {
    return { pass: false, reason: "Provider has no RBT level assigned" };
  }
  if (RBT_RANK[provider.rbtLevel] < RBT_RANK[client.minimumRbtLevel]) {
    return {
      pass: false,
      reason: `Client requires RBT Level ${client.minimumRbtLevel}, provider is Level ${provider.rbtLevel}`,
    };
  }
  return { pass: true, reason: "" };
}

// ─── Female Provider Only ─────────────────────────────────────────────────────

export function checkFemaleRequirement(
  client: Pick<SchedulerClient, "femaleProviderOnly">,
  provider: Pick<SchedulerProvider, "gender">
): ConstraintResult {
  if (!client.femaleProviderOnly) return { pass: true, reason: "" };
  if (provider.gender.toLowerCase() !== "female") {
    return { pass: false, reason: "Client requires a female provider" };
  }
  return { pass: true, reason: "" };
}

// ─── Spanish Requirement ──────────────────────────────────────────────────────

export function checkSpanishRequirement(
  client: Pick<SchedulerClient, "spanish">,
  provider: Pick<SchedulerProvider, "spanish">
): ConstraintResult {
  if (!client.spanish) return { pass: true, reason: "" };
  if (!provider.spanish) {
    return { pass: false, reason: "Client requires a Spanish-speaking provider" };
  }
  return { pass: true, reason: "" };
}

// ─── Approved Provider (Home) ─────────────────────────────────────────────────

export function checkApprovedForClient(
  client: Pick<SchedulerClient, "approvedProviderIds">,
  provider: Pick<SchedulerProvider, "id">
): ConstraintResult {
  // No restriction if no approved list is set
  if (client.approvedProviderIds.length === 0) return { pass: true, reason: "" };
  if (!client.approvedProviderIds.includes(provider.id)) {
    return { pass: false, reason: "Provider is not on the client's approved provider list" };
  }
  return { pass: true, reason: "" };
}

// ─── Authorization ────────────────────────────────────────────────────────────

export function checkHasAuthorization(
  client: Pick<SchedulerClient, "authorizationId">
): ConstraintResult {
  if (!client.authorizationId) {
    return { pass: false, reason: "Client has no active authorization for this week" };
  }
  return { pass: true, reason: "" };
}

const MIN_SESSION_HOURS = 1.5;

export function checkRemainingHours(
  client: Pick<SchedulerClient, "approvedWeeklyHours" | "usedHoursThisWeek">,
  sessionHours: number
): ConstraintResult {
  const remaining = client.approvedWeeklyHours - client.usedHoursThisWeek;
  if (remaining < MIN_SESSION_HOURS) {
    return {
      pass: false,
      reason: `Only ${remaining.toFixed(1)}h remaining — below ${MIN_SESSION_HOURS}h minimum session length`,
    };
  }
  if (remaining < sessionHours) {
    return {
      pass: false,
      reason: `Only ${remaining.toFixed(1)}h remaining of ${client.approvedWeeklyHours}h authorized (need ${sessionHours}h)`,
    };
  }
  return { pass: true, reason: "" };
}
