"use server";

import { prisma } from "@/lib/prisma";
import { ClientSchema, UpdateClientSchema } from "@/lib/schemas/client";
import type { ClientInput, UpdateClientInput } from "@/lib/schemas/client";
import { writeAuditLog } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import type { DayOfWeek } from "@prisma/client";

// Maps a thrown error to a user-facing message. Unique-constraint violations
// (P2002) surface as a duplicate-ID message; everything else gets a generic
// message so raw DB errors never crash the page.
function toActionError(err: unknown, duplicateMessage: string): string {
  const code = typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: unknown }).code
    : undefined;
  if (code === "P2002") return duplicateMessage;
  console.error("[clients] action failed:", err);
  return "Something went wrong saving the client. Please try again.";
}

// ─── Response Types ───────────────────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Create Client ────────────────────────────────────────────────────────────

export async function createClient(
  input: ClientInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = ClientSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const duplicateMessage = `A client with external ID ${parsed.data.externalId} already exists.`;

  const existing = await prisma.client.findUnique({
    where: { externalId: parsed.data.externalId },
    select: { id: true },
  });
  if (existing) {
    return { success: false, error: duplicateMessage };
  }

  let client: { id: string };
  try {
    client = await prisma.client.create({
      data: parsed.data,
      select: { id: true },
    });
  } catch (err) {
    // P2002 also closes the race between the findUnique check and the insert.
    return { success: false, error: toActionError(err, duplicateMessage) };
  }

  await writeAuditLog({ action: "CREATE", resourceType: "Client", resourceId: client.id, userId: auth.userId });

  return { success: true, data: client };
}

// ─── Update Client ────────────────────────────────────────────────────────────

export async function updateClient(
  id: string,
  input: UpdateClientInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const parsed = UpdateClientSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const existing = await prisma.client.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return { success: false, error: "Client not found." };
  }

  let client: { id: string };
  try {
    client = await prisma.client.update({
      where: { id },
      data: parsed.data,
      select: { id: true },
    });
  } catch (err) {
    return { success: false, error: toActionError(err, "Another client already uses that value.") };
  }

  await writeAuditLog({ action: "UPDATE", resourceType: "Client", resourceId: client.id, userId: auth.userId });

  return { success: true, data: client };
}

// ─── Deactivate Client ────────────────────────────────────────────────────────
// Sets termination date to today and cancels all future scheduled sessions.

export async function deactivateClient(
  id: string,
  terminationDate: Date = new Date()
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const existing = await prisma.client.findUnique({
    where: { id },
    select: { id: true, terminationDate: true },
  });
  if (!existing) {
    return { success: false, error: "Client not found." };
  }
  if (existing.terminationDate && existing.terminationDate <= new Date()) {
    return { success: false, error: "Client is already deactivated." };
  }

  const [, cancelResult] = await prisma.$transaction([
    prisma.client.update({
      where: { id },
      data: { terminationDate },
    }),
    // Cancel all future sessions for this client
    prisma.session.updateMany({
      where: {
        clientId: id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startTime: { gte: terminationDate },
      },
      // Stamp who/why so these don't pollute the dashboard as "Unknown"
      data: {
        status: "CANCELLED",
        cancelledBy: "CLIENT",
        cancellationReason: "CLIENT_DEACTIVATED",
      },
    }),
    // Soft-delete all active provider approvals — preserves history for re-admission
    prisma.approvedHome.updateMany({
      where: { clientId: id, endDate: null },
      data: { endDate: terminationDate },
    }),
    // Reject all pending AI proposals for this client
    prisma.proposedSession.updateMany({
      where: { clientId: id, status: "PENDING" },
      data: {
        status: "REJECTED",
        rejectionReason: "Client deactivated",
        rejectedAt: new Date(),
      },
    }),
  ]);

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "Client",
    resourceId: id,
    metadata: { action: "DEACTIVATE", terminationDate, sessionsCancelled: cancelResult.count },
  });

  return { success: true, data: { id } };
}

// ─── Assign Approved Home Provider ───────────────────────────────────────────

export async function assignApprovedHomeProvider(
  clientId: string,
  providerId: string
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const [client, provider] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }),
    prisma.provider.findUnique({ where: { id: providerId }, select: { id: true } }),
  ]);

  if (!client) return { success: false, error: "Client not found." };
  if (!provider) return { success: false, error: "Provider not found." };

  await prisma.approvedHome.upsert({
    where: { clientId_providerId: { clientId, providerId } },
    // If the record exists (even if soft-deleted), re-activate it
    update: { endDate: null, assignedAt: new Date() },
    create: { clientId, providerId },
  });

  await writeAuditLog({
    action: "CREATE",
    resourceType: "ApprovedHome",
    resourceId: `${clientId}:${providerId}`,
    metadata: { clientId, providerId },
  });

  return { success: true, data: undefined };
}

// ─── Set Client Availability ──────────────────────────────────────────────────
// Replaces all availability windows for a client on a given day.

