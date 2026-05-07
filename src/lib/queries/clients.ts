import { prisma } from "@/lib/prisma";

// Single client by internal ID
export async function getClientById(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: {
      approvedHomeProviders: {
        where: { endDate: null },
        include: { provider: true },
      },
      availability: true,
      preferredSlots: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
      authorizations: {
        orderBy: { startDate: "desc" },
      },
      center: { select: { timezone: true } },
    },
  });
}

// Single client by EMR/RCM external ID
export async function getClientByExternalId(externalId: string) {
  return prisma.client.findUnique({
    where: { externalId },
    include: {
      approvedHomeProviders: {
        where: { endDate: null },
        include: { provider: true },
      },
      availability: true,
      authorizations: {
        orderBy: { startDate: "desc" },
      },
    },
  });
}

// All active clients (no termination date, or termination date in the future)
export async function getActiveClients() {
  return prisma.client.findMany({
    where: {
      OR: [
        { terminationDate: null },
        { terminationDate: { gt: new Date() } },
      ],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// All clients including inactive
export async function getAllClients() {
  return prisma.client.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

// Client with availability windows — used by the scheduler
export async function getClientWithAvailability(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: {
      availability: true,
      approvedHomeProviders: {
        where: { endDate: null },
        include: { provider: true },
      },
      authorizations: {
        orderBy: { startDate: "desc" },
      },
    },
  });
}

// Guaranteed full data load for validation — ensures availability, active approvals,
// and authorizations are always present.
// Always use this when calling validateSession, never pass a partial client object.
export async function getClientForValidation(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: {
      availability: true,
      approvedHomeProviders: {
        where: { endDate: null }, // Active approvals only
      },
      authorizations: true, // All authorizations — active filtering happens in validation
    },
  });
}

// All active clients with availability + active approved providers + authorizations — used by the scheduler
export async function getClientsForScheduler() {
  return prisma.client.findMany({
    where: {
      OR: [
        { terminationDate: null },
        { terminationDate: { gt: new Date() } },
      ],
    },
    include: {
      availability: true,
      approvedHomeProviders: {
        where: { endDate: null },
        include: { provider: true },
      },
      authorizations: {
        orderBy: { startDate: "desc" },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}
