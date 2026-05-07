import { Position } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Single provider by internal ID
export async function getProviderById(id: string) {
  return prisma.provider.findUnique({
    where: { id },
    include: {
      approvedClients: {
        where: { endDate: null },
        include: { client: true },
      },
      availability: true,
    },
  });
}

// Single provider by EMR/RCM external ID
export async function getProviderByExternalId(externalId: string) {
  return prisma.provider.findUnique({
    where: { externalId },
    include: {
      approvedClients: {
        where: { endDate: null },
        include: { client: true },
      },
      availability: true,
    },
  });
}

// All providers regardless of status — used for admin views
export async function getAllProviders() {
  return prisma.provider.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// Active providers only (ACTIVE status) — use this for scheduling and dropdowns
export async function getActiveProviders() {
  return prisma.provider.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// Providers filtered by position (BCBA, BCaBA, RBT) — active only
export async function getProvidersByPosition(position: Position) {
  return prisma.provider.findMany({
    where: { position, status: "ACTIVE" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// Active approved home providers for a specific client
export async function getApprovedProvidersForClient(clientId: string) {
  return prisma.approvedHome.findMany({
    where: { clientId, endDate: null },
    include: {
      provider: {
        include: { availability: true },
      },
    },
  });
}

// Provider with availability — used by the scheduler
export async function getProviderWithAvailability(id: string) {
  return prisma.provider.findUnique({
    where: { id },
    include: {
      availability: true,
      approvedClients: {
        where: { endDate: null },
        include: { client: true },
      },
    },
  });
}

// All active providers with availability + active approved clients — used by the scheduler
export async function getProvidersForScheduler() {
  return prisma.provider.findMany({
    where: { status: "ACTIVE" },
    include: {
      availability: true,
      blocks: true,
      approvedClients: {
        where: { endDate: null },
        include: { client: true },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// ─── RBT Availability for Dashboard Efficiency Metric ────────────────────────
// Returns availability windows + blocks for all active RBT providers.
// Used to compute the denominator of the efficiency ratio:
//   RBT Billed Hours / Total RBT Available Hours
export type RBTAvailabilityData = {
  windows: { providerId: string; dayOfWeek: string; startTime: string; endTime: string }[];
  blocks:  { providerId: string; date: Date; startTime: string; endTime: string }[];
};

export async function getRBTAvailabilityData(from: Date): Promise<RBTAvailabilityData> {
  const [windows, blocks] = await Promise.all([
    prisma.providerAvailability.findMany({
      where: { provider: { position: "RBT", status: "ACTIVE" } },
      select: { providerId: true, dayOfWeek: true, startTime: true, endTime: true },
    }),
    prisma.providerBlock.findMany({
      where: {
        provider: { position: "RBT", status: "ACTIVE" },
        date: { gte: from },
      },
      select: { providerId: true, date: true, startTime: true, endTime: true },
    }),
  ]);
  return { windows, blocks };
}

// Guaranteed full data load for validation — ensures blocks, availability, and
// active approved clients are always present.
// Always use this when calling validateSession, never pass a partial provider object.
export async function getProviderForValidation(id: string) {
  return prisma.provider.findUnique({
    where: { id },
    include: {
      availability: true,
      blocks: true,
      approvedClients: {
        where: { endDate: null }, // Active approvals only
      },
    },
  });
}
