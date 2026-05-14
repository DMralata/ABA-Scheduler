"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";
import { requireUser } from "@/lib/auth";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Cancel Session ───────────────────────────────────────────────────────────
// Marks a single session as CANCELLED and records who cancelled it.
// cancelledBy is the critical field: the auto-scheduler reads it to know
// whose time is freed — PROVIDER means the client still needs a session,
// CLIENT means the provider's slot is open for a different client.
// When both happen on the same day, the auto-scheduler detects the switch
// opportunity and submits a pending proposal.

export async function cancelSession(
  sessionId: string,
  cancelledBy: "CLIENT" | "PROVIDER",
  reason?: string
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, providerId: true, startTime: true, endTime: true },
  });

  if (!session) return { success: false, error: "Session not found." };

  if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(session.status)) {
    return {
      success: false,
      error: `Cannot cancel a ${session.status.toLowerCase().replace("_", " ")} session.`,
    };
  }

  const cancellationType = await prisma.sessionType.findFirst({
    where: { name: "Cancellation" },
    select: { id: true },
  });

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "CANCELLED",
      cancelledBy,
      cancellationReason: reason ?? null,
      billable: false,
      authorizationId: null,
      ...(cancellationType ? { sessionTypeId: cancellationType.id } : {}),
    },
  });

  // Cancel the backing ProposedSession (if any). Without this, the proposal
  // keeps status=APPROVED with its original authorizationId, and the auto
  // scheduler's otherDayProposals query smuggles its hours right back into
  // usedHoursThisWeek — making the cancelled hours appear still consumed.
  await prisma.proposedSession.updateMany({
    where: { sessionId, status: "APPROVED" },
    data: {
      status: "REJECTED",
      rejectionReason: "Session cancelled",
      rejectedAt: new Date(),
    },
  });

  // Delete adjacent Drive Time sessions — they exist only to span the gap
  // before/after this session. Without cleanup, they linger as orphans on
  // the timeline pointing to a cancelled session.
  if (session.providerId) {
    await prisma.session.deleteMany({
      where: {
        providerId: session.providerId,
        status: "SCHEDULED",
        sessionType: { name: "Drive Time" },
        OR: [
          { endTime: session.startTime },
          { startTime: session.endTime },
        ],
      },
    });
  }

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "Session",
    resourceId: sessionId,
    metadata: { action: "CANCEL", cancelledBy, reason: reason ?? null },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");
  return { success: true, data: { id: sessionId } };
}

// ─── Cancel Rest of Day ───────────────────────────────────────────────────────
// Cancels all remaining SCHEDULED/IN_PROGRESS sessions for a provider or client
// from the given session's start time onwards (same local day), then creates a
// ProviderBlock or ClientBlock covering that window so the scheduler won't
// reassign them for the rest of the day.

