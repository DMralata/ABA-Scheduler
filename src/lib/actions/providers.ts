"use server";

import { prisma } from "@/lib/prisma";
import { ProviderSchema, UpdateProviderSchema } from "@/lib/schemas/provider";
import type { ProviderInput, UpdateProviderInput } from "@/lib/schemas/provider";
import type { DayOfWeek } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";

// ─── Response Types ───────────────────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Create Provider ──────────────────────────────────────────────────────────

export async function createProvider(
  input: ProviderInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = ProviderSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const existing = await prisma.provider.findUnique({
    where: { externalId: parsed.data.externalId },
    select: { id: true },
  });
  if (existing) {
    return { success: false, error: `A provider with external ID ${parsed.data.externalId} already exists.` };
  }

  const provider = await prisma.provider.create({
    data: parsed.data,
    select: { id: true },
  });

  await writeAuditLog({ action: "CREATE", resourceType: "Provider", resourceId: provider.id });

  return { success: true, data: provider };
}

// ─── Bulk Create Providers ────────────────────────────────────────────────────

interface BulkAvailabilityWindow {
  startTime: string;
  endTime: string;
}

interface BulkProviderInput {
  firstName: string;
  lastName: string;
  externalId: string;
  gender: string;
  spanish: boolean;
  position: "BCBA" | "BCaBA" | "RBT";
  rbtLevel?: "I" | "II" | "III" | null;
  payRateHourly?: number | null;
  availability?: Record<string, BulkAvailabilityWindow>;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createProvidersInBulk(
  rawInputs: BulkProviderInput[]
): Promise<ActionResult<{ successes: number; failures: { index: number; error: string }[] }>> {
  if (rawInputs.length > 50) {
    return { success: false, error: "Cannot import more than 50 providers at once." };
  }

  const failures: { index: number; error: string }[] = [];
  let successes = 0;

  for (let i = 0; i < rawInputs.length; i++) {
    const parsed = ProviderSchema.safeParse(rawInputs[i]);
    if (!parsed.success) {
      failures.push({ index: i, error: parsed.error.issues[0].message });
      continue;
    }

    const existing = await prisma.provider.findUnique({
      where: { externalId: parsed.data.externalId },
      select: { id: true },
    });
    if (existing) {
      failures.push({ index: i, error: `External ID "${parsed.data.externalId}" already exists.` });
      continue;
    }

    const provider = await prisma.provider.create({
      data: parsed.data,
      select: { id: true },
    });

    await writeAuditLog({ action: "CREATE", resourceType: "Provider", resourceId: provider.id });

    const avail = rawInputs[i].availability;
    if (avail && Object.keys(avail).length > 0) {
      const validWindows = Object.entries(avail).filter(
        ([, w]) =>
          TIME_REGEX.test(w.startTime) &&
          TIME_REGEX.test(w.endTime) &&
          w.startTime < w.endTime
      );
      if (validWindows.length > 0) {
        await prisma.providerAvailability.createMany({
          data: validWindows.map(([day, w]) => ({
            providerId: provider.id,
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

// ─── Update Provider ──────────────────────────────────────────────────────────

export async function updateProvider(
  id: string,
  input: UpdateProviderInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = UpdateProviderSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const existing = await prisma.provider.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return { success: false, error: "Provider not found." };
  }

  const provider = await prisma.provider.update({
    where: { id },
    data: parsed.data,
    select: { id: true },
  });

  await writeAuditLog({ action: "UPDATE", resourceType: "Provider", resourceId: provider.id });

  return { success: true, data: provider };
}

// ─── Deactivate Provider ──────────────────────────────────────────────────────
// Sets status to INACTIVE, cancels future sessions, and soft-deletes approvals.

export async function deactivateProvider(id: string): Promise<ActionResult<void>> {
  const existing = await prisma.provider.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return { success: false, error: "Provider not found." };
  }

  const now = new Date();

  const [, cancelResult] = await prisma.$transaction([
    // Mark provider as inactive
    prisma.provider.update({
      where: { id },
      data: { status: "INACTIVE" },
    }),
    // Cancel all future scheduled or in-progress sessions for this provider
    prisma.session.updateMany({
      where: {
        providerId: id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startTime: { gte: now },
      },
      data: { status: "CANCELLED" },
    }),
    // Soft-delete all active client approvals — preserves history if provider returns
    prisma.approvedHome.updateMany({
      where: { providerId: id, endDate: null },
      data: { endDate: now },
    }),
    // Remove all availability windows
    prisma.providerAvailability.deleteMany({ where: { providerId: id } }),
    // Remove all future blocks
    prisma.providerBlock.deleteMany({
      where: { providerId: id, date: { gte: now } },
    }),
    // Reject all pending AI proposals for this provider
    prisma.proposedSession.updateMany({
      where: { providerId: id, status: "PENDING" },
      data: {
        status: "REJECTED",
        rejectionReason: "Provider deactivated",
        rejectedAt: new Date(),
      },
    }),
  ]);

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "Provider",
    resourceId: id,
    metadata: { action: "DEACTIVATE", sessionsCancelled: cancelResult.count },
  });

  return { success: true, data: undefined };
}

// ─── Set Availability ─────────────────────────────────────────────────────────
// Replaces all availability windows for a provider on a given day.

export async function setProviderAvailability(
  providerId: string,
  dayOfWeek: DayOfWeek,
  windows: { startTime: string; endTime: string }[]
): Promise<ActionResult<void>> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { id: true },
  });
  if (!provider) {
    return { success: false, error: "Provider not found." };
  }

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const w of windows) {
    if (!timeRegex.test(w.startTime) || !timeRegex.test(w.endTime)) {
      return { success: false, error: "Time format must be HH:MM (e.g. 09:00)." };
    }
  }

  await prisma.$transaction([
    prisma.providerAvailability.deleteMany({ where: { providerId, dayOfWeek } }),
    prisma.providerAvailability.createMany({
      data: windows.map((w) => ({ providerId, dayOfWeek, ...w })),
    }),
  ]);

  await writeAuditLog({
    action: "UPDATE",
    resourceType: "ProviderAvailability",
    resourceId: providerId,
    metadata: { dayOfWeek, windowCount: windows.length },
  });

  return { success: true, data: undefined };
}

// ─── Add Provider Block ───────────────────────────────────────────────────────
// Adds a one-off blocked time for a specific date, overriding normal availability.

export async function addProviderBlock(
  providerId: string,
  block: { date: Date; startTime: string; endTime: string; reason?: string }
): Promise<ActionResult<{ id: string }>> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { id: true },
  });
  if (!provider) {
    return { success: false, error: "Provider not found." };
  }

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timeRegex.test(block.startTime) || !timeRegex.test(block.endTime)) {
    return { success: false, error: "Time format must be HH:MM (e.g. 09:00)." };
  }

  const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  if (toMins(block.endTime) <= toMins(block.startTime)) {
    return { success: false, error: "Block end time must be after start time." };
  }

  const created = await prisma.providerBlock.create({
    data: { providerId, ...block },
    select: { id: true },
  });

  return { success: true, data: created };
}

// ─── Remove Provider Block ────────────────────────────────────────────────────

export async function removeProviderBlock(blockId: string): Promise<ActionResult<void>> {
  const block = await prisma.providerBlock.findUnique({
    where: { id: blockId },
    select: { id: true },
  });
  if (!block) {
    return { success: false, error: "Block not found." };
  }

  await prisma.providerBlock.delete({ where: { id: blockId } });

  return { success: true, data: undefined };
}
