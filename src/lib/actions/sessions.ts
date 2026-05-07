"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { BookSessionSchema, RescheduleSessionSchema } from "@/lib/schemas/session";
import type { BookSessionInput, RescheduleSessionInput } from "@/lib/schemas/session";
import { validateSession, validateDriveTimeGap } from "@/lib/validations/scheduling";
import { getClientForValidation } from "@/lib/queries/clients";
import { getProviderForValidation } from "@/lib/queries/providers";
import type { ValidationWarning, ValidationFailure } from "@/lib/validations/scheduling";
import { writeAuditLog } from "@/lib/audit";
import { getWeekBoundaries } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

// ─── Response Types ───────────────────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T; warnings: ValidationWarning[] }
  | { success: false; error: string; failures?: ValidationFailure[] };

const TERMINAL_STATUSES = ["CANCELLED", "COMPLETED", "NO_SHOW"] as const;

// ─── Resolve Timezone ─────────────────────────────────────────────────────────
// Returns the timezone for validation: uses the session's explicit timezone if set,
// otherwise falls back to the client's center timezone, then to a default.

async function resolveTimezone(
  explicitTimezone?: string | null,
  centerId?: string | null
): Promise<string> {
  if (explicitTimezone) return explicitTimezone;
  if (centerId) {
    const center = await prisma.center.findUnique({
      where: { id: centerId },
      select: { timezone: true },
    });
    if (center?.timezone) return center.timezone;
  }
  return "America/New_York"; // Default fallback — configure per org in future
}

// ─── Book Session ─────────────────────────────────────────────────────────────

