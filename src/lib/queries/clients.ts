import { prisma } from "@/lib/prisma";
import { getClientNameMasker, type NameMasker } from "@/lib/maskClient";

function applyMask<T extends { firstName: string; lastName: string }>(
  c: T,
  mask: NameMasker,
): T {
  return { ...c, firstName: mask(c.firstName), lastName: mask(c.lastName) };
}
function applyMaskNullable<T extends { firstName: string; lastName: string }>(
  c: T | null,
  mask: NameMasker,
): T | null {
  return c ? applyMask(c, mask) : c;
}

// Single client by internal ID
export async function getClientById(id: string) {
  const [row, mask] = await Promise.all([
    prisma.client.findUnique({
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
    }),
    getClientNameMasker(),
  ]);
  return applyMaskNullable(row, mask);
}

// Single client by EMR/RCM external ID
export async function getClientByExternalId(externalId: string) {
  const [row, mask] = await Promise.all([
    prisma.client.findUnique({
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
    }),
    getClientNameMasker(),
  ]);
  return applyMaskNullable(row, mask);
}

// All active clients (no termination date, or termination date in the future)
export async function getActiveClients() {
  const [rows, mask] = await Promise.all([
    prisma.client.findMany({
      where: {
        OR: [
          { terminationDate: null },
          { terminationDate: { gt: new Date() } },
        ],
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    getClientNameMasker(),
  ]);
  return rows.map((r) => applyMask(r, mask));
}

// All clients including inactive
export async function getAllClients() {
  const [rows, mask] = await Promise.all([
    prisma.client.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    getClientNameMasker(),
  ]);
  return rows.map((r) => applyMask(r, mask));
}

// Client with availability windows — used by the scheduler
export async function getClientWithAvailability(id: string) {
  const [row, mask] = await Promise.all([
    prisma.client.findUnique({
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
    }),
    getClientNameMasker(),
  ]);
  return applyMaskNullable(row, mask);
}

// Guaranteed full data load for validation — ensures availability, active approvals,
// and authorizations are always present.
// Always use this when calling validateSession, never pass a partial client object.
export async function getClientForValidation(id: string) {
  const [row, mask] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        availability: true,
        approvedHomeProviders: {
          where: { endDate: null }, // Active approvals only
        },
        authorizations: true, // All authorizations — active filtering happens in validation
      },
    }),
    getClientNameMasker(),
  ]);
  return applyMaskNullable(row, mask);
}

// All active clients with availability + active approved providers + authorizations — used by the scheduler
export async function getClientsForScheduler() {
  const [rows, mask] = await Promise.all([
    prisma.client.findMany({
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
    }),
    getClientNameMasker(),
  ]);
  return rows.map((r) => applyMask(r, mask));
}
