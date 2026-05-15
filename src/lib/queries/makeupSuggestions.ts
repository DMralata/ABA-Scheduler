import { prisma } from "@/lib/prisma";
import { getWeekBoundaries } from "@/lib/utils";
import type { DayOfWeek } from "@prisma/client";
import { getClientNameMasker } from "@/lib/maskClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MakeupSuggestionType = "NEW_SESSION" | "EXTEND_LATER" | "START_EARLIER";

export interface MakeupSuggestion {
  type: MakeupSuggestionType;
  dayLabel: string;        // "Tuesday"
  dateStr: string;         // "2026-04-16"
  providerId: string;
  providerName: string;
  availableMinutes: number; // free time available (capped by auth headroom)
  windowStart: string;      // "HH:MM" — start of the free window
  windowEnd: string;        // "HH:MM" — end of the free window
  // For extensions: the existing session's end (EXTEND_LATER) or start (START_EARLIER)
  anchorTime?: string;
  suggestionText: string;
}

export interface MakeupSuggestionsResult {
  clientName: string;
  clientId: string;
  cancelledHours: number;
  cancelledDurationMins: number;
  authHeadroom: number;
  sessionTypeId: string;
  locationType: string | null;
  timezone: string;
  centerId: string | null;
  suggestions: MakeupSuggestion[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${period}` : `${hour}:${String(m).padStart(2, "0")}${period}`;
}

// Subtract blocked intervals from a list of free intervals.
function subtractIntervals(
  free: Array<{ start: number; end: number }>,
  blocked: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  let result = [...free];
  for (const block of blocked) {
    const next: Array<{ start: number; end: number }> = [];
    for (const iv of result) {
      if (block.end <= iv.start || block.start >= iv.end) {
        next.push(iv);
        continue;
      }
      if (iv.start < block.start) next.push({ start: iv.start, end: block.start });
      if (iv.end > block.end) next.push({ start: block.end, end: iv.end });
    }
    result = next;
  }
  return result;
}

// Intersect two lists of intervals — returns windows covered by both.
function intersectIntervals(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  for (const ai of a) {
    for (const bi of b) {
      const start = Math.max(ai.start, bi.start);
      const end = Math.min(ai.end, bi.end);
      if (end > start) result.push({ start, end });
    }
  }
  return result;
}

const DAY_ORDER: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday",
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function getMakeupSuggestions(
  cancelledSessionId: string
): Promise<MakeupSuggestionsResult | null> {
  // ── 1. Load the cancelled session ──────────────────────────────────────────
  const session = await prisma.session.findUnique({
    where: { id: cancelledSessionId },
    include: {
      sessionType: { select: { billable: true, requiresBcba: true } },
      client: {
        include: {
          availability: true,
          blocks: true,
          authorizations: { orderBy: { startDate: "desc" } },
          approvedHomeProviders: {
            where: { OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
            select: { providerId: true },
          },
          center: { select: { timezone: true, defaultSessionHours: true } },
        },
      },
    },
  });

  if (!session?.client || !session.clientId) return null;

  // Makeup suggestions are only relevant for direct therapy — billable RBT-eligible
  // sessions. BCBA-only or non-billable session types (supervision, lunch, drive
  // time, etc.) should not surface makeup notifications or dropdowns.
  if (!session.sessionType.billable || session.sessionType.requiresBcba) return null;
  const client = session.client;
  const maskClient = await getClientNameMasker();
  const maskedClientName = `${maskClient(client.firstName)} ${maskClient(client.lastName)}`;
  // Pin to center timezone for determinism (per CLAUDE.md): scheduler internals
  // must produce the same result regardless of who is logged in. session.timezone
  // can carry a per-user display override that would make day-of-week math vary
  // by viewer at DST boundaries.
  const timezone = client.center?.timezone ?? "America/New_York";
  const cancelledDurationMins = Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60_000);

  // ── 2. Authorization headroom ──────────────────────────────────────────────
  const { weekStart, weekEnd } = getWeekBoundaries(session.startTime, timezone);

  const activeAuth = client.authorizations.find(
    (a) => a.startDate <= session.startTime && a.endDate >= session.startTime
  );
  if (!activeAuth) return null;

  // Sum billable hours for this client this week, excluding the cancelled session.
  // Includes in-flight PENDING/APPROVED proposals so headroom reflects hours
  // already spoken for. sessionId IS NULL filters out APPROVED proposals that
  // have already been materialized into a Session — without this, the approved
  // proposal AND its backing session would both count, halving the apparent
  // headroom. Matches the pattern in getClientBillableHoursForWeek.
  const [weekSessions, weekProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        clientId: client.id,
        billable: true,
        status: { in: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        startTime: { gte: weekStart, lt: weekEnd },
        id: { not: cancelledSessionId },
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        clientId: client.id,
        status: { in: ["PENDING", "APPROVED"] },
        sessionId: null,
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { startTime: true, endTime: true },
    }),
  ]);

  const sessionHours = weekSessions.reduce(
    (sum, s) => sum + (s.endTime.getTime() - s.startTime.getTime()) / 3_600_000,
    0
  );
  const proposalHours = weekProposals.reduce(
    (sum, p) => sum + (p.endTime.getTime() - p.startTime.getTime()) / 3_600_000,
    0
  );
  const authHeadroom = activeAuth.approvedHoursPerWeek - sessionHours - proposalHours;

  const cancelledHours = (session.endTime.getTime() - session.startTime.getTime()) / 3_600_000;
  const sessionMins = client.defaultSessionHours
    ? Math.round(client.defaultSessionHours * 60)
    : Math.round((client.center?.defaultSessionHours ?? 4) * 60);

  // ── 3. Remaining days this week (after the cancelled session's day) ─────────
  const cancelledDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(session.startTime);

  const cancelledDayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "long",
  }).format(session.startTime).toUpperCase() as DayOfWeek;

  const cancelledDayIndex = DAY_ORDER.indexOf(cancelledDayOfWeek);
  if (cancelledDayIndex === -1) return null;

  // Build date strings for each remaining weekday
  const remainingDays: Array<{ day: DayOfWeek; dateStr: string }> = [];
  for (let i = cancelledDayIndex + 1; i < DAY_ORDER.length; i++) {
    const daysAhead = i - cancelledDayIndex;
    const date = new Date(session.startTime.getTime() + daysAhead * 86_400_000);
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
    remainingDays.push({ day: DAY_ORDER[i], dateStr });
  }

  if (remainingDays.length === 0) {
    return {
      clientName: maskedClientName,
      clientId: client.id,
      cancelledHours,
      cancelledDurationMins,
      authHeadroom,
      sessionTypeId: session.sessionTypeId,
      locationType: session.locationType ?? null,
      timezone,
      centerId: client.centerId ?? null,
      suggestions: [],
    };
  }

  // ── 4. Load all eligible providers ─────────────────────────────────────────
  // Apply the approved-home-providers restriction only when the cancelled
  // session's location resolves to HOME. HYBRID resolves to CENTER-preferred
  // (per project convention), so HYBRID clients pull from the center pool and
  // the validator enforces approved-home at accept time if the booking falls
  // back to HOME. This matches the booker's behavior (it only checks
  // approvedHomeProviders for actual HOME sessions).
  const requiresApprovedHome = session.locationType === "HOME";
  const approvedProviderIds = new Set(client.approvedHomeProviders.map((a) => a.providerId));

  const allProviders = await prisma.provider.findMany({
    where: {
      status: "ACTIVE",
      ...(requiresApprovedHome
        ? { id: { in: [...approvedProviderIds] } }
        : { centerId: client.centerId ?? undefined }),
    },
    include: {
      availability: true,
      blocks: {
        where: {
          date: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
      },
    },
  });

  // Filter by hard constraints
  const eligibleProviders = allProviders.filter((p) => {
    if (client.femaleProviderOnly && p.gender !== "Female") return false;
    if (client.spanish && !p.spanish) return false;
    const minLevel = client.minimumRbtLevel;
    if (minLevel && p.position === "RBT") {
      const levels = ["I", "II", "III"];
      if (levels.indexOf(p.rbtLevel ?? "") < levels.indexOf(minLevel)) return false;
    }
    return true;
  });

  // Load confirmed sessions AND pending/approved proposals for eligible providers.
  // Both occupy real time — a proposal the scheduler generated but hasn't been
  // approved yet is still a committed window that can't be double-suggested.
  // locationType is needed to decide whether a drive-time buffer is required
  // around each booking (CENTER↔CENTER is the only no-gap pair).
  const providerIds = eligibleProviders.map((p) => p.id);
  const [providerSessions, providerProposals] = await Promise.all([
    prisma.session.findMany({
      where: {
        providerId: { in: providerIds },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { providerId: true, startTime: true, endTime: true, clientId: true, locationType: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        providerId: { in: providerIds },
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { providerId: true, startTime: true, endTime: true, locationType: true },
    }),
  ]);

  // Merge proposals into the same shape as sessions for the blocked-interval logic
  const allProviderBookings = [
    ...providerSessions,
    ...providerProposals.map((p) => ({ ...p, clientId: null })),
  ];

  // Drive-time buffer: mirror validateDriveTimeGap's minimum-gap fallback so the
  // suggester doesn't offer slots that the booker will immediately reject.
  // Only CENTER↔CENTER transitions skip the buffer (provider stays put).
  // HYBRID resolves to CENTER preferred, so treat it as CENTER for gap purposes.
  const DRIVE_BUFFER_MINS = 15;
  const newSessionLocationType = session.locationType;
  function needsBufferAgainst(bookingLocation: string | null): boolean {
    if (!newSessionLocationType || !bookingLocation) return false;
    const a = newSessionLocationType === "HYBRID" ? "CENTER" : newSessionLocationType;
    const b = bookingLocation === "HYBRID" ? "CENTER" : bookingLocation;
    // Only CENTER↔CENTER is safe (provider stays at the same center).
    // SCHOOL↔SCHOOL is NOT safe — different clients can be at different schools.
    if (a === "CENTER" && b === "CENTER") return false;
    return true;
  }

  // Load the client's confirmed sessions AND proposals for the rest of this week.
  const clientRemainingDates = remainingDays.map((d) => d.dateStr);
  const [clientWeekSessions, clientWeekProposalsList] = await Promise.all([
    prisma.session.findMany({
      where: {
        clientId: client.id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { id: true, startTime: true, endTime: true, providerId: true },
    }),
    prisma.proposedSession.findMany({
      where: {
        clientId: client.id,
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: weekStart, lt: weekEnd },
      },
      select: { startTime: true, endTime: true, providerId: true },
    }),
  ]);

  const MIN_SUGGESTION_MINS = 30;
  const authHeadroomMins = Math.floor(authHeadroom * 60);
  const suggestions: MakeupSuggestion[] = [];

  // Converts a DB record with startTime/endTime Date fields into {start, end} minutes-since-midnight
  const toMinInterval = (s: { startTime: Date; endTime: Date }) => {
    const fmt = (d: Date) =>
      parseHHMM(
        new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
          .formatToParts(d)
          .reduce((acc, p) => (p.type === "hour" || p.type === "minute" ? acc + (acc ? ":" : "") + p.value.replace("24", "00").padStart(2, "0") : acc), "")
      );
    return { start: fmt(s.startTime), end: fmt(s.endTime) };
  };

  // Same as toMinInterval but pads start/end by DRIVE_BUFFER_MINS when a
  // drive transition is required between this booking and the proposed makeup.
  const toMinIntervalWithBuffer = (s: { startTime: Date; endTime: Date; locationType: string | null }) => {
    const iv = toMinInterval(s);
    if (needsBufferAgainst(s.locationType)) {
      return { start: iv.start - DRIVE_BUFFER_MINS, end: iv.end + DRIVE_BUFFER_MINS };
    }
    return iv;
  };

  // ── 5. Generate suggestions for each remaining day ─────────────────────────
  for (const { day, dateStr } of remainingDays) {
    if (authHeadroomMins < MIN_SUGGESTION_MINS) break;
    if (!clientRemainingDates.includes(dateStr)) continue;

    const clientWindows = client.availability
      .filter((w) => w.dayOfWeek === day)
      .map((w) => ({ start: parseHHMM(w.startTime), end: parseHHMM(w.endTime) }));
    if (clientWindows.length === 0) continue;

    const clientBlocksToday = client.blocks
      .filter((b) => {
        const bStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(b.date);
        return bStr === dateStr;
      })
      .map((b) => ({ start: parseHHMM(b.startTime), end: parseHHMM(b.endTime) }));

    const clientSessionsToday = clientWeekSessions.filter((s) => {
      const sStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(s.startTime);
      return sStr === dateStr;
    });

    const clientProposalsToday = clientWeekProposalsList.filter((s) => {
      const sStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(s.startTime);
      return sStr === dateStr;
    });

    const clientSessionsBlockedToday = [
      ...clientSessionsToday.map(toMinInterval),
      ...clientProposalsToday.map(toMinInterval),
    ];

    const clientFree = subtractIntervals(clientWindows, [...clientBlocksToday, ...clientSessionsBlockedToday]);

    // ── NEW SESSION suggestions ─────────────────────────────────────────────
    if (clientSessionsToday.length === 0 && clientProposalsToday.length === 0) {
      // Only suggest a new session day if the client has no session or pending proposal already that day
      for (const provider of eligibleProviders) {
        const providerWindowsToday = provider.availability
          .filter((w) => w.dayOfWeek === day)
          .map((w) => ({ start: parseHHMM(w.startTime), end: parseHHMM(w.endTime) }));
        if (providerWindowsToday.length === 0) continue;

        const providerBlocksToday = provider.blocks
          .filter((b) => {
            const bStr = new Intl.DateTimeFormat("en-CA", {
              timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
            }).format(b.date);
            return bStr === dateStr;
          })
          .map((b) => ({ start: parseHHMM(b.startTime), end: parseHHMM(b.endTime) }));

        const providerBookingsToday = allProviderBookings
          .filter((s) => {
            if (s.providerId !== provider.id) return false;
            const sStr = new Intl.DateTimeFormat("en-CA", {
              timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
            }).format(s.startTime);
            return sStr === dateStr;
          })
          .map(toMinIntervalWithBuffer);

        const providerFree = subtractIntervals(providerWindowsToday, [...providerBlocksToday, ...providerBookingsToday]);
        const overlap = intersectIntervals(clientFree, providerFree);

        // Find best window — largest contiguous block that fits a full session
        const best = overlap
          .filter((iv) => iv.end - iv.start >= Math.min(sessionMins, 120))
          .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];

        if (!best) continue;

        const availableMins = Math.min(best.end - best.start, authHeadroomMins);
        if (availableMins < MIN_SUGGESTION_MINS) continue;

        suggestions.push({
          type: "NEW_SESSION",
          dayLabel: DAY_LABELS[day],
          dateStr,
          providerId: provider.id,
          providerName: `${provider.firstName} ${provider.lastName}`,
          availableMinutes: availableMins,
          windowStart: formatHHMM(best.start),
          windowEnd: formatHHMM(best.end),
          suggestionText: `${DAY_LABELS[day]} — ${provider.firstName} ${provider.lastName} available ${formatTime12(formatHHMM(best.start))}–${formatTime12(formatHHMM(best.end))} (${formatDuration(availableMins)} possible)`,
        });
      }
    }

    // ── EXTEND LATER / START EARLIER suggestions ────────────────────────────
    for (const existingSession of clientSessionsToday) {
      const provider = eligibleProviders.find((p) => p.id === existingSession.providerId);
      if (!provider) continue;

      const sessionStartMins = parseHHMM(
        new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
          .formatToParts(existingSession.startTime)
          .reduce((acc, p) => (p.type === "hour" || p.type === "minute" ? acc + (acc ? ":" : "") + p.value.replace("24", "00").padStart(2, "0") : acc), "")
      );
      const sessionEndMins = parseHHMM(
        new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
          .formatToParts(existingSession.endTime)
          .reduce((acc, p) => (p.type === "hour" || p.type === "minute" ? acc + (acc ? ":" : "") + p.value.replace("24", "00").padStart(2, "0") : acc), "")
      );

      const providerWindowsToday = provider.availability
        .filter((w) => w.dayOfWeek === day)
        .map((w) => ({ start: parseHHMM(w.startTime), end: parseHHMM(w.endTime) }));
      if (providerWindowsToday.length === 0) continue;

      const providerBlocksToday = provider.blocks
        .filter((b) => {
          const bStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
          }).format(b.date);
          return bStr === dateStr;
        })
        .map((b) => ({ start: parseHHMM(b.startTime), end: parseHHMM(b.endTime) }));

      // Exclude the session being extended from the bookings list — its buffer
      // would block the very space we want to extend INTO. The validator does
      // the equivalent via excludeSessionId when rescheduleSession runs.
      const providerBookingsTodayExt = allProviderBookings
        .filter((s) => {
          if (s.providerId !== provider.id) return false;
          if (
            s.clientId === client.id &&
            s.startTime.getTime() === existingSession.startTime.getTime() &&
            s.endTime.getTime() === existingSession.endTime.getTime()
          ) return false;
          const sStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
          }).format(s.startTime);
          return sStr === dateStr;
        })
        .map(toMinIntervalWithBuffer);

      // Free windows after session end — for EXTEND LATER
      const afterSessionClient = clientFree.filter((iv) => iv.start >= sessionEndMins);
      const afterSessionProvider = subtractIntervals(
        providerWindowsToday.map((w) => ({ start: Math.max(w.start, sessionEndMins), end: w.end })).filter((w) => w.end > w.start),
        [...providerBlocksToday, ...providerBookingsTodayExt]
      ).filter((iv) => iv.start >= sessionEndMins);

      const afterOverlap = intersectIntervals(afterSessionClient, afterSessionProvider);
      const bestAfter = afterOverlap
        .filter((iv) => iv.start === sessionEndMins) // must be contiguous with session end
        .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];

      if (bestAfter) {
        const availableMins = Math.min(bestAfter.end - bestAfter.start, authHeadroomMins);
        if (availableMins >= MIN_SUGGESTION_MINS) {
          suggestions.push({
            type: "EXTEND_LATER",
            dayLabel: DAY_LABELS[day],
            dateStr,
            providerId: provider.id,
            providerName: `${provider.firstName} ${provider.lastName}`,
            availableMinutes: availableMins,
            windowStart: formatHHMM(sessionEndMins),
            windowEnd: formatHHMM(bestAfter.end),
            anchorTime: formatHHMM(sessionEndMins),
            suggestionText: `${DAY_LABELS[day]} — extend session (ends ${formatTime12(formatHHMM(sessionEndMins))}), ${provider.firstName} ${provider.lastName} and client both free until ${formatTime12(formatHHMM(bestAfter.end))} — up to ${formatDuration(availableMins)} extra`,
          });
        }
      }

      // Free windows before session start — for START EARLIER
      const beforeSessionClient = clientFree.filter((iv) => iv.end <= sessionStartMins);
      const beforeSessionProvider = subtractIntervals(
        providerWindowsToday.map((w) => ({ start: w.start, end: Math.min(w.end, sessionStartMins) })).filter((w) => w.end > w.start),
        [...providerBlocksToday, ...providerBookingsTodayExt]
      ).filter((iv) => iv.end <= sessionStartMins);

      const beforeOverlap = intersectIntervals(beforeSessionClient, beforeSessionProvider);
      const bestBefore = beforeOverlap
        .filter((iv) => iv.end === sessionStartMins) // must be contiguous with session start
        .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];

      if (bestBefore) {
        const availableMins = Math.min(bestBefore.end - bestBefore.start, authHeadroomMins);
        if (availableMins >= MIN_SUGGESTION_MINS) {
          suggestions.push({
            type: "START_EARLIER",
            dayLabel: DAY_LABELS[day],
            dateStr,
            providerId: provider.id,
            providerName: `${provider.firstName} ${provider.lastName}`,
            availableMinutes: availableMins,
            windowStart: formatHHMM(bestBefore.start),
            windowEnd: formatHHMM(sessionStartMins),
            anchorTime: formatHHMM(sessionStartMins),
            suggestionText: `${DAY_LABELS[day]} — start session earlier (currently ${formatTime12(formatHHMM(sessionStartMins))}), ${provider.firstName} ${provider.lastName} and client both free from ${formatTime12(formatHHMM(bestBefore.start))} — up to ${formatDuration(availableMins)} earlier`,
          });
        }
      }
    }
  }

  // Sort: new sessions first, then extensions; within each type by day
  suggestions.sort((a, b) => {
    const typeOrder: Record<MakeupSuggestionType, number> = { NEW_SESSION: 0, START_EARLIER: 1, EXTEND_LATER: 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
    return a.dateStr.localeCompare(b.dateStr);
  });

  return {
    clientName: `${client.firstName} ${client.lastName}`,
    clientId: client.id,
    cancelledHours,
    cancelledDurationMins,
    authHeadroom,
    sessionTypeId: session.sessionTypeId,
    locationType: session.locationType ?? null,
    timezone,
    centerId: client.centerId ?? null,
    suggestions,
  };
}