export async function cancelRestOfDay(
  sessionId: string,
  party: "CLIENT" | "PROVIDER"
): Promise<ActionResult<{ cancelledCount: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      providerId: true,
      clientId: true,
      startTime: true,
      timezone: true,
      client: { select: { centerId: true } },
      provider: { select: { centerId: true } },
    },
  });

  if (!session) return { success: false, error: "Session not found." };

  const partyId = party === "PROVIDER" ? session.providerId : session.clientId;
  if (!partyId) {
    return { success: false, error: `Session has no ${party.toLowerCase()} assigned.` };
  }

  // Look up the "Cancellation" session type once so updateMany can set it on all cancelled sessions.
  const cancellationType = await prisma.sessionType.findFirst({
    where: { name: "Cancellation" },
    select: { id: true },
  });

  const centerId = session.client?.centerId ?? session.provider?.centerId ?? null;
  const tz = await resolveTimezone(session.timezone, centerId);

  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(session.startTime);

  // Bound the cancellation window to end-of-day in the resolved timezone so it
  // never bleeds into the next local day. (A naive +24h offset from startTime
  // crossed midnight when the session began later in the day.)
  const noonUTC = new Date(`${localDateStr}T12:00:00Z`);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(noonUTC);
  const offH = parseInt(offsetParts.find((p) => p.type === "hour")?.value ?? "12", 10);
  const offM = parseInt(offsetParts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const offS = parseInt(offsetParts.find((p) => p.type === "second")?.value ?? "0", 10);
  const offsetMs = (offH === 24 ? 0 : offH) * 3_600_000 + offM * 60_000 + offS * 1_000;
  const localDayStart = new Date(noonUTC.getTime() - offsetMs);
  const dayEndBound = new Date(localDayStart.getTime() + 24 * 3_600_000);

  const whereFilter =
    party === "PROVIDER" ? { providerId: partyId } : { clientId: partyId };

  // Capture the IDs of sessions about to be cancelled so we can clean up
  // their backing ProposedSessions afterwards (Prisma's updateMany doesn't
  // return affected IDs).
  const toCancel = await prisma.session.findMany({
    where: {
      ...whereFilter,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      startTime: { gte: session.startTime, lt: dayEndBound },
    },
    select: { id: true, providerId: true, startTime: true, endTime: true },
  });
  const toCancelIds = toCancel.map((s) => s.id);

  const cancelled = await prisma.session.updateMany({
    where: { id: { in: toCancelIds } },
    data: {
      status: "CANCELLED",
      cancelledBy: party,
      cancellationReason: `${party === "PROVIDER" ? "Provider" : "Client"} cancelled rest of day`,
      billable: false,
      authorizationId: null,
      ...(cancellationType ? { sessionTypeId: cancellationType.id } : {}),
    },
  });

  // Cancel backing ProposedSessions so their hours don't keep counting toward
  // the client's authorization budget (see cancelSession for the full reason).
  if (toCancelIds.length > 0) {
    await prisma.proposedSession.updateMany({
      where: { sessionId: { in: toCancelIds }, status: "APPROVED" },
      data: {
        status: "REJECTED",
        rejectionReason: "Session cancelled (rest of day)",
        rejectedAt: new Date(),
      },
    });
  }

  // Delete Drive Time sessions adjacent to any cancelled session — same cleanup
  // as cancelSession but for the rest-of-day batch.
  const driveCleanupOr = toCancel
    .filter((s) => s.providerId)
    .flatMap((s) => [
      { providerId: s.providerId!, endTime: s.startTime },
      { providerId: s.providerId!, startTime: s.endTime },
    ]);
  if (driveCleanupOr.length > 0) {
    await prisma.session.deleteMany({
      where: {
        status: "SCHEDULED",
        sessionType: { name: "Drive Time" },
        OR: driveCleanupOr,
      },
    });
  }

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(session.startTime);
  const hour = (timeParts.find((p) => p.type === "hour")?.value ?? "00").replace("24", "00").padStart(2, "0");
  const minute = (timeParts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
  const blockStartTime = `${hour}:${minute}`;
  const blockDate = new Date(`${localDateStr}T00:00:00.000Z`);

  if (party === "PROVIDER") {
    await prisma.providerBlock.create({
      data: {
        providerId: partyId,
        date: blockDate,
        startTime: blockStartTime,
        endTime: "23:59",
        reason: "Provider cancelled rest of day",
      },
    });
  } else {
    await prisma.clientBlock.create({
      data: {
        clientId: partyId,
        date: blockDate,
        startTime: blockStartTime,
        endTime: "23:59",
        reason: "Client cancelled rest of day",
      },
    });
  }

  await writeAuditLog({
    action: "UPDATE",
    resourceType: party === "PROVIDER" ? "Provider" : "Client",
    resourceId: partyId,
    metadata: {
      action: "CANCEL_REST_OF_DAY",
      date: localDateStr,
      blockStartTime,
      cancelledSessions: cancelled.count,
    },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");
  return { success: true, data: { cancelledCount: cancelled.count } };
}

// ─── Remove Block ─────────────────────────────────────────────────────────────
// Deletes a ProviderBlock or ClientBlock. If restoreSessions is true, also
// flips any CANCELLED sessions within that block's date window back to SCHEDULED
// (using Direct Therapy as the session type, same as uncancelSession).

export async function removeBlock(
  blockId: string,
  party: "CLIENT" | "PROVIDER",
  restoreSessions: boolean
): Promise<ActionResult<{ restoredCount: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const directTherapyType = await prisma.sessionType.findFirst({
    where: { name: "Direct Therapy" },
    select: { id: true },
  }) ?? await prisma.sessionType.findFirst({
    where: { billable: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (party === "PROVIDER") {
    const block = await prisma.providerBlock.findUnique({
      where: { id: blockId },
      select: { id: true, providerId: true, date: true },
    });
    if (!block) return { success: false, error: "Block not found." };

    let restoredCount = 0;
    if (restoreSessions) {
      // Restrict the restore window to the single local day represented by block.date.
      // block.date is stored as midnight UTC of the local calendar date the block was
      // created for, so ±12h around it is enough to cover the local day in any tz —
      // 48h would also catch the next day's CANCELLED sessions for back-to-back blocks.
      const provider = await prisma.provider.findUnique({
        where: { id: block.providerId },
        select: { centerId: true },
      });
      const tz = await resolveTimezone(null, provider?.centerId ?? null);
      const { dayStart, dayEnd } = localDayBoundsForBlock(block.date, tz);
      const result = await prisma.session.updateMany({
        where: {
          providerId: block.providerId,
          status: "CANCELLED",
          cancelledBy: "PROVIDER",
          startTime: { gte: dayStart, lt: dayEnd },
        },
        data: {
          status: "SCHEDULED",
          cancelledBy: null,
          cancellationReason: null,
          billable: true,
          ...(directTherapyType ? { sessionTypeId: directTherapyType.id } : {}),
        },
      });
      restoredCount = result.count;
    }

    await prisma.providerBlock.delete({ where: { id: blockId } });

    await writeAuditLog({
      action: "DELETE",
      resourceType: "Provider",
      resourceId: block.providerId,
      metadata: { action: "REMOVE_BLOCK", restoreSessions, restoredCount },
    });

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return { success: true, data: { restoredCount } };
  } else {
    const block = await prisma.clientBlock.findUnique({
      where: { id: blockId },
      select: { id: true, clientId: true, date: true },
    });
    if (!block) return { success: false, error: "Block not found." };

    let restoredCount = 0;
    if (restoreSessions) {
      const client = await prisma.client.findUnique({
        where: { id: block.clientId },
        select: { centerId: true },
      });
      const tz = await resolveTimezone(null, client?.centerId ?? null);
      const { dayStart, dayEnd } = localDayBoundsForBlock(block.date, tz);
      const result = await prisma.session.updateMany({
        where: {
          clientId: block.clientId,
          status: "CANCELLED",
          cancelledBy: "CLIENT",
          startTime: { gte: dayStart, lt: dayEnd },
        },
        data: {
          status: "SCHEDULED",
          cancelledBy: null,
          cancellationReason: null,
          billable: true,
          ...(directTherapyType ? { sessionTypeId: directTherapyType.id } : {}),
        },
      });
      restoredCount = result.count;
    }

    await prisma.clientBlock.delete({ where: { id: blockId } });

    await writeAuditLog({
      action: "DELETE",
      resourceType: "Client",
      resourceId: block.clientId,
      metadata: { action: "REMOVE_BLOCK", restoreSessions, restoredCount },
    });

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return { success: true, data: { restoredCount } };
  }
}

// Compute UTC bounds of the local calendar day that block.date represents.
// block.date is midnight UTC of a "YYYY-MM-DD" derived in the local tz at
// cancel-rest-of-day time. We re-derive the same local date here and convert
// it back to a UTC start/end pair for the timezone.
function localDayBoundsForBlock(blockDate: Date, tz: string): { dayStart: Date; dayEnd: Date } {
  const localDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(blockDate);
  // Use the noon-UTC anchor pattern to find the UTC offset for this local date.
  const noonUTC = new Date(`${localDateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(noonUTC);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12");
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  const s = parseInt(parts.find((p) => p.type === "second")?.value ?? "0");
  const offsetMs = (h === 24 ? 0 : h) * 3_600_000 + m * 60_000 + s * 1_000;
  const dayStart = new Date(noonUTC.getTime() - offsetMs);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
  return { dayStart, dayEnd };
}

// ─── Resolve Timezone ─────────────────────────────────────────────────────────

async function resolveTimezone(
  sessionTimezone?: string | null,
  centerId?: string | null
): Promise<string> {
  if (sessionTimezone) return sessionTimezone;
  if (centerId) {
    const center = await prisma.center.findUnique({
      where: { id: centerId },
      select: { timezone: true },
    });
    if (center?.timezone) return center.timezone;
  }
  return "America/New_York";
}
