"use server";

// Server actions for the proposal approval workflow.
// approveProposedSchedule — converts a PENDING proposal into a real Session.
// rejectProposedSchedule — marks a proposal as REJECTED.

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";
import { getWeekBoundaries } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

// Core approval logic — runs the conflict re-checks, creates the Session, and
// updates the proposal. Shared by both the single-proposal action and the batch
// action so the per-proposal transaction stays identical in either path.
async function approveProposalCore(proposalId: string): Promise<
  | { success: true; sessionId: string; clientId: string | null; providerId: string }
  | { success: false; error: string }
> {
  const proposal = await prisma.proposedSession.findUnique({
    where: { id: proposalId },
    include: {
      client: { select: { centerId: true } },
      sessionType: { select: { name: true, billable: true } },
    },
  });

  if (!proposal) {
    return { success: false, error: "Proposal not found" };
  }
  if (proposal.status !== "PENDING") {
    return {
      success: false,
      error: `Proposal is already ${proposal.status.toLowerCase()}`,
    };
  }

  try {
    // All conflict checks and the session create run inside a single transaction
    // so they are atomic — no race window between check and write.
    const result = await prisma.$transaction(async (tx) => {
      // Re-check provider overlap inside the transaction
      const conflict = await tx.session.findFirst({
        where: {
          providerId: proposal.providerId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          AND: [
            { startTime: { lt: proposal.endTime } },
            { endTime: { gt: proposal.startTime } },
          ],
        },
      });
      if (conflict) {
        throw new Error("Provider now has a conflicting session at this time");
      }

      // Re-check client overlap inside the transaction
      if (proposal.clientId) {
        const clientConflict = await tx.session.findFirst({
          where: {
            clientId: proposal.clientId,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            AND: [
              { startTime: { lt: proposal.endTime } },
              { endTime: { gt: proposal.startTime } },
            ],
          },
        });
        if (clientConflict) {
          throw new Error("Client now has a conflicting session at this time");
        }
      }

      // Re-check ATI (authorized weekly hours) inside the transaction to close race window
      if (proposal.sessionType.billable && proposal.authorizationId && proposal.clientId) {
        const auth = await tx.authorization.findUnique({
          where: { id: proposal.authorizationId },
          select: { approvedHoursPerWeek: true, endDate: true },
        });
        if (auth) {
          // Guard against approving a session after its authorization has expired
          if (auth.endDate < proposal.startTime) {
            throw new Error(
              `This authorization expired on ${auth.endDate.toISOString().slice(0, 10)} and cannot cover this session.`
            );
          }
          const tz = proposal.timezone ?? "America/New_York";
          const { weekStart, weekEnd } = getWeekBoundaries(proposal.startTime, tz);
          const existingSessions = await tx.session.findMany({
            where: {
              clientId: proposal.clientId,
              authorizationId: proposal.authorizationId,
              billable: true,
              status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
              startTime: { gte: weekStart, lt: weekEnd },
            },
            select: { startTime: true, endTime: true },
          });
          const existingHours = existingSessions.reduce(
            (total, s) =>
              total + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000,
            0
          );
          const newHours =
            (proposal.endTime.getTime() - proposal.startTime.getTime()) / 3_600_000;
          if (existingHours + newHours > auth.approvedHoursPerWeek) {
            throw new Error(
              `Approving this session would bring the client's weekly billable hours to ${(existingHours + newHours).toFixed(1)}, exceeding their authorized ${auth.approvedHoursPerWeek} hours/week.`
            );
          }
        }
      }

      const session = await tx.session.create({
        data: {
          name: `${proposal.sessionType.name}`,
          sessionTypeId: proposal.sessionTypeId,
          providerId: proposal.providerId,
          clientId: proposal.clientId,
          authorizationId: proposal.authorizationId,
          startTime: proposal.startTime,
          endTime: proposal.endTime,
          timezone: proposal.timezone,
          // Auto-scheduler proposes HOME, CENTER, or SCHOOL sessions; HYBRID is
          // resolved to one of these at scheduling time. Fall back to CENTER if
          // somehow null so downstream validations see a concrete type.
          locationType: proposal.locationType ?? "CENTER",
          billable: proposal.sessionType.billable,
          status: "SCHEDULED",
        },
      });

      await tx.proposedSession.update({
        where: { id: proposalId },
        data: {
          status: "APPROVED",
          sessionId: session.id,
          approvedAt: new Date(),
        },
      });

      // Clean up the cancelled sessions that this switch fills.
      // The provider's "free block" (client-cancelled) and the client's
      // displaced session (provider-cancelled) should be removed now that
      // a real session replaces them.
      await tx.session.deleteMany({
        where: {
          status: "CANCELLED",
          AND: [
            { startTime: { lt: proposal.endTime } },
            { endTime: { gt: proposal.startTime } },
          ],
          OR: [
            // Provider's freed slot (client cancelled their session)
            { providerId: proposal.providerId, cancelledBy: "CLIENT" },
            // Client's displaced session (provider cancelled on them)
            ...(proposal.clientId
              ? [{ clientId: proposal.clientId, cancelledBy: "PROVIDER" as const }]
              : []),
          ],
        },
      });

      return session;
    });

    return {
      success: true,
      sessionId: result.id,
      clientId: proposal.clientId,
      providerId: proposal.providerId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve session.";
    return { success: false, error: message };
  }
}

export async function approveProposedSession(proposalId: string): Promise<
  | { success: true; sessionId: string }
  | { success: false; error: string }
> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await approveProposalCore(proposalId);
  if (!result.success) return result;

  await writeAuditLog({
    action: "CREATE",
    resourceType: "Session",
    resourceId: result.sessionId,
    userId: auth.userId,
    metadata: {
      fromProposalId: proposalId,
      clientId: result.clientId,
      providerId: result.providerId,
    },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");

  return { success: true, sessionId: result.sessionId };
}

// Batched approval — same per-proposal logic as approveProposedSession, but
// done in one server roundtrip with a single auth check, one revalidatePath at
// the end, and audit logs batched into a single createMany. Used by the
// "Approve all" button so 30+ proposals don't fan out to 30+ separate server
// actions. Proposals are processed serially so each ATI re-check inside the
// per-proposal transaction sees the committed state of the previous approval.
export async function approveAllProposedSessions(
  proposalIds: string[]
): Promise<{
  approved: { proposalId: string; sessionId: string }[];
  failed: { proposalId: string; error: string }[];
}> {
  const auth = await requireUser();
  if (!auth.ok) {
    return {
      approved: [],
      failed: proposalIds.map((id) => ({ proposalId: id, error: auth.error })),
    };
  }

  const approved: { proposalId: string; sessionId: string }[] = [];
  const failed: { proposalId: string; error: string }[] = [];
  const auditEntries: {
    userId: string;
    action: "CREATE";
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }[] = [];

  for (const proposalId of proposalIds) {
    const result = await approveProposalCore(proposalId);
    if (result.success) {
      approved.push({ proposalId, sessionId: result.sessionId });
      auditEntries.push({
        userId: auth.userId,
        action: "CREATE",
        resourceType: "Session",
        resourceId: result.sessionId,
        metadata: {
          fromProposalId: proposalId,
          clientId: result.clientId,
          providerId: result.providerId,
        },
      });
    } else {
      failed.push({ proposalId, error: result.error });
    }
  }

  // One batched audit-log insert instead of N round-trips. Failures are
  // swallowed because HIPAA logging is best-effort and must not block.
  if (auditEntries.length > 0) {
    try {
      await prisma.auditLog.createMany({
        data: auditEntries.map((e) => ({
          userId: e.userId,
          action: e.action,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          metadata: JSON.parse(JSON.stringify(e.metadata)),
        })),
      });
    } catch (err) {
      console.error("[AuditLog] Batched approval audit log failed:", err);
    }
  }

  if (approved.length > 0) {
    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
  }

  return { approved, failed };
}

// Lightweight lookup for the schedule dock's "Accept all" flow. The client
// fetches the proposal IDs in range, then approves them in small chunks via
// approveAllProposedSessions so no single server request approaches Netlify's
// 10s function timeout. (A single big batch was hitting the timeout, silently
// half-approving and leaving the UI stale.)
export async function listPendingProposalsInRange(
  startDate: Date,
  endDate: Date,
  centerId: string
): Promise<{ ids: string[] }> {
  const auth = await requireUser();
  if (!auth.ok) return { ids: [] };

  const centerProviders = await prisma.provider.findMany({
    where: { OR: [{ centerId }, { centerId: null }] },
    select: { id: true },
  });
  const centerProviderIds = centerProviders.map((p) => p.id);

  const pending = await prisma.proposedSession.findMany({
    where: {
      status: "PENDING",
      providerId: { in: centerProviderIds },
      startTime: { gte: startDate, lt: endDate },
    },
    select: { id: true },
    orderBy: { startTime: "asc" },
  });
  return { ids: pending.map((p) => p.id) };
}

export async function rejectProposedSession(
  proposalId: string,
  rejectionReason?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const proposal = await prisma.proposedSession.findUnique({
    where: { id: proposalId },
  });

  if (!proposal) {
    return { success: false, error: "Proposal not found" };
  }
  if (proposal.status !== "PENDING") {
    return {
      success: false,
      error: `Proposal is already ${proposal.status.toLowerCase()}`,
    };
  }

  await prisma.proposedSession.update({
    where: { id: proposalId },
    data: {
      status: "REJECTED",
      rejectionReason: rejectionReason ?? null,
      rejectedAt: new Date(),
    },
  });

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "ProposedSession",
    resourceId: proposalId,
    userId: auth.userId,
    metadata: { action: "REJECT", rejectionReason: rejectionReason ?? null },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");

  return { success: true };
}

// Clear the full schedule for a specific calendar day:
//   - Deletes all SCHEDULED and CANCELLED sessions for providers in the center
//   - Rejects APPROVED proposals whose linked session was just deleted (prevents dangling sessionId)
//   - Deletes all PENDING proposals for the day
// Intended for the "Clear Day" workflow: wipe the day, place lunches/breaks manually,
// then re-run Auto Complete which will schedule around the manual entries.
// IN_PROGRESS and COMPLETED sessions are intentionally left untouched.
export async function clearDaySchedule(
  targetDayStart: Date,
  targetDayEnd: Date,
  centerId: string
): Promise<
  | { success: true; deletedSessions: number; deletedProposals: number }
  | { success: false; error: string }
> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    // Resolve provider IDs that belong to this center.
    // Using a direct provider lookup rather than a nested session→provider filter
    // avoids missing sessions whose providers have centerId=null in the DB
    // (e.g. seeded before centers were introduced).
    const centerProviders = await prisma.provider.findMany({
      where: { OR: [{ centerId }, { centerId: null }] },
      select: { id: true },
    });
    const centerProviderIds = centerProviders.map((p) => p.id);

    // Find only SCHEDULED sessions to delete — CANCELLED sessions are preserved as a permanent record.
    // Sessions tied to a RecurringEvent (lunches, breaks, supervision blocks) are also preserved —
    // wiping them here would silently destroy the user's recurring schedule with no auto-regenerate.
    const sessionsToDelete = await prisma.session.findMany({
      where: {
        providerId: { in: centerProviderIds },
        status: "SCHEDULED",
        recurringEventId: null,
        startTime: { gte: targetDayStart, lt: targetDayEnd },
      },
      select: { id: true },
    });
    const sessionIds = sessionsToDelete.map((s) => s.id);

    const [sessionResult, , proposalResult] = await prisma.$transaction([
      // 1. Delete only SCHEDULED sessions — CANCELLED sessions must not be wiped
      prisma.session.deleteMany({
        where: { id: { in: sessionIds } },
      }),

      // 2. Reject APPROVED proposals for this day's providers.
      // Cannot filter by sessionId here: the schema uses onDelete: SetNull, so
      // PostgreSQL nullifies sessionId on all linked proposals the moment step 1
      // deletes the sessions — before this updateMany runs. Filtering by
      // startTime + providerId is equivalent and immune to the cascade.
      prisma.proposedSession.updateMany({
        where: {
          status: "APPROVED",
          startTime: { gte: targetDayStart, lt: targetDayEnd },
          providerId: { in: centerProviderIds },
        },
        data: { status: "REJECTED", rejectionReason: "Session removed during day clear" },
      }),

      // 3. Delete PENDING proposals for the day
      prisma.proposedSession.deleteMany({
        where: {
          status: "PENDING",
          startTime: { gte: targetDayStart, lt: targetDayEnd },
        },
      }),
    ]);

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return {
      success: true,
      deletedSessions: sessionResult.count,
      deletedProposals: proposalResult.count,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear day.",
    };
  }
}

