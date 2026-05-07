"use server";

import { prisma } from "@/lib/prisma";
import type { DayOfWeek, RecurrenceFrequency } from "@prisma/client";

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface RecurringEventInput {
  name: string;
  sessionTypeId: string;
  centerId: string;
  frequency: RecurrenceFrequency;
  daysOfWeek: DayOfWeek[];
  dayOfMonth?: number;
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  timezone: string;
  startDate: Date;
  endDate?: Date;
  billable: boolean;
  notes?: string;
  providerIds: string[];
}

// ── Session generation ─────────────────────────────────────────────────────────

const DAY_INDEX: Record<DayOfWeek, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

function toUtcDateTime(date: Date, timeStr: string, timezone: string): Date {
  const dateStr = date.toISOString().slice(0, 10);
  const [hours, minutes] = timeStr.split(":").map(Number);

  const noonUTC = new Date(`${dateStr}T12:00:00Z`);
  const localNoonStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(noonUTC);
  const localNoonHour = parseInt(localNoonStr.slice(12, 14), 10);
  const localNoonMin  = parseInt(localNoonStr.slice(15, 17), 10);
  const offsetMs = (12 - localNoonHour) * 3_600_000 - localNoonMin * 60_000;
  const localMidnightUTC = new Date(noonUTC.getTime() + offsetMs - 12 * 3_600_000);
  return new Date(localMidnightUTC.getTime() + hours * 3_600_000 + minutes * 60_000);
}