export async function setClientAvailability(
  clientId: string,
  dayOfWeek: DayOfWeek,
  windows: { startTime: string; endTime: string }[]
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    return { success: false, error: "Client not found." };
  }

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const w of windows) {
    if (!timeRegex.test(w.startTime) || !timeRegex.test(w.endTime)) {
      return { success: false, error: "Time format must be HH:MM (e.g. 09:00)." };
    }
    if (w.startTime >= w.endTime) {
      return { success: false, error: "End time must be after start time." };
    }
  }

  await prisma.$transaction([
    prisma.clientAvailability.deleteMany({ where: { clientId, dayOfWeek } }),
    ...(windows.length > 0
      ? [prisma.clientAvailability.createMany({ data: windows.map((w) => ({ clientId, dayOfWeek, ...w })) })]
      : []),
  ]);

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "ClientAvailability",
    resourceId: clientId,
    metadata: { dayOfWeek, windowCount: windows.length },
  });

  return { success: true, data: undefined };
}

// ─── Bulk Create Clients ──────────────────────────────────────────────────────

interface BulkAvailabilityWindow {
  startTime: string;
  endTime: string;
}

interface BulkClientInput {
  firstName: string;
  lastName: string;
  externalId: string;
  dateOfBirth: string;
  gender: string;
  spanish: boolean;
  femaleProviderOnly: boolean;
  insurance: string;
  activeDate: string;
  preferredLocation?: "HOME" | "CENTER" | "HYBRID" | "SCHOOL";
  minimumRbtLevel?: "I" | "II" | "III" | null;
  defaultSessionHours?: number | null;
  availability?: Record<string, BulkAvailabilityWindow>;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createClientsInBulk(
  rawInputs: BulkClientInput[]
): Promise<ActionResult<{ successes: number; failures: { index: number; error: string }[] }>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  if (rawInputs.length > 50) {
    return { success: false, error: "Cannot import more than 50 clients at once." };
  }

  const failures: { index: number; error: string }[] = [];
  let successes = 0;

  for (let i = 0; i < rawInputs.length; i++) {
    const parsed = ClientSchema.safeParse(rawInputs[i]);
    if (!parsed.success) {
      failures.push({ index: i, error: parsed.error.issues[0].message });
      continue;
    }

    const existing = await prisma.client.findUnique({
      where: { externalId: parsed.data.externalId },
      select: { id: true },
    });
    if (existing) {
      failures.push({ index: i, error: `External ID "${parsed.data.externalId}" already exists.` });
      continue;
    }

    let client: { id: string };
    try {
      client = await prisma.client.create({
        data: parsed.data,
        select: { id: true },
      });
    } catch (err) {
      failures.push({
        index: i,
        error: toActionError(err, `External ID "${parsed.data.externalId}" already exists.`),
      });
      continue;
    }

    await writeAuditLog({ action: "CREATE", resourceType: "Client", resourceId: client.id, userId: auth.userId });

    const avail = rawInputs[i].availability;
    if (avail && Object.keys(avail).length > 0) {
      const validWindows = Object.entries(avail).filter(
        ([, w]) =>
          TIME_REGEX.test(w.startTime) &&
          TIME_REGEX.test(w.endTime) &&
          w.startTime < w.endTime
      );
      if (validWindows.length > 0) {
        await prisma.clientAvailability.createMany({
          data: validWindows.map(([day, w]) => ({
            clientId: client.id,
            dayOfWeek: day as DayOfWeek,
            startTime: w.startTime,
            endTime: w.endTime,
          })),
        });
      }
    }

    successes++;
  }

  return { success: true, data: { successes, failures } };
}

// ─── Remove Approved Home Provider ───────────────────────────────────────────

export async function removeApprovedHomeProvider(
  clientId: string,
  providerId: string
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const record = await prisma.approvedHome.findUnique({
    where: { clientId_providerId: { clientId, providerId } },
  });
  if (!record || record.endDate !== null) {
    return { success: false, error: "This provider is not approved for this client." };
  }

  await prisma.approvedHome.update({
    where: { clientId_providerId: { clientId, providerId } },
    data: { endDate: new Date() },
  });

  await writeAuditLog({
    action: "DELETE",
    resourceType: "ApprovedHome",
    resourceId: `${clientId}:${providerId}`,
    metadata: { clientId, providerId },
  });

  return { success: true, data: undefined };
}

// ─── Save Client Preferred Slots ──────────────────────────────────────────────
// Full replace — deletes all existing slots and recreates from the given list.

export async function saveClientPreferredSlots(
  clientId: string,
  slots: { dayOfWeek: DayOfWeek; startTime: string }[]
): Promise<ActionResult<void>> {
  const auth = await requireUser();
  if (!auth.ok) return { success: false, error: auth.error };

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const s of slots) {
    if (!timeRegex.test(s.startTime)) {
      return { success: false, error: "Time format must be HH:MM (e.g. 09:00)." };
    }
  }

  await prisma.$transaction([
    prisma.clientPreferredSlot.deleteMany({ where: { clientId } }),
    ...(slots.length > 0
      ? [prisma.clientPreferredSlot.createMany({ data: slots.map((s) => ({ clientId, ...s })) })]
      : []),
  ]);

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "ClientPreferredSlots",
    resourceId: clientId,
    metadata: { slotCount: slots.length },
  });

  return { success: true, data: undefined };
}