// ─── Clear Day — Unbillable Sessions Only ─────────────────────────────────────
// Removes non-billable sessions (Drive Time, Lunch, Admin, etc.) while keeping
// billable sessions (Direct Therapy, etc.) and proposals untouched.

export async function clearDayUnbillable(
  targetDayStart: Date,
  targetDayEnd: Date,
  centerId: string
): Promise<
  | { success: true; deletedSessions: number }
  | { success: false; error: string }
> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const centerProviders = await prisma.provider.findMany({
      where: { OR: [{ centerId }, { centerId: null }] },
      select: { id: true },
    });
    const centerProviderIds = centerProviders.map((p) => p.id);

    const result = await prisma.session.deleteMany({
      where: {
        providerId: { in: centerProviderIds },
        billable: false,
        status: "SCHEDULED",
        startTime: { gte: targetDayStart, lt: targetDayEnd },
      },
    });

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return { success: true, deletedSessions: result.count };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear unbillable sessions.",
    };
  }
}

// ─── Clear Week ────────────────────────────────────────────────────────────────
// Full reset for the target week:
//   - Rejects APPROVED proposals, deletes PENDING proposals
//   - Deletes auto-generated drive time sessions
//   - Deletes CANCELLED sessions (leaves SCHEDULED/COMPLETED untouched)
//   - Deletes ProviderBlocks and ClientBlocks created from cancellations

