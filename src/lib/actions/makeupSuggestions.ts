"use server";

import { getMakeupSuggestions } from "@/lib/queries/makeupSuggestions";
import type { MakeupSuggestionsResult, MakeupSuggestion } from "@/lib/queries/makeupSuggestions";
import { bookSession } from "@/lib/actions/sessions";
import { revalidatePath } from "next/cache";

export async function fetchMakeupSuggestions(
  cancelledSessionId: string
): Promise<MakeupSuggestionsResult | null> {
  return getMakeupSuggestions(cancelledSessionId);
}

export async function bookMakeupSession(
  result: MakeupSuggestionsResult,
  suggestion: MakeupSuggestion
): Promise<{ success: boolean; error?: string }> {
  const { clientId, sessionTypeId, locationType, timezone, centerId, cancelledDurationMins } = result;

  // Parse "HH:MM" + "YYYY-MM-DD" into a UTC Date using the center's timezone
  function toUtcDate(dateStr: string, timeStr: string): Date {
    // Build an ISO-like string the browser/Node can parse in UTC by appending timezone offset
    // Simpler: treat as local midnight + offset. Instead, use Intl to find the UTC epoch.
    // We do this by constructing the local datetime string and running it through the Date constructor
    // with the timezone offset derived from Intl.
    const [yr, mo, dy] = dateStr.split("-").map(Number);
    const [hr, mn] = timeStr.split(":").map(Number);
    // Create a reference date in the given timezone to find the UTC offset at that moment.
    const ref = new Date(Date.UTC(yr, mo - 1, dy, hr, mn, 0));
    const offsetStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(ref).find((p) => p.type === "timeZoneName")?.value ?? "UTC+0";
    // Parse offset like "GMT-4" or "GMT+5:30"
    const offsetMatch = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!offsetMatch) return ref;
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const offsetMins = sign * (parseInt(offsetMatch[2]) * 60 + parseInt(offsetMatch[3] ?? "0"));
    return new Date(Date.UTC(yr, mo - 1, dy, hr, mn, 0) - offsetMins * 60_000);
  }

  const durationMins = Math.min(cancelledDurationMins, suggestion.availableMinutes);
  const startTime = toUtcDate(suggestion.dateStr, suggestion.windowStart);
  const endTime = new Date(startTime.getTime() + durationMins * 60_000);

  const bookResult = await bookSession({
    name: `Make-up session`,
    sessionTypeId,
    providerId: suggestion.providerId,
    clientId,
    startTime,
    endTime,
    billable: true,
    locationType: (locationType as "HOME" | "CENTER" | "SCHOOL") ?? "CENTER",
    centerId,
    timezone,
    notes: "Scheduled from make-up suggestion",
  });

  if (!bookResult.success) {
    return { success: false, error: bookResult.error };
  }

  revalidatePath("/schedule");
  return { success: true };
}