export async function bookSession(
  input: BookSessionInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = BookSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { providerId, clientId, startTime, endTime, billable } = parsed.data;

  // Validate session type exists and get its service code for authorization matching
  const sessionType = await prisma.sessionType.findUnique({
    where: { id: parsed.data.sessionTypeId },
    select: { id: true, serviceCode: true, requiresBcba: true },
  });
  if (!sessionType) {
    return { success: false, error: "Session type not found." };
  }

  // Load provider — guaranteed to include availability and blocks
  const provider = await getProviderForValidation(providerId);
  if (!provider) {
    return { success: false, error: "Provider not found." };
  }
  if (provider.status !== "ACTIVE") {
    return { success: false, error: "Provider is not active." };
  }

  // BCBA-only session types
  if (sessionType.requiresBcba && provider.position !== "BCBA" && provider.position !== "BCaBA") {
    return { success: false, error: `This session type requires a BCBA or BCaBA. ${provider.firstName} ${provider.lastName} is not qualified.` };
  }

  // Billable session with a client — run full rule validation
  if (clientId) {
    const client = await getClientForValidation(clientId);
    if (!client) {
      return { success: false, error: "Client not found." };
    }

    const timezone = await resolveTimezone(parsed.data.timezone, client.centerId);

    // Drive time gap check — only for HOME or CENTER sessions (not null/unset location types)
    // Mirrors the gap enforcement in the auto-scheduler so manual bookings follow the same rules.
    const locationType = parsed.data.locationType;
    if (locationType === "HOME" || locationType === "CENTER" || locationType === "SCHOOL") {
      const center = client.centerId
        ? await prisma.center.findUnique({
            where: { id: client.centerId },
            select: {
              street: true, city: true, state: true, zip: true, latitude: true, longitude: true,
              schoolStreet: true, schoolCity: true, schoolState: true, schoolZip: true,
              schoolLatitude: true, schoolLongitude: true,
            },
          })
        : null;

      const centerAddress = center
        ? [center.street, center.city, center.state, center.zip].filter(Boolean).join(", ") || null
        : null;
      const schoolAddress = center
        ? [center.schoolStreet, center.schoolCity, center.schoolState, center.schoolZip].filter(Boolean).join(", ") || null
        : null;

      const clientAddress =
        [client.street, client.city, client.state, client.zip].filter(Boolean).join(", ") || null;

      const driveGapResult = await validateDriveTimeGap({
        providerId,
        newStartTime: startTime,
        newEndTime: endTime,
        newLocationType: locationType,
        newClientAddress: clientAddress,
        newClientLat: client.latitude ?? null,
        newClientLng: client.longitude ?? null,
        centerAddress,
        centerLat: center?.latitude ?? null,
        centerLng: center?.longitude ?? null,
        schoolAddress,
        schoolLat: center?.schoolLatitude ?? null,
        schoolLng: center?.schoolLongitude ?? null,
        timezone,
        // bookSession always creates a new session — nothing to exclude
      });

      if (!driveGapResult.valid) {
        return {
          success: false,
          error: "Session failed validation.",
          failures: [{ valid: false as const, reason: driveGapResult.reason }],
        };
      }
    }

    const { failures, warnings, authorizationId } = await validateSession({
      client,
      provider,
      startTime,
      endTime,
      billable,
      serviceCode: sessionType.serviceCode,
      timezone,
      locationType: parsed.data.locationType ?? null,
    });

    if (failures.length > 0) {
      return { success: false, error: "Session failed validation.", failures };
    }

    // Wrap ATI check + insert in a transaction to prevent race conditions
    // where two concurrent requests both pass ATI validation then both insert,
    // causing the client to exceed their authorized weekly hours.
    try {
      const session = await prisma.$transaction(async (tx) => {
        // Re-check provider and client overlap inside the transaction to prevent
        // concurrent requests from double-booking the same slot.
        const providerConflict = await tx.session.findFirst({
          where: {
            providerId,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
          },
        });
        if (providerConflict) {
          throw new Error("Provider already has a session scheduled during this time.");
        }

        const clientConflict = await tx.session.findFirst({
          where: {
            clientId: client.id,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
          },
        });
        if (clientConflict) {
          throw new Error("Client already has a session scheduled during this time.");
        }

        // Re-check ATI inside the transaction to close the race window.
        // This mirrors the pre-transaction check but runs under a serializable lock.
        if (billable && authorizationId) {
          const { weekStart, weekEnd } = getWeekBoundaries(startTime, timezone);

          const sessions = await tx.session.findMany({
            where: {
              clientId: client.id,
              authorizationId,
              billable: true,
              status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
              startTime: { gte: weekStart, lt: weekEnd },
            },
            select: { startTime: true, endTime: true },
          });

          const existingHours = sessions.reduce((total, s) => {
            return total + (s.endTime.getTime() - s.startTime.getTime()) / (1000 * 60 * 60);
          }, 0);

          const newHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          // Find the authorization's weekly limit for comparison
          const auth = await tx.authorization.findUnique({
            where: { id: authorizationId },
            select: { approvedHoursPerWeek: true },
          });

          if (auth && existingHours + newHours > auth.approvedHoursPerWeek) {
            throw new Error(
              `This session would bring the client's weekly billable hours to ${(existingHours + newHours).toFixed(1)}, exceeding their authorized ${auth.approvedHoursPerWeek} hours/week.`
            );
          }
        }

        const { authorizationId: _ignoredAuthId, ...sessionData } = parsed.data;
        return tx.session.create({
          data: {
            ...sessionData,
            clientId,
            authorizationId: authorizationId ?? null,
            timezone: parsed.data.timezone ?? null,
          },
          select: { id: true },
        });
      });

      await writeAuditLog({
        action: "CREATE",
        resourceType: "Session",
        resourceId: session.id,
        metadata: { clientId, providerId, billable },
      });

      revalidatePath("/schedule");
      revalidatePath("/schedule/propose");
      return { success: true, data: session, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to book session.";
      return { success: false, error: message };
    }
  }

  // No client — non-billable time block only. Force clientId null and billable false.
  // Reject if caller tried to book a billable session without a client.
  if (parsed.data.billable) {
    return { success: false, error: "Billable sessions require a client." };
  }
  // Wrap overlap check + create in a transaction to prevent concurrent double-booking.
  try {
    const session = await prisma.$transaction(async (tx) => {
      const providerConflict = await tx.session.findFirst({
        where: {
          providerId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
        },
      });
      if (providerConflict) {
        throw new Error("Provider already has a session scheduled during this time.");
      }

      return tx.session.create({
        data: {
          ...parsed.data,
          clientId: null,
          billable: false,
          authorizationId: null,
          timezone: parsed.data.timezone ?? null,
        },
        select: { id: true },
      });
    });

    await writeAuditLog({
      action: "CREATE",
      resourceType: "Session",
      resourceId: session.id,
      metadata: { providerId, billable: false, clientId: null },
    });

    revalidatePath("/schedule");
    revalidatePath("/schedule/propose");
    return { success: true, data: session, warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to book session.";
    return { success: false, error: message };
  }
}

// ─── Uncancel Session ─────────────────────────────────────────────────────────
// Restores a CANCELLED session to SCHEDULED. Switches the session type back to
// Direct Therapy (the most common billable type) since the original type was
// overwritten by the cancel flow. Authorization is automatically re-derived by
// matching the client's active auths against the session start time, preferring
// one whose service code matches the restored session type.

export async function uncancelSession(id: string): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const session = await prisma.session.findUnique({
    where: { id },
    select: { id: true, status: true, providerId: true, clientId: true, startTime: true, endTime: true },
  });

  if (!session) return { success: false, error: "Session not found." };
  if (session.status !== "CANCELLED") {
    return { success: false, error: "Session is not cancelled." };
  }

  const directTherapyType = await prisma.sessionType.findFirst({
    where: { name: "Direct Therapy" },
    select: { id: true, serviceCode: true },
  }) ?? await prisma.sessionType.findFirst({
    where: { billable: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, serviceCode: true },
  });

  // Re-derive the authorization that should cover this restored session.
  // cancelSession nulls out authorizationId, so we look up an active auth for
  // this client whose date range covers the session's start time. Prefer one
  // matching the restored session-type's service code; fall back to any active
  // auth if no service-code match exists.
  let restoredAuthorizationId: string | null = null;
  if (session.clientId) {
    const candidateAuths = await prisma.authorization.findMany({
      where: {
        clientId: session.clientId,
        startDate: { lte: session.startTime },
        endDate: { gte: session.startTime },
      },
      select: { id: true, serviceCode: true, startDate: true },
      orderBy: { startDate: "desc" },
    });
    const wantedCode = directTherapyType?.serviceCode ?? null;
    const matched = wantedCode
      ? candidateAuths.find((a) => a.serviceCode === wantedCode)
      : null;
    restoredAuthorizationId = (matched ?? candidateAuths[0])?.id ?? null;
  }

  // Remove any proposals or sessions that filled the freed slot while this session
  // was cancelled. Restoring Olivia's session without clearing the fill-in would
  // double-book the provider in the same window.
  await prisma.$transaction([
    // Reject PENDING proposals that conflict with this provider's restored time window
    prisma.proposedSession.updateMany({
      where: {
        providerId: session.providerId,
        status: "PENDING",
        startTime: { lt: session.endTime },
        endTime: { gt: session.startTime },
      },
      data: { status: "REJECTED", rejectionReason: "Original session restored" },
    }),
    // Reject PENDING proposals that conflict with this client's restored time window
    // (covers makeup sessions booked for the client while this session was cancelled)
    ...(session.clientId ? [prisma.proposedSession.updateMany({
      where: {
        clientId: session.clientId,
        status: "PENDING",
        startTime: { lt: session.endTime },
        endTime: { gt: session.startTime },
      },
      data: { status: "REJECTED", rejectionReason: "Original session restored" },
    })] : []),
    // Delete SCHEDULED sessions (other than this one) that conflict with the provider's window
    prisma.session.deleteMany({
      where: {
        id: { not: id },
        providerId: session.providerId,
        status: "SCHEDULED",
        startTime: { lt: session.endTime },
        endTime: { gt: session.startTime },
      },
    }),
    // Delete SCHEDULED sessions (other than this one) that conflict with the client's window
    // (covers makeup sessions approved for the client during the cancellation window)
    ...(session.clientId ? [prisma.session.deleteMany({
      where: {
        id: { not: id },
        clientId: session.clientId,
        status: "SCHEDULED",
        startTime: { lt: session.endTime },
        endTime: { gt: session.startTime },
      },
    })] : []),
    // Restore the cancelled session — re-link the authorization that was nulled at cancel time
    prisma.session.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        ...(directTherapyType ? { sessionTypeId: directTherapyType.id } : {}),
        billable: true,
        authorizationId: restoredAuthorizationId,
        cancelledBy: null,
        cancellationReason: null,
      },
    }),
  ]);

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "Session",
    resourceId: id,
    metadata: { action: "UNCANCEL", restoredAuthorizationId },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");
  return { success: true, data: undefined, warnings: [] };
}