export async function clearWeekProposals(
  weekStart: Date,
  weekEnd: Date,
  centerId: string
): Promise<
  | { success: true; deletedProposals: number }
  | { success: false; error: string }
> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const [centerProviders, centerClients] = await Promise.all([
      prisma.provider.findMany({
        where: { OR: [{ centerId }, { centerId: null }] },
        select: { id: true },
      }),
      prisma.client.findMany({
        where: { OR: [{ centerId }, { centerId: null }] },
        select: { id: true },
      }),
    ]);
    const centerProviderIds = centerProviders.map((p) => p.id);
    const centerClientIds   = centerClients.map((c) => c.id);

    const [, deletedResult] = await prisma.$transaction([
      // Reject any APPROVED proposals in the range
      prisma.proposedSession.updateMany({
        where: {
          status: "APPROVED",
          startTime: { gte: weekStart, lt: weekEnd },
          providerId: { in: centerProviderIds },
        },
        data: { status: "REJECTED", rejectionReason: "Cleared by user" },
      }),
      // Delete PENDING proposals
      prisma.proposedSession.deleteMany({
        where: {
          status: "PENDING",
          startTime: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Delete all SCHEDULED sessions for the week (billable and non-billable),
      // but preserve recurring-event instances — those represent the user's
      // standing schedule (lunches, supervision, etc.) and would not auto-regenerate.
      prisma.session.deleteMany({
        where: {
          providerId: { in: centerProviderIds },
          status: "SCHEDULED",
          recurringEventId: null,
          startTime: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Delete cancelled sessions — they clutter the view after a clear
      prisma.session.deleteMany({
        where: {
          providerId: { in: centerProviderIds },
          status: "CANCELLED",
          startTime: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Delete rest-of-day provider blocks for the week
      prisma.providerBlock.deleteMany({
        where: {
          providerId: { in: centerProviderIds },
          date: { gte: weekStart, lt: weekEnd },
        },
      }),
      // Delete rest-of-day client blocks for the week
      prisma.clientBlock.deleteMany({
        where: {
          clientId: { in: centerClientIds },
          date: { gte: weekStart, lt: weekEnd },
        },
      }),
    ]);

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return { success: true, deletedProposals: deletedResult.count };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear week.",
    };
  }
}

// ─── Clear Day ─────────────────────────────────────────────────────────────────
// Full reset for the target day: proposals, cancelled sessions, and day blocks.

export async function clearDayProposals(
  targetDayStart: Date,
  targetDayEnd: Date,
  centerId: string
): Promise<
  | { success: true; deletedProposals: number }
  | { success: false; error: string }
> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const [centerProviders, centerClients] = await Promise.all([
      prisma.provider.findMany({
        where: { OR: [{ centerId }, { centerId: null }] },
        select: { id: true },
      }),
      prisma.client.findMany({
        where: { OR: [{ centerId }, { centerId: null }] },
        select: { id: true },
      }),
    ]);
    const centerProviderIds = centerProviders.map((p) => p.id);
    const centerClientIds   = centerClients.map((c) => c.id);

    const [, deletedResult] = await prisma.$transaction([
      prisma.proposedSession.updateMany({
        where: {
          status: "APPROVED",
          startTime: { gte: targetDayStart, lt: targetDayEnd },
          providerId: { in: centerProviderIds },
        },
        data: { status: "REJECTED", rejectionReason: "Cleared by user" },
      }),
      prisma.proposedSession.deleteMany({
        where: {
          status: "PENDING",
          startTime: { gte: targetDayStart, lt: targetDayEnd },
        },
      }),
      prisma.providerBlock.deleteMany({
        where: {
          providerId: { in: centerProviderIds },
          date: { gte: targetDayStart, lt: targetDayEnd },
        },
      }),
      prisma.clientBlock.deleteMany({
        where: {
          clientId: { in: centerClientIds },
          date: { gte: targetDayStart, lt: targetDayEnd },
        },
      }),
    ]);

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return { success: true, deletedProposals: deletedResult.count };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to clear day.",
    };
  }
}

// Fetch all pending proposals for a given week
export async function getPendingProposals(weekOf: Date) {
  return prisma.proposedSession.findMany({
    where: {
      weekOf,
      status: "PENDING",
    },
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true },
      },
      provider: {
        select: { id: true, firstName: true, lastName: true, position: true },
      },
      sessionType: {
        select: { name: true },
      },
      authorization: {
        select: { approvedHoursPerWeek: true, fundingSource: true },
      },
    },
    orderBy: [{ startTime: "asc" }],
  });
}
