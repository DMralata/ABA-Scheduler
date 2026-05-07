// Rules-based scheduling engine — public API.
// Runs the deterministic greedy optimizer, validates each proposal against
// business rules, and saves valid proposals to the ProposedSession table.

import { DayOfWeek } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { optimize, createWorkingState } from "./optimizer";
import type { SchedulerInput, SchedulerOutput } from "./types";
import { SESSION_CONFLICT_STATUSES } from "@/lib/queries/sessions";

// Map DayOfWeek enum to ISO weekday offset from Monday (0 = Mon, 6 = Sun)
const DAY_OFFSET: Record<DayOfWeek, number> = {
  MONDAY:    0,
  TUESDAY:   1,
  WEDNESDAY: 2,
  THURSDAY:  3,
  FRIDAY:    4,
  SATURDAY:  5,
  SUNDAY:    6,
};

/**
 * Converts a DayOfWeek + HH:MM local time string into a UTC Date for the given week.
 * weekOf is Monday midnight UTC of the target week.
 */
function toUtcDateTime(
  weekOf: Date,
  dayOfWeek: DayOfWeek,
  localTime: string,
  timezone: string
): Date {
  const [hours, minutes] = localTime.split(":").map(Number);
  const dayOffset = DAY_OFFSET[dayOfWeek];

  // Build the local date string for that day
  const targetDate = new Date(weekOf.getTime() + dayOffset * 24 * 3_600_000);
  const dateStr = targetDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Use Intl to find UTC offset for that local date+time
  const localMidnight = new Date(`${dateStr}T12:00:00Z`); // noon UTC anchor
  const localNoonStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(localMidnight);

  // localNoonStr is like "2026-03-24, 08:00" — extract the date portion
  const localDateOnly = localNoonStr.slice(0, 10);

  // Compute the UTC offset (including sub-hour minute component for e.g. India +5:30)
  const noonUTC = new Date(`${localDateOnly}T12:00:00Z`);
  const localNoonHour = parseInt(localNoonStr.slice(12, 14), 10);
  const localNoonMin  = parseInt(localNoonStr.slice(15, 17), 10);
  const offsetMs = (12 - localNoonHour) * 3_600_000 - localNoonMin * 60_000;

  // UTC time = local midnight + offset + hours/minutes
  const localMidnightUTC = new Date(noonUTC.getTime() + offsetMs - 12 * 3_600_000);
  return new Date(localMidnightUTC.getTime() + hours * 3_600_000 + minutes * 60_000);
}