// ─── Suggest Providers ────────────────────────────────────────────────────────
// Deterministic ranking — no Claude call needed. Filters by hard constraints
// (BCBA requirement, approved list, gender, spanish, RBT level) then scores by
// availability overlap and conflict-free slot.

export type SuggestedProvider = {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  reason: string;
};

export async function suggestProviders(input: {
  clientId: string | null;
  sessionTypeId: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  locationType?: "HOME" | "CENTER" | "SCHOOL";
}): Promise<{ success: true; providers: SuggestedProvider[] } | { success: false; error: string }> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const { clientId, sessionTypeId, startTime, endTime, timezone } = input;

  const sessionType = await prisma.sessionType.findUnique({
    where: { id: sessionTypeId },
    select: { requiresBcba: true },
  });
  if (!sessionType) return { success: false, error: "Session type not found." };

  let client: {
    femaleProviderOnly: boolean;
    minimumRbtLevel: string | null;
    spanish: boolean;
    approvedHomeProviders: { providerId: string }[];
  } | null = null;

  if (clientId) {
    client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        femaleProviderOnly: true,
        minimumRbtLevel: true,
        spanish: true,
        approvedHomeProviders: { where: { endDate: null }, select: { providerId: true } },
      },
    });
    if (!client) return { success: false, error: "Client not found." };
  }

  const providers = await prisma.provider.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      position: true,
      rbtLevel: true,
      gender: true,
      spanish: true,
      availability: { select: { dayOfWeek: true, startTime: true, endTime: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  // Derive day + HH:MM from the start/end times in the correct timezone
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" })
    .format(startTime).toUpperCase();
  const fmtHHMM = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
      .format(d);
  const startHHMM = fmtHHMM(startTime);
  const endHHMM = fmtHHMM(endTime);

  // RBT level rank for minimum level comparison
  const rbtRank: Record<string, number> = { I: 1, II: 2, III: 3 };

  // Providers already booked during the requested window
  const conflicted = new Set(
    (await prisma.session.findMany({
      where: {
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
      },
      select: { providerId: true },
    })).map((s) => s.providerId)
  );

  const approvedIds = new Set(client?.approvedHomeProviders.map((a) => a.providerId) ?? []);

  const results: Array<{ p: typeof providers[number]; score: number; tags: string[] }> = [];

  for (const p of providers) {
    let skip = false;
    if (sessionType.requiresBcba && p.position !== "BCBA" && p.position !== "BCaBA") skip = true;
    if (client?.femaleProviderOnly && p.gender.toLowerCase() !== "female") skip = true;
    if (client?.spanish && !p.spanish) skip = true;
    if (client?.minimumRbtLevel && p.rbtLevel) {
      if ((rbtRank[p.rbtLevel] ?? 0) < (rbtRank[client.minimumRbtLevel] ?? 0)) skip = true;
    } else if (client?.minimumRbtLevel && !p.rbtLevel && p.position === "RBT") {
      skip = true;
    }
    // Approved-home list is HOME-only per spec. Apply ONLY when locationType is
    // explicitly HOME — undefined and CENTER both bypass.
    if (input.locationType === "HOME" && approvedIds.size > 0 && !approvedIds.has(p.id)) skip = true;
    if (skip) continue;

    let score = 0;
    const tags: string[] = [];

    const avail = p.availability.filter((a) => a.dayOfWeek === dayOfWeek);
    const hasSlot = avail.some((a) => a.startTime <= startHHMM && a.endTime >= endHHMM);
    if (hasSlot) { score += 3; tags.push("Available this time slot"); }
    else { tags.push("Availability not confirmed"); }

    if (approvedIds.has(p.id)) { score += 2; tags.push("On approved provider list"); }

    if (conflicted.has(p.id)) {
      score -= 5;
      tags.push("Has conflicting session");
    } else {
      score += 1;
    }

    results.push({ p, score, tags });
  }

  results.sort((a, b) => b.score - a.score);

  return {
    success: true,
    providers: results.slice(0, 5).map(({ p, tags }) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      reason: tags.slice(0, 2).join(" · "),
    })),
  };
}

