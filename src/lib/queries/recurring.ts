import { prisma } from "@/lib/prisma";

export async function getRecurringEvents(centerId?: string) {
  return prisma.recurringEvent.findMany({
    where: centerId ? { centerId } : undefined,
    include: {
      sessionType: { select: { id: true, name: true } },
      providers: {
        include: { provider: { select: { id: true, firstName: true, lastName: true, position: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getRecurringEventById(id: string) {
  return prisma.recurringEvent.findUnique({
    where: { id },
    include: {
      sessionType: { select: { id: true, name: true } },
      providers: {
        include: { provider: { select: { id: true, firstName: true, lastName: true, position: true } } },
      },
    },
  });
}