function occurrenceDates(
  frequency: RecurrenceFrequency,
  daysOfWeek: DayOfWeek[],
  dayOfMonth: number | undefined | null,
  startDate: Date,
  endDate: Date | undefined | null,
  horizon = 90
): Date[] {
  const dates: Date[] = [];
  const ceiling = endDate ?? new Date(startDate.getTime() + horizon * 24 * 3_600_000);
  const cur = new Date(startDate);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(ceiling);
  end.setUTCHours(23, 59, 59, 999);

  while (cur <= end) {
    const dow = cur.getUTCDay(); // 0=Sun
    if (frequency === "DAILY") {
      dates.push(new Date(cur));
    } else if (frequency === "WEEKLY") {
      if (daysOfWeek.some((d) => DAY_INDEX[d] === dow)) {
        dates.push(new Date(cur));
      }
    } else if (frequency === "MONTHLY") {
      const dom = dayOfMonth ?? 1;
      if (cur.getUTCDate() === dom) {
        dates.push(new Date(cur));
      }
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function generateSessionsForEvent(
  recurringEventId: string,
  input: RecurringEventInput,
  fromDate: Date
) {
  const dates = occurrenceDates(
    input.frequency,
    input.daysOfWeek,
    input.dayOfMonth,
    fromDate,
    input.endDate
  );

  const sessionType = await prisma.sessionType.findUnique({
    where: { id: input.sessionTypeId },
    select: { name: true },
  });
  const sessionName = sessionType?.name ?? input.name;

  const rows = dates.flatMap((date) =>
    input.providerIds.map((providerId) => ({
      name: sessionName,
      sessionTypeId: input.sessionTypeId,
      providerId,
      clientId: null,
      recurringEventId,
      startTime: toUtcDateTime(date, input.startTime, input.timezone),
      endTime: toUtcDateTime(date, input.endTime, input.timezone),
      timezone: input.timezone,
      billable: input.billable,
      centerId: input.centerId || null,
      status: "SCHEDULED" as const,
    }))
  );

  if (rows.length > 0) {
    await prisma.session.createMany({ data: rows, skipDuplicates: true });
  }
}

// ── Create ─────────────────────────────────────────────────────────────────────

export async function createRecurringEvent(
  input: RecurringEventInput
): Promise<ActionResult<{ id: string }>> {
  if (!input.name.trim()) return { success: false, error: "Name is required." };
  if (!input.sessionTypeId) return { success: false, error: "Session type is required." };
  if (!input.providerIds.length) return { success: false, error: "Select at least one provider." };
  if (input.frequency === "WEEKLY" && !input.daysOfWeek.length)
    return { success: false, error: "Select at least one day of week." };

  try {
    const event = await prisma.recurringEvent.create({
      data: {
        name: input.name.trim(),
        sessionTypeId: input.sessionTypeId,
        centerId: input.centerId || null,
        frequency: input.frequency,
        daysOfWeek: input.daysOfWeek,
        dayOfMonth: input.dayOfMonth ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        timezone: input.timezone,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        billable: input.billable,
        notes: input.notes?.trim() || null,
        providers: {
          create: input.providerIds.map((providerId) => ({ providerId })),
        },
      },
    });

    await generateSessionsForEvent(event.id, input, input.startDate);

    return { success: true, data: { id: event.id } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create recurring event." };
  }
}

// ── Update ─────────────────────────────────────────────────────────────────────

export async function updateRecurringEvent(
  id: string,
  input: RecurringEventInput
): Promise<ActionResult<{ id: string }>> {
  if (!input.name.trim()) return { success: false, error: "Name is required." };
  if (!input.providerIds.length) return { success: false, error: "Select at least one provider." };
  if (input.frequency === "WEEKLY" && !input.daysOfWeek.length)
    return { success: false, error: "Select at least one day of week." };

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Delete future SCHEDULED sessions tied to this recurring event
    await prisma.session.deleteMany({
      where: {
        recurringEventId: id,
        status: "SCHEDULED",
        startTime: { gte: today },
      },
    });

    await prisma.recurringEvent.update({
      where: { id },
      data: {
        name: input.name.trim(),
        sessionTypeId: input.sessionTypeId,
        centerId: input.centerId || null,
        frequency: input.frequency,
        daysOfWeek: input.daysOfWeek,
        dayOfMonth: input.dayOfMonth ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        timezone: input.timezone,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        billable: input.billable,
        notes: input.notes?.trim() || null,
        providers: {
          deleteMany: {},
          create: input.providerIds.map((providerId) => ({ providerId })),
        },
      },
    });

    await generateSessionsForEvent(id, input, today);

    return { success: true, data: { id } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to update recurring event." };
  }
}

// ── Get available days (read-only) ─────────────────────────────────────────────
// Returns which days of the week at least one of the given providers is available
// during the specified time window. No DB writes — used to populate the form.

export async function getAvailableDays(
  providerIds: string[],
  startTime: string,
  endTime: string
): Promise<ActionResult<{ days: DayOfWeek[] }>> {
  if (!providerIds.length) {
    return { success: false, error: "Select at least one provider first." };
  }
  try {
    const availabilities = await prisma.providerAvailability.findMany({
      where: { providerId: { in: providerIds } },
    });

    const availableDaySet = new Set<DayOfWeek>();
    for (const avail of availabilities) {
      if (avail.startTime <= startTime && avail.endTime >= endTime) {
        availableDaySet.add(avail.dayOfWeek as DayOfWeek);
      }
    }

    if (availableDaySet.size === 0) {
      return {
        success: false,
        error: "No selected providers are available during this time window on any day.",
      };
    }

    return { success: true, data: { days: [...availableDaySet] } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to check availability.",
    };
  }
}

// ── Assign to available days ───────────────────────────────────────────────────
// Regenerates future sessions for a recurring event, filtered to only the days
// of the week where at least one assigned provider is available during the event's
// time window. Deletes any existing future SCHEDULED sessions first.

export async function assignToAvailableDays(
  id: string
): Promise<ActionResult<{ sessionCount: number; days: string[] }>> {
  try {
    const event = await prisma.recurringEvent.findUnique({
      where: { id },
      include: {
        sessionType: { select: { name: true } },
        providers: {
          include: {
            provider: {
              include: { availability: true },
            },
          },
        },
      },
    });

    if (!event) return { success: false, error: "Recurring event not found." };

    // Build a per-provider map of which UTC day-of-week numbers they cover.
    // A provider covers a day if their availability starts at or before the event
    // start and ends at or after the event end on that day.
    const providerAvailDows = new Map<string, Set<number>>();
    for (const { provider } of event.providers) {
      const dows = new Set<number>();
      for (const avail of provider.availability) {
        if (avail.startTime <= event.startTime && avail.endTime >= event.endTime) {
          dows.add(DAY_INDEX[avail.dayOfWeek as DayOfWeek]);
        }
      }
      providerAvailDows.set(provider.id, dows);
    }

    const anyAvailable = [...providerAvailDows.values()].some((dows) => dows.size > 0);
    if (!anyAvailable) {
      return {
        success: false,
        error: "No assigned providers are available during this event's time window on any day.",
      };
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Delete future scheduled sessions for this event
    await prisma.session.deleteMany({
      where: { recurringEventId: id, status: "SCHEDULED", startTime: { gte: today } },
    });

    // Generate occurrence dates per the event's frequency
    const allDates = occurrenceDates(
      event.frequency,
      event.daysOfWeek as DayOfWeek[],
      event.dayOfMonth ?? undefined,
      today,
      event.endDate ?? undefined
    );

    const sessionName = event.sessionType.name;

    // Per-provider filtering: each provider only gets sessions on days they are available
    const rows = allDates.flatMap((date) => {
      const dow = date.getUTCDay();
      return event.providers
        .filter(({ providerId }) => providerAvailDows.get(providerId)?.has(dow) ?? false)
        .map(({ providerId }) => ({
          name: sessionName,
          sessionTypeId: event.sessionTypeId,
          providerId,
          clientId: null as null,
          recurringEventId: id,
          startTime: toUtcDateTime(date, event.startTime, event.timezone),
          endTime: toUtcDateTime(date, event.endTime, event.timezone),
          timezone: event.timezone,
          billable: event.billable,
          centerId: event.centerId || null,
          status: "SCHEDULED" as const,
        }));
    });

    if (rows.length > 0) {
      await prisma.session.createMany({ data: rows, skipDuplicates: true });
    }

    // Collect the union of days that received at least one session (for the success message)
    const DAY_NAME: Record<string, string> = {
      SUNDAY: "Sun", MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed",
      THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat",
    };
    const usedDowSet = new Set(rows.map((r) => r.startTime.getUTCDay()));
    const days = Object.entries(DAY_INDEX)
      .filter(([, idx]) => usedDowSet.has(idx))
      .map(([name]) => DAY_NAME[name] ?? name);

    return { success: true, data: { sessionCount: rows.length, days } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to assign to available days.",
    };
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────

export async function deleteRecurringEvent(id: string): Promise<ActionResult> {
  try {
    // Unlink future sessions (SetNull) then delete the recurring event.
    // Past sessions remain intact.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await prisma.session.deleteMany({
      where: { recurringEventId: id, status: "SCHEDULED", startTime: { gte: today } },
    });

    await prisma.recurringEvent.delete({ where: { id } });

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete recurring event." };
  }
}