// ─── Reschedule Session ───────────────────────────────────────────────────────

export async function rescheduleSession(
  id: string,
  input: RescheduleSessionInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = RescheduleSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      providerId: true,
      clientId: true,
      billable: true,
      authorizationId: true,
      sessionTypeId: true,
      timezone: true,
      locationType: true,
    },
  });

  if (!session) {
    return { success: false, error: "Session not found." };
  }
  if (TERMINAL_STATUSES.includes(session.status as typeof TERMINAL_STATUSES[number])) {
    return { success: false, error: `Cannot reschedule a ${session.status.toLowerCase().replace("_", " ")} session.` };
  }

  const { startTime, endTime } = parsed.data;

  // Load session type to get service code for authorization matching
  const sessionType = await prisma.sessionType.findUnique({
    where: { id: session.sessionTypeId },
    select: { serviceCode: true },
  });

  const provider = await getProviderForValidation(session.providerId);
  if (!provider) {
    return { success: false, error: "Provider not found." };
  }

  if (session.clientId) {
    const client = await getClientForValidation(session.clientId);
    if (!client) {
      return { success: false, error: "Client not found." };
    }

    const timezone = await resolveTimezone(session.timezone, client.centerId);

    // Drive-time gap check — mirrors bookSession so dragging a session into a
    // new slot doesn't bypass the same drive-buffer rule that booking enforces.
    const locationType = session.locationType;
    if (locationType === "HOME" || locationType === "CENTER" || locationType === "SCHOOL") {
      const center = client.centerId
        ? await prisma.center.findUnique({
            where: { id: client.centerId },
            select: {
              street: true, city: true, state: true, zip: true, latitude: true, longitude: true,
              schoolStreet: true, schoolCity: true, schoolState: true, schoolZip: true,
              schoolLatitude: true, schoolLongitude: true,
            },
          })
        : null;

      const centerAddress = center
        ? [center.street, center.city, center.state, center.zip].filter(Boolean).join(", ") || null
        : null;
      const schoolAddress = center
        ? [center.schoolStreet, center.schoolCity, center.schoolState, center.schoolZip].filter(Boolean).join(", ") || null
        : null;
      const clientAddress =
        [client.street, client.city, client.state, client.zip].filter(Boolean).join(", ") || null;

      const driveGapResult = await validateDriveTimeGap({
        providerId: session.providerId,
        newStartTime: startTime,
        newEndTime: endTime,
        newLocationType: locationType,
        newClientAddress: clientAddress,
        newClientLat: client.latitude ?? null,
        newClientLng: client.longitude ?? null,
        centerAddress,
        centerLat: center?.latitude ?? null,
        centerLng: center?.longitude ?? null,
        schoolAddress,
        schoolLat: center?.schoolLatitude ?? null,
        schoolLng: center?.schoolLongitude ?? null,
        timezone,
        excludeSessionId: id,
      });
      if (!driveGapResult.valid) {
        return {
          success: false,
          error: "Rescheduled session failed validation.",
          failures: [{ valid: false as const, reason: driveGapResult.reason }],
        };
      }
    }

    const { failures, warnings, authorizationId } = await validateSession({
      client,
      provider,
      startTime,
      endTime,
      billable: session.billable,
      serviceCode: sessionType?.serviceCode,
      timezone,
      excludeSessionId: id,
      locationType: session.locationType ?? null,
    });

    if (failures.length > 0) {
      return { success: false, error: "Rescheduled session failed validation.", failures };
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // Re-check overlap inside the transaction to prevent concurrent double-bookings.
        const providerConflict = await tx.session.findFirst({
          where: {
            providerId: session.providerId,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            id: { not: id },
            AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
          },
        });
        if (providerConflict) {
          throw new Error("Provider already has a session scheduled during this time.");
        }

        const clientConflict = await tx.session.findFirst({
          where: {
            clientId: client.id,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            id: { not: id },
            AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
          },
        });
        if (clientConflict) {
          throw new Error("Client already has a session scheduled during this time.");
        }

        // Re-check ATI inside transaction to close race window
        const resolvedAuthId = authorizationId ?? session.authorizationId;
        if (session.billable && resolvedAuthId) {
          const { weekStart, weekEnd } = getWeekBoundaries(startTime, timezone);

          const sessions = await tx.session.findMany({
            where: {
              clientId: client.id,
              authorizationId: resolvedAuthId,
              billable: true,
              status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
              id: { not: id },
              startTime: { gte: weekStart, lt: weekEnd },
            },
            select: { startTime: true, endTime: true },
          });

          const existingHours = sessions.reduce((total, s) => {
            return total + (s.endTime.getTime() - s.startTime.getTime()) / (1000 * 60 * 60);
          }, 0);

          const newHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

          const auth = await tx.authorization.findUnique({
            where: { id: resolvedAuthId },
            select: { approvedHoursPerWeek: true },
          });

          if (auth && existingHours + newHours > auth.approvedHoursPerWeek) {
            throw new Error(
              `This session would bring the client's weekly billable hours to ${(existingHours + newHours).toFixed(1)}, exceeding their authorized ${auth.approvedHoursPerWeek} hours/week.`
            );
          }
        }

        return tx.session.update({
          where: { id },
          data: {
            startTime,
            endTime,
            notes: parsed.data.notes ?? undefined,
            authorizationId: authorizationId ?? session.authorizationId ?? null,
          },
          select: { id: true },
        });
      });

      await writeAuditLog({
        action: "UPDATE",
        resourceType: "Session",
        resourceId: updated.id,
        metadata: { action: "RESCHEDULE", startTime, endTime },
      });

      revalidatePath("/schedule");
      revalidatePath("/schedule/propose");
      return { success: true, data: updated, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reschedule session.";
      return { success: false, error: message };
    }
  }

  // Non-billable block — only re-check provider overlap
  const providerOverlap = await prisma.session.findFirst({
    where: {
      providerId: session.providerId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      id: { not: id },
      AND: [{ startTime: { lt: endTime } }, { endTime: { gt: startTime } }],
    },
  });
  if (providerOverlap) {
    return { success: false, error: "Provider already has a session scheduled during this time." };
  }

  const updated = await prisma.session.update({
    where: { id },
    data: { startTime, endTime, notes: parsed.data.notes ?? undefined },
    select: { id: true },
  });

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "Session",
    resourceId: updated.id,
    metadata: { action: "RESCHEDULE", startTime, endTime },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");
  return { success: true, data: updated, warnings: [] };
}