export async function runScheduler(input: SchedulerInput): Promise<SchedulerOutput> {
  // Run the deterministic greedy optimizer — no external API calls
  const workingState = createWorkingState();
  const result = optimize(input, workingState);

  // Pre-load all sessions and proposals that could conflict with our proposals.
  // This converts 3 per-proposal DB queries into 2 upfront batch queries,
  // reducing round-trips from O(3N) to O(2 + N) for N proposals.
  const weekEnd = new Date(input.weekOf.getTime() + 7 * 24 * 3_600_000);
  const providerIds = input.providers.map((p) => p.id);
  const clientIds = input.clients.map((c) => c.id);

  const [preloadedSessions, preloadedProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        providerId: { in: providerIds },
        // Block provider time for SCHEDULED/IN_PROGRESS sessions and for CANCELLED sessions
        // where the provider called out sick. Client-cancelled sessions free the provider's
        // slot and must NOT appear here — the provider can be re-assigned during that window.
        OR: [
          { status: { in: SESSION_CONFLICT_STATUSES } },
          { status: "CANCELLED", cancelledBy: "PROVIDER" },
        ],
        AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: input.weekOf } }],
      },
      select: { providerId: true, clientId: true, startTime: true, endTime: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        OR: [{ providerId: { in: providerIds } }, { clientId: { in: clientIds } }],
        status: { in: ["PENDING", "APPROVED"] },
        AND: [{ startTime: { lt: weekEnd } }, { endTime: { gt: input.weekOf } }],
      },
      select: { id: true, providerId: true, clientId: true, startTime: true, endTime: true },
    }),
  ]);

  // Helper: true if two time ranges overlap
  function overlaps(
    aStart: Date, aEnd: Date,
    bStart: Date, bEnd: Date
  ): boolean {
    return aStart < bEnd && aEnd > bStart;
  }

  // Proposals saved in this run are tracked here and excluded from conflict checks.
  // (WorkingState already prevents intra-run double-bookings in the optimizer.)
  const thisRunIds = new Set<string>();

  // Save valid proposals to the database
  const savedClientIds: string[] = [];
  const failedProposals: string[] = [];
  const savedProposalIds: string[] = [];

  // Track ALL saved proposals with location type so we can create drive time
  // sessions between any consecutive pair that ends with a HOME session.
  // Covers both HOME→HOME and CENTER→HOME transitions.
  const savedDetails: Array<{
    clientId: string;
    providerId: string;
    startTime: Date;
    endTime: Date;
    locationType: "HOME" | "CENTER" | "SCHOOL";
  }> = [];

  for (const proposal of result.proposals) {
    try {
      const startTime = toUtcDateTime(
        input.weekOf,
        proposal.dayOfWeek as DayOfWeek,
        proposal.startTime,
        input.timezone
      );
      const endTime = toUtcDateTime(
        input.weekOf,
        proposal.dayOfWeek as DayOfWeek,
        proposal.endTime,
        input.timezone
      );

      // Sanity check — optimizer should never produce this, but guard anyway
      if (endTime <= startTime) {
        failedProposals.push(`${proposal.clientId}: end time not after start time`);
        continue;
      }

      // Rest of Day mode: skip proposals that have already started
      if (input.notBefore && startTime < input.notBefore) {
        failedProposals.push(`${proposal.clientId}: slot already passed (Rest of Day mode)`);
        continue;
      }

      // Guard against double-booking a client (in-memory check).
      const existingClientProposal = preloadedProposals.find(
        (p) =>
          !thisRunIds.has(p.id) &&
          p.clientId === proposal.clientId &&
          overlaps(startTime, endTime, p.startTime, p.endTime)
      );
      if (existingClientProposal) {
        failedProposals.push(
          `${proposal.clientId}: overlaps an existing ${
            existingClientProposal.id ? "pending/approved" : "unknown"
          } proposal`
        );
        continue;
      }

      // Check for provider double-booking against SCHEDULED/IN_PROGRESS sessions (in-memory).
      const providerConflict = preloadedSessions.find(
        (s) =>
          s.providerId === proposal.providerId &&
          overlaps(startTime, endTime, s.startTime, s.endTime)
      );
      if (providerConflict) {
        failedProposals.push(`${proposal.clientId}: provider conflict with existing session`);
        continue;
      }

      // Check for provider double-booking against PENDING/APPROVED proposals (in-memory).
      // Exclude proposals saved in this run — the optimizer's working state already
      // prevents intra-run conflicts; re-checking them would cause cascade failures.
      const providerProposalConflict = preloadedProposals.find(
        (p) =>
          !thisRunIds.has(p.id) &&
          p.providerId === proposal.providerId &&
          overlaps(startTime, endTime, p.startTime, p.endTime)
      );
      if (providerProposalConflict) {
        failedProposals.push(`${proposal.clientId}: provider conflict with existing proposal`);
        continue;
      }

      const saved = await prisma.proposedSession.create({
        data: {
          weekOf: input.weekOf,
          clientId: proposal.clientId,
          providerId: proposal.providerId,
          sessionTypeId: proposal.sessionTypeId,
          authorizationId: proposal.authorizationId,
          startTime,
          endTime,
          timezone: input.timezone,
          locationType: proposal.locationType,
          status: "PENDING",
          reasoning: proposal.reasoning,
        },
      });

      savedProposalIds.push(saved.id);
      thisRunIds.add(saved.id);
      // Add to the in-memory set so subsequent proposals in this run see it
      preloadedProposals.push({
        id: saved.id,
        providerId: proposal.providerId,
        clientId: proposal.clientId,
        startTime,
        endTime,
      });
      savedClientIds.push(proposal.clientId);

      // Track all proposals for drive-time session creation after the loop
      savedDetails.push({
        clientId: proposal.clientId,
        providerId: proposal.providerId,
        startTime,
        endTime,
        locationType: proposal.locationType,
      });
    } catch (err) {
      failedProposals.push(
        `${proposal.clientId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Create Drive Time sessions between consecutive sessions ending at HOME ────
  // Whenever the same provider transitions to a HOME session, insert a Drive Time
  // session covering the travel gap. Handles both HOME→HOME and CENTER→HOME.
  //
  // Drive time lookup strategy:
  //   HOME→HOME:   client-to-client distance (driveMinutes[fromClientId][toClientId])
  //   CENTER→HOME: provider-to-client distance (driveMinutes[providerId][toClientId])
  //                (provider home is the best available proxy for clinic location)
  //
  // "allDetails" combines:
  //   - savedDetails: all proposals created in this run (HOME + CENTER)
  //   - existingHomeSessions: APPROVED/SCHEDULED HOME sessions from prior runs
  const allDetails = [
    ...savedDetails,
    ...(input.existingHomeSessions ?? []).map((s) => ({ ...s, locationType: "HOME" as const })),
  ];

  if (input.driveTimeSessionTypeId && allDetails.length >= 2) {
    // Group by provider
    const byProvider = new Map<string, typeof allDetails>();
    for (const detail of allDetails) {
      if (!byProvider.has(detail.providerId)) byProvider.set(detail.providerId, []);
      byProvider.get(detail.providerId)!.push(detail);
    }

    for (const [providerId, provDetails] of byProvider) {
      if (provDetails.length < 2) continue;
      const sorted = [...provDetails].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      for (let i = 0; i < sorted.length - 1; i++) {
        const from = sorted[i];
        const to = sorted[i + 1];

        // Drive blocks are needed whenever the provider physically moves between
        // distinct fixed locations or to/from a client home. Skip cases where the
        // provider stays put (CENTER→CENTER, SCHOOL→SCHOOL).
        const fromLoc = from.locationType;
        const toLoc = to.locationType;
        const sameFixedLocation =
          (fromLoc === "CENTER" && toLoc === "CENTER") ||
          (fromLoc === "SCHOOL" && toLoc === "SCHOOL");
        if (sameFixedLocation) continue;
        const isHomeToCenter = fromLoc === "HOME" && toLoc === "CENTER";
        const isCenterToHome = fromLoc === "CENTER" && toLoc === "HOME";
        const isHomeToHome = fromLoc === "HOME" && toLoc === "HOME";
        const isHomeToSchool = fromLoc === "HOME" && toLoc === "SCHOOL";
        const isSchoolToHome = fromLoc === "SCHOOL" && toLoc === "HOME";
        const isSchoolToCenter = fromLoc === "SCHOOL" && toLoc === "CENTER";
        const isCenterToSchool = fromLoc === "CENTER" && toLoc === "SCHOOL";

        // Only insert if there is actually a gap between the two sessions
        if (from.endTime >= to.startTime) continue;

        // Only create drive time between sessions on the same calendar day.
        // In week mode savedDetails spans all 5 days — without this check the loop
        // would attempt to create a drive block between e.g. Monday 5pm and Tuesday 9am.
        const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone });
        if (fmt.format(from.endTime) !== fmt.format(to.startTime)) continue;

        // Only create a DB Drive Time session when the Maps API returned real data.
        // When apiMins = 0 (API failure or no route found), skip the DB session so the
        // pseudo-event logic in sessions/route.ts can generate a block with a fresh Maps
        // call instead of persisting a misleading driveMinutes value in the notes.
        //
        // Drive time lookup strategy per transition type:
        //   HOME→HOME:    client-to-client distance (driveMinutes[fromClientId][toClientId])
        //   CENTER→HOME:  center→client (driveMinutes[centerId][toClientId])
        //   HOME→CENTER:  center→client used as symmetric proxy (driveMinutes[centerId][fromClientId])
        //   SCHOOL→HOME:  school→client (driveMinutes[schoolOriginId][toClientId])
        //   HOME→SCHOOL:  school→client used as symmetric proxy (driveMinutes[schoolOriginId][fromClientId])
        //   CENTER↔SCHOOL: school→center direct lookup (haversine fallback populated at request build time)
        const centerOriginId = input.centerId ?? providerId;
        const schoolOriginId = input.schoolOriginId ?? null;
        let apiMins = 0;
        if (isHomeToHome) {
          apiMins = input.driveMinutes[from.clientId]?.[to.clientId] ?? 0;
        } else if (isCenterToHome) {
          apiMins = input.driveMinutes[centerOriginId]?.[to.clientId] ?? 0;
        } else if (isHomeToCenter) {
          apiMins = input.driveMinutes[centerOriginId]?.[from.clientId] ?? 0;
        } else if (isSchoolToHome && schoolOriginId) {
          apiMins = input.driveMinutes[schoolOriginId]?.[to.clientId] ?? 0;
        } else if (isHomeToSchool && schoolOriginId) {
          apiMins = input.driveMinutes[schoolOriginId]?.[from.clientId] ?? 0;
        } else if ((isSchoolToCenter || isCenterToSchool) && schoolOriginId) {
          apiMins = input.driveMinutes[schoolOriginId]?.[centerOriginId] ?? 0;
        }
        if (apiMins <= 0) continue;
        const driveMins = apiMins;

        // Round up to the nearest 15 min so the block always fills a full slot;
        // the remainder is "Misc. Setup and Parking Allocation" time.
        const roundedMins = Math.ceil(driveMins / 15) * 15;
        const driveEnd = new Date(from.endTime.getTime() + roundedMins * 60_000);
        // Don't overshoot the next session
        const clampedEnd = driveEnd <= to.startTime ? driveEnd : to.startTime;

        // Look up names/coordinates for the drive summary panel.
        // "from" is a client only when it's a HOME session; CENTER and SCHOOL sessions have no client at the from-side.
        const fromClient = fromLoc === "HOME" ? input.clients.find((c) => c.id === from.clientId) : null;
        const toClient = toLoc === "HOME" ? input.clients.find((c) => c.id === to.clientId) : null;
        let distMeters = 0;
        if (isHomeToHome) {
          distMeters = input.distanceMeters[from.clientId]?.[to.clientId] ?? 0;
        } else if (isCenterToHome) {
          distMeters = input.distanceMeters[centerOriginId]?.[to.clientId] ?? 0;
        } else if (isHomeToCenter) {
          distMeters = input.distanceMeters[centerOriginId]?.[from.clientId] ?? 0;
        } else if (isSchoolToHome && schoolOriginId) {
          distMeters = input.distanceMeters[schoolOriginId]?.[to.clientId] ?? 0;
        } else if (isHomeToSchool && schoolOriginId) {
          distMeters = input.distanceMeters[schoolOriginId]?.[from.clientId] ?? 0;
        } else if ((isSchoolToCenter || isCenterToSchool) && schoolOriginId) {
          distMeters = input.distanceMeters[schoolOriginId]?.[centerOriginId] ?? 0;
        }
        const fromLabel = fromLoc === "HOME"
          ? (fromClient ? `${fromClient.lastName}, ${fromClient.firstName}` : from.clientId)
          : fromLoc === "SCHOOL" ? "School" : "Center";
        const toLabel = toLoc === "HOME"
          ? (toClient ? `${toClient.lastName}, ${toClient.firstName}` : to.clientId)
          : toLoc === "SCHOOL" ? "School" : "Center";
        const driveNotes = JSON.stringify({
          fromClientId: fromLoc === "HOME" ? from.clientId : null,
          fromName: fromLabel,
          fromLat: fromClient?.latitude ?? null,
          fromLng: fromClient?.longitude ?? null,
          toClientId: toLoc === "HOME" ? to.clientId : null,
          toName: toLabel,
          toLat: toClient?.latitude ?? null,
          toLng: toClient?.longitude ?? null,
          driveMinutes: driveMins,
          distanceMeters: distMeters,
        });

        try {
          await prisma.session.create({
            data: {
              name: "Drive Time",
              sessionTypeId: input.driveTimeSessionTypeId,
              providerId,
              clientId: null,
              startTime: from.endTime,
              endTime: clampedEnd,
              timezone: input.timezone,
              billable: false,
              status: "SCHEDULED",
              notes: driveNotes,
            },
          });
        } catch {
          // Non-fatal — drive time session creation failure should not abort the run
        }
      }
    }
  }

  // Merge skip reasons from the optimizer with any save-time failures
  const saveFailureReasons: Record<string, string> = {};
  for (const entry of failedProposals) {
    const colonIdx = entry.indexOf(":");
    if (colonIdx !== -1) {
      const id = entry.slice(0, colonIdx).trim();
      saveFailureReasons[id] = entry.slice(colonIdx + 1).trim();
    }
  }

  const allSkipReasons = { ...result.skipReasons, ...saveFailureReasons };

  const savedSet = new Set(savedClientIds);
  const unscheduledClientIds = input.clients
    .map((c) => c.id)
    .filter((id) => !savedSet.has(id));

  const estimatedTotalDriveMinutes = result.proposals
    .filter((p) => savedSet.has(p.clientId))
    .reduce((sum, p) => sum + (input.driveMinutes[p.providerId]?.[p.clientId] ?? 0), 0);

  // Clients that were on the schedule for this day (roster-locked) but couldn't be
  // rescheduled after the full two-pass attempt. These require immediate attention —
  // they had a confirmed session that was disrupted and no alternate provider was found.
  const unservedRosterClients = (input.lockedClientIds ?? [])
    .filter((id) => !savedSet.has(id))
    .map((id) => ({
      clientId: id,
      reason: allSkipReasons[id] ?? "No eligible provider found after full retry pass",
    }));

  return {
    proposals: result.proposals,
    totalClientsScheduled: savedClientIds.length,
    totalClientsUnscheduled: unscheduledClientIds.length,
    unscheduledClientIds,
    estimatedTotalDriveMinutes,
    skipReasons: allSkipReasons,
    warnings: result.warnings,
    unservedRosterClients,
  };
}