// ─── Remove Session (Hard Delete) ─────────────────────────────────────────────
// Permanently deletes the session from the database. No cancellation record is
// created, so the scheduler treats this time slot as available again.

export async function removeSession(
  id: string
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const session = await prisma.session.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!session) {
    return { success: false, error: "Session not found." };
  }

  await prisma.session.delete({ where: { id } });

  await writeAuditLog({
    action: "DELETE",
    resourceType: "Session",
    resourceId: id,
    metadata: { action: "REMOVE_WITHOUT_CANCEL" },
  });

  revalidatePath("/schedule");
  revalidatePath("/schedule/propose");
  return { success: true, data: undefined, warnings: [] };
}

// ─── Add Session Type ─────────────────────────────────────────────────────────

export async function addSessionType(
  name: string,
  billable: boolean,
  serviceCode?: string | null
): Promise<ActionResult<{ id: string }>> {
  if (!name.trim()) {
    return { success: false, error: "Session type name is required." };
  }

  const existing = await prisma.sessionType.findUnique({ where: { name } });
  if (existing) {
    return { success: false, error: `Session type "${name}" already exists.` };
  }

  const sessionType = await prisma.sessionType.create({
    data: { name: name.trim(), billable, serviceCode: serviceCode ?? null },
    select: { id: true },
  });

  return { success: true, data: sessionType, warnings: [] };
}

